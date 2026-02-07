const { google } = require('googleapis');
const { simpleParser } = require('mailparser');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Patterns to extract last 4 digits of credit card from emails
const CARD_LAST4_PATTERNS = [
  /(?:card|credit|debit|payment)[^0-9]*(?:ending|end|x+|[*]+)[\s:]*(\d{4})/i,
  /(?:visa|mastercard|amex|american express|discover)[^0-9]*(?:ending|x+|[*]+)[\s:]*(\d{4})/i,
  /[*x]{4,}[\s-]*(\d{4})/i,
  /(?:payment method|charged to)[^0-9]*(\d{4})/i,
  /\b\d{4}[\s-]*[*x]{4,}[\s-]*[*x]{4,}[\s-]*(\d{4})\b/i
];

// Card network detection patterns
const CARD_NETWORK_PATTERNS = {
  visa: [/\bvisa\b/i, /visa.*card/i, /card.*visa/i],
  mastercard: [/\bmastercard\b/i, /\bmaster\s*card\b/i, /mc\s+card/i],
  amex: [/\bamex\b/i, /american\s*express/i, /\bamericanexpress\b/i],
  discover: [/\bdiscover\b/i, /discover.*card/i],
  chase: [/\bchase\b/i, /chase.*card/i],
  citi: [/\bciti\b/i, /\bcitibank\b/i, /citi.*card/i],
  capitalone: [/capital\s*one/i, /\bcapitalone\b/i],
  wellsfargo: [/wells\s*fargo/i, /\bwellsfargo\b/i]
};

// Default protection periods by card issuer (in days)
const DEFAULT_PROTECTION_DAYS = {
  amex: 90,           // American Express Price Protection
  citi: 60,           // Citi Price Rewind (discontinued but some cards still have it)
  chase: 90,          // Chase Price Protection (varies by card)
  discover: 90,       // Discover Price Protection
  capitalone: 60,     // Capital One Price Protection
  visa: 90,           // Generic Visa
  mastercard: 60,     // Generic Mastercard
  default: 90         // Default fallback
};

// Retailer patterns for parsing order confirmation emails
const RETAILER_PATTERNS = {
  amazon: {
    fromPatterns: ['auto-confirm@amazon.com', 'shipment-tracking@amazon.com', 'digital-no-reply@amazon.com'],
    subjectPatterns: ['Your Amazon.com order', 'Your order has shipped', 'Your Amazon order'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order|order)[#:\s]+(\d{3}-\d{7}-\d{7})/,
    productRegex: /<td[^>]*>([^<]+)<\/td>/g,
    domain: 'amazon.com'
  },
  bestbuy: {
    fromPatterns: ['BestBuyInfo@emailinfo.bestbuy.com', 'noreply@bestbuy.com'],
    subjectPatterns: ['Your order has been received', 'Order Confirmation', 'Thanks for your order'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order|BBY)[#:\s]*(\d{10,})/i,
    domain: 'bestbuy.com'
  },
  walmart: {
    fromPatterns: ['help@walmart.com', 'orders@walmart.com'],
    subjectPatterns: ['Your Walmart.com order', 'Order confirmation', 'Thanks for your order'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order)[#:\s]*(\d{13,})/i,
    domain: 'walmart.com'
  },
  target: {
    fromPatterns: ['orders@target.com', 'noreply@target.com'],
    subjectPatterns: ['Your Target order', 'Order confirmation', 'Thanks for shopping'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order)[#:\s]*(\d{10,})/i,
    domain: 'target.com'
  },
  costco: {
    fromPatterns: ['orders@costco.com', 'noreply@costco.com'],
    subjectPatterns: ['Order Confirmation', 'Your Costco.com order'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order)[#:\s]*(\d{10,})/i,
    domain: 'costco.com'
  },
  newegg: {
    fromPatterns: ['info@newegg.com', 'orders@newegg.com'],
    subjectPatterns: ['Order Confirmation', 'Your Newegg.com order'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order)[#:\s]*(\d{10,})/i,
    domain: 'newegg.com'
  },
  homedepot: {
    fromPatterns: ['reply@homedepot.com', 'orders@homedepot.com'],
    subjectPatterns: ['Order Confirmation', 'Your Home Depot order'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order)[#:\s]*(W?\d{9,})/i,
    domain: 'homedepot.com'
  },
  lowes: {
    fromPatterns: ['Lowes@e.lowes.com', 'orders@lowes.com'],
    subjectPatterns: ['Order Confirmation', 'Your Lowes order'],
    priceRegex: /\$[\d,]+\.\d{2}/g,
    orderIdRegex: /(?:Order)[#:\s]*(\d{9,})/i,
    domain: 'lowes.com'
  }
};

class EmailParser {
  async getGmailClient(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        gmailAccessToken: true,
        gmailRefreshToken: true
      }
    });

    if (!user?.gmailAccessToken) {
      throw new Error('Gmail not connected');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: user.gmailAccessToken,
      refresh_token: user.gmailRefreshToken
    });

    // Handle token refresh
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await prisma.user.update({
          where: { id: userId },
          data: { gmailAccessToken: tokens.access_token }
        });
      }
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async syncEmails(userId, syncLogId) {
    let emailsProcessed = 0;
    let purchasesFound = 0;

    try {
      const gmail = await this.getGmailClient(userId);

      // Build query for order confirmation emails
      const fromQueries = Object.values(RETAILER_PATTERNS)
        .flatMap(r => r.fromPatterns)
        .map(from => `from:${from}`)
        .join(' OR ');

      const query = `(${fromQueries}) newer_than:90d`;

      // Fetch messages
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100
      });

      const messages = response.data.messages || [];
      logger.info(`Found ${messages.length} potential order emails for user ${userId}`);

      for (const message of messages) {
        try {
          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'raw'
          });

          const rawEmail = Buffer.from(fullMessage.data.raw, 'base64').toString('utf-8');
          const parsed = await simpleParser(rawEmail);

          emailsProcessed++;

          // Try to extract purchase info
          const purchase = await this.extractPurchaseFromEmail(parsed, userId, message.id);

          if (purchase) {
            purchasesFound++;
          }
        } catch (err) {
          logger.error(`Error processing email ${message.id}:`, err);
        }
      }

      // Update sync log
      await prisma.emailSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'COMPLETED',
          emailsProcessed,
          purchasesFound,
          completedAt: new Date()
        }
      });

      logger.info(`Email sync completed for user ${userId}: ${emailsProcessed} processed, ${purchasesFound} purchases found`);

      return { emailsProcessed, purchasesFound };
    } catch (error) {
      logger.error(`Email sync failed for user ${userId}:`, error);

      await prisma.emailSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'FAILED',
          emailsProcessed,
          purchasesFound,
          errorMessage: error.message,
          completedAt: new Date()
        }
      });

      throw error;
    }
  }

  async extractPurchaseFromEmail(parsedEmail, userId, emailId) {
    const fromAddress = parsedEmail.from?.value?.[0]?.address?.toLowerCase() || '';
    const subject = parsedEmail.subject || '';
    const htmlBody = parsedEmail.html || '';
    const textBody = parsedEmail.text || '';
    const emailDate = parsedEmail.date || new Date();

    // Identify retailer
    let retailer = null;
    let retailerConfig = null;

    for (const [name, config] of Object.entries(RETAILER_PATTERNS)) {
      const fromMatch = config.fromPatterns.some(pattern =>
        fromAddress.includes(pattern.toLowerCase())
      );
      const subjectMatch = config.subjectPatterns.some(pattern =>
        subject.toLowerCase().includes(pattern.toLowerCase())
      );

      if (fromMatch && subjectMatch) {
        retailer = name;
        retailerConfig = config;
        break;
      }
    }

    if (!retailer) {
      return null;
    }

    // Check if already processed
    const existing = await prisma.purchase.findFirst({
      where: {
        userId,
        sourceEmailId: emailId
      }
    });

    if (existing) {
      return null;
    }

    // Extract order details
    const body = htmlBody || textBody;

    // Extract prices
    const priceMatches = body.match(retailerConfig.priceRegex) || [];
    const prices = priceMatches
      .map(p => parseFloat(p.replace(/[$,]/g, '')))
      .filter(p => p > 0 && p < 10000)
      .sort((a, b) => b - a);

    if (prices.length === 0) {
      return null;
    }

    // Extract order ID
    let orderId = null;
    const orderIdMatch = body.match(retailerConfig.orderIdRegex);
    if (orderIdMatch) {
      orderId = orderIdMatch[1];
    }

    // Extract product name (basic approach - can be enhanced)
    let productName = this.extractProductName(body, retailer);

    // Extract card last 4 digits and try to match to user's cards (or auto-create)
    const cardLast4 = this.extractCardLast4(body);
    const matchedCard = await this.matchCardToUser(userId, cardLast4, body);

    // Extract product URL for price monitoring
    const productUrl = this.extractProductUrl(body, retailer, retailerConfig);

    // Calculate protection end date if card is matched
    let protectionEnds = null;
    if (matchedCard && matchedCard.protectionDays) {
      protectionEnds = new Date(emailDate);
      protectionEnds.setDate(protectionEnds.getDate() + matchedCard.protectionDays);
    }

    logger.info(`Email parsing: cardLast4=${cardLast4}, matchedCard=${matchedCard?.id}, productUrl=${productUrl ? 'found' : 'not found'}`);

    // Create purchase record with card linkage and product URL
    const purchase = await prisma.purchase.create({
      data: {
        userId,
        productName: productName || `${retailer.charAt(0).toUpperCase() + retailer.slice(1)} Purchase`,
        retailer: retailer.charAt(0).toUpperCase() + retailer.slice(1),
        purchasePrice: prices[0], // Use highest price (usually total)
        currentPrice: prices[0],
        lowestPrice: prices[0],
        lowestPriceDate: emailDate,
        purchaseDate: emailDate,
        retailerOrderId: orderId,
        sourceType: 'EMAIL',
        sourceEmailId: emailId,
        status: 'MONITORING',
        // NEW: Link to matched credit card
        creditCardId: matchedCard?.id || null,
        protectionEnds: protectionEnds,
        // NEW: Include product URL for price monitoring
        productUrl: productUrl
      }
    });

    // Create initial price history
    await prisma.priceHistory.create({
      data: {
        purchaseId: purchase.id,
        price: prices[0],
        source: retailer
      }
    });

    // Create notification with card linkage info
    const cardInfo = matchedCard
      ? ` (linked to card ending ${cardLast4})`
      : cardLast4
        ? ` (card ending ${cardLast4} not found - please add your card)`
        : '';
    const urlInfo = productUrl ? ' - price monitoring enabled' : ' - add product URL for price monitoring';

    await prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        title: 'New Purchase Detected',
        message: `Found a purchase from ${retailer}: ${productName || 'Item'} for $${prices[0].toFixed(2)}${cardInfo}${urlInfo}`,
        data: { purchaseId: purchase.id, needsCardLink: !matchedCard, cardLast4 }
      }
    });

    logger.info(`Created purchase from email: ${purchase.id} - ${productName} from ${retailer}`);

    return purchase;
  }

  extractProductName(body, retailer) {
    // Common patterns for extracting product names
    const patterns = [
      // Table cell patterns
      /<td[^>]*class="[^"]*product[^"]*"[^>]*>([^<]+)</i,
      // Strong/bold product names
      /<strong[^>]*>([^<]{5,100})<\/strong>/i,
      // Item description patterns
      /Item:\s*([^\n<]{5,100})/i,
      /Product:\s*([^\n<]{5,100})/i,
      // Generic line item patterns
      /\d+\s*x\s*([^\n<]{5,100})/i
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) {
        let name = match[1].trim();
        // Clean up the name
        name = name.replace(/\s+/g, ' ').trim();
        if (name.length > 5 && name.length < 200) {
          return name;
        }
      }
    }

    return null;
  }

  // Extract last 4 digits of card from email body
  extractCardLast4(body) {
    for (const pattern of CARD_LAST4_PATTERNS) {
      const match = body.match(pattern);
      if (match && match[1]) {
        const last4 = match[1];
        // Validate it's 4 digits
        if (/^\d{4}$/.test(last4)) {
          return last4;
        }
      }
    }
    return null;
  }

  // Extract product URL from email
  extractProductUrl(body, retailer, retailerConfig) {
    const domain = retailerConfig.domain;

    // Patterns for product URLs by retailer
    const urlPatterns = {
      amazon: [
        /https?:\/\/(?:www\.)?amazon\.com\/(?:gp\/product|dp|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/gi,
        /https?:\/\/(?:www\.)?amazon\.com\/[^"'\s]*\/dp\/([A-Z0-9]{10})/gi
      ],
      bestbuy: [
        /https?:\/\/(?:www\.)?bestbuy\.com\/site\/[^"'\s]*\.p\?skuId=(\d+)/gi,
        /https?:\/\/(?:www\.)?bestbuy\.com\/site\/[^"'\s]+/gi
      ],
      walmart: [
        /https?:\/\/(?:www\.)?walmart\.com\/ip\/[^"'\s]+/gi
      ],
      target: [
        /https?:\/\/(?:www\.)?target\.com\/p\/[^"'\s]+/gi
      ],
      costco: [
        /https?:\/\/(?:www\.)?costco\.com\/[^"'\s]+\.product\.\d+\.html/gi
      ],
      newegg: [
        /https?:\/\/(?:www\.)?newegg\.com\/[^"'\s]*\/p\/[^"'\s]+/gi
      ],
      homedepot: [
        /https?:\/\/(?:www\.)?homedepot\.com\/p\/[^"'\s]+/gi
      ],
      lowes: [
        /https?:\/\/(?:www\.)?lowes\.com\/pd\/[^"'\s]+/gi
      ]
    };

    const patterns = urlPatterns[retailer] || [];

    for (const pattern of patterns) {
      const matches = body.match(pattern);
      if (matches && matches.length > 0) {
        // Return the first valid product URL
        let url = matches[0];
        // Clean up URL - remove trailing quotes/brackets
        url = url.replace(/["'>\]\)]+$/, '');
        return url;
      }
    }

    // Generic fallback - look for any URL containing the retailer domain and product-like paths
    const genericPattern = new RegExp(
      `https?://(?:www\\.)?${domain.replace('.', '\\.')}[^"'\\s]*(?:product|item|dp|ip|/p/)[^"'\\s]*`,
      'gi'
    );
    const genericMatches = body.match(genericPattern);
    if (genericMatches && genericMatches.length > 0) {
      return genericMatches[0].replace(/["'>\]\)]+$/, '');
    }

    return null;
  }

  // Detect card network from email body
  detectCardNetwork(body) {
    for (const [network, patterns] of Object.entries(CARD_NETWORK_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(body)) {
          logger.info(`Detected card network: ${network}`);
          return network;
        }
      }
    }
    return null;
  }

  // Get protection days based on card network
  getProtectionDays(network) {
    return DEFAULT_PROTECTION_DAYS[network] || DEFAULT_PROTECTION_DAYS.default;
  }

  // Match card last 4 to user's existing cards OR auto-create if not found
  async matchCardToUser(userId, cardLast4, body = '') {
    if (!cardLast4) return null;

    // Get user's cards
    const userCards = await prisma.creditCard.findMany({
      where: { userId },
      select: {
        id: true,
        lastFour: true,
        autoClaimEnabled: true,
        protectionDays: true,
        network: true,
        issuer: true,
        nickname: true
      }
    });

    // Find matching card
    const matchingCard = userCards.find(card => card.lastFour === cardLast4);

    if (matchingCard) {
      logger.info(`Matched card ending in ${cardLast4} to creditCardId: ${matchingCard.id}`);
      return matchingCard;
    }

    // No matching card found - AUTO-CREATE one!
    logger.info(`No card found with last 4: ${cardLast4}. Auto-creating card...`);

    // Detect card network/issuer from email body
    const detectedNetwork = this.detectCardNetwork(body);
    const protectionDays = this.getProtectionDays(detectedNetwork);

    // Determine network and issuer
    let network = 'unknown';
    let issuer = 'Unknown';

    if (detectedNetwork) {
      // Map detected network to proper values
      if (['visa', 'mastercard', 'amex', 'discover'].includes(detectedNetwork)) {
        network = detectedNetwork;
        issuer = detectedNetwork.charAt(0).toUpperCase() + detectedNetwork.slice(1);
        if (detectedNetwork === 'amex') issuer = 'American Express';
      } else {
        // It's an issuer (chase, citi, etc.)
        issuer = detectedNetwork.charAt(0).toUpperCase() + detectedNetwork.slice(1);
        if (detectedNetwork === 'capitalone') issuer = 'Capital One';
        if (detectedNetwork === 'wellsfargo') issuer = 'Wells Fargo';
      }
    }

    // Map detected network to CardType enum
    let cardType = 'OTHER';
    const networkToCardType = {
      visa: 'VISA',
      mastercard: 'MASTERCARD',
      amex: 'AMEX',
      discover: 'DISCOVER'
    };
    if (detectedNetwork && networkToCardType[detectedNetwork]) {
      cardType = networkToCardType[detectedNetwork];
    }

    try {
      // Create the new card automatically
      const newCard = await prisma.creditCard.create({
        data: {
          userId,
          lastFour: cardLast4,
          network: network,
          issuer: issuer,
          nickname: `Auto-detected Card (${cardLast4})`,
          cardType: cardType,
          protectionDays: protectionDays,
          claimMethod: 'EMAIL',
          autoClaimEnabled: true
        }
      });

      logger.info(`Auto-created card: ${newCard.id} - ${issuer} ending ${cardLast4} with ${protectionDays} days protection`);

      // Notify user about the new card
      await prisma.notification.create({
        data: {
          userId,
          type: 'SYSTEM',
          title: 'New Card Auto-Detected',
          message: `We detected a new card ending in ${cardLast4}${detectedNetwork ? ` (${issuer})` : ''}. It has been automatically added with ${protectionDays} days of price protection. You can edit it in Credit Cards settings.`,
          data: { creditCardId: newCard.id }
        }
      });

      return newCard;
    } catch (error) {
      logger.error(`Failed to auto-create card: ${error.message}`);
      return null;
    }
  }

    /**
   * Re-scan existing purchases to detect and link cards
   * @param {string} userId
   * @param {Array} purchases - Array of {id, sourceEmailId, productName, retailer}
   */
  async rescanPurchasesForCards(userId, purchases) {
    let cardsCreated = 0;
    let purchasesLinked = 0;

    try {
      const gmail = await this.getGmailClient(userId);

      for (const purchase of purchases) {
        try {
          if (!purchase.sourceEmailId) continue;

          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: purchase.sourceEmailId,
            format: 'raw'
          });

          const rawEmail = Buffer.from(fullMessage.data.raw, 'base64').toString('utf-8');
          const parsed = await simpleParser(rawEmail);

          const body = parsed.text || parsed.html || '';
          const subject = parsed.subject || '';
          const fullText = `${subject} ${body}`;

          const cardLast4 = this.extractCardLast4(fullText);

          if (cardLast4) {
            const card = await this.matchCardToUser(userId, cardLast4, fullText);

            if (card) {
              // Get the purchase to use its purchaseDate for protection calculation
              const fullPurchase = await prisma.purchase.findUnique({ where: { id: purchase.id } });
              const purchaseDate = fullPurchase?.purchaseDate || new Date();
              const protectionEnds = new Date(purchaseDate.getTime() + (card.protectionDays * 24 * 60 * 60 * 1000));

              await prisma.purchase.update({
                where: { id: purchase.id },
                data: {
                  creditCardId: card.id,
                  protectionEnds: protectionEnds
                }
              });
              purchasesLinked++;

              if (card.nickname && card.nickname.includes('Auto-detected')) {
                cardsCreated++;
              }

              logger.info(`Linked purchase ${purchase.id} (${purchase.productName}) to card ${card.id} (${card.lastFour})`);
            }
          }
        } catch (emailError) {
          logger.warn(`Failed to rescan email for purchase ${purchase.id}: ${emailError.message}`);
        }
      }

      if (purchasesLinked > 0 || cardsCreated > 0) {
        await prisma.notification.create({
          data: {
            userId,
            type: 'SYSTEM',
            title: 'Card Detection Complete',
            message: `Card detection completed: ${cardsCreated} new card(s) detected, ${purchasesLinked} purchase(s) linked to cards.`,
            data: { cardsCreated, purchasesLinked }
          }
        });
      }

      logger.info(`Card rescan completed for user ${userId}: ${cardsCreated} cards created, ${purchasesLinked} purchases linked`);

      return { cardsCreated, purchasesLinked };
    } catch (error) {
      logger.error(`Card rescan failed for user ${userId}: ${error.message}`);
      throw error;
    }
  }

}

module.exports = new EmailParser();
