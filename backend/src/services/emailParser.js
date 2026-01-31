const { google } = require('googleapis');
const { simpleParser } = require('mailparser');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { parseEmailWithAI, isLikelyPurchase, generatePriceCheckUrl } = require('./aiParser');

const prisma = new PrismaClient();

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

      // Broader query to catch more purchase emails - AI will filter
      const query = `(subject:order OR subject:confirmation OR subject:receipt OR subject:shipped OR subject:invoice OR subject:"thank you for your purchase") newer_than:90d`;

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

          // Prepare email data for processing
          const emailData = {
            subject: parsed.subject || '',
            from: parsed.from?.value?.[0]?.address || '',
            date: parsed.date || new Date(),
            textContent: parsed.text || '',
            htmlContent: parsed.html || ''
          };

          // Quick pre-filter check
          if (!isLikelyPurchase(emailData)) {
            continue;
          }

          emailsProcessed++;

          // Try to extract purchase info using AI
          const purchase = await this.extractPurchaseWithAI(emailData, userId, message.id);

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

  async extractPurchaseWithAI(emailData, userId, emailId) {
    // Check if already processed
    const existing = await prisma.purchase.findFirst({
      where: {
        userId,
        sourceEmailId: emailId
      }
    });

    if (existing) {
      logger.info(`Email ${emailId} already processed, skipping`);
      return null;
    }

    // Use AI to parse the email
    const aiResult = await parseEmailWithAI(emailData);

    if (!aiResult.isPurchase) {
      logger.info(`Email not a purchase: ${aiResult.reason}`, { subject: emailData.subject });
      return null;
    }

    // Process each item in the purchase
    const purchases = [];

    for (const item of aiResult.items || []) {
      // Skip items without valid data
      if (!item.productName || item.price <= 0) {
        continue;
      }

      // Parse purchase date
      let purchaseDate;
      try {
        purchaseDate = aiResult.purchaseDate
          ? new Date(aiResult.purchaseDate)
          : (emailData.date || new Date());
      } catch {
        purchaseDate = emailData.date || new Date();
      }

      // Generate price check URL if product URL not provided
      const productUrl = item.productUrl || generatePriceCheckUrl(item.productName, aiResult.retailer);

      // Create purchase record
      const purchase = await prisma.purchase.create({
        data: {
          userId,
          productName: item.productName,
          retailer: aiResult.retailer || 'Unknown',
          purchasePrice: item.price,
          currentPrice: item.price,
          lowestPrice: item.price,
          lowestPriceDate: purchaseDate,
          purchaseDate: purchaseDate,
          retailerOrderId: aiResult.orderId,
          productUrl: productUrl,
          category: aiResult.category || 'other',
          sourceType: 'EMAIL',
          sourceEmailId: emailId,
          status: 'MONITORING'
        }
      });

      // Create initial price history
      await prisma.priceHistory.create({
        data: {
          purchaseId: purchase.id,
          price: item.price,
          source: aiResult.retailer || 'unknown'
        }
      });

      // Create notification
      await prisma.notification.create({
        data: {
          userId,
          type: 'SYSTEM',
          title: 'New Purchase Detected',
          message: `Found: ${item.productName} from ${aiResult.retailer || 'unknown store'} for $${item.price.toFixed(2)}`,
          data: { purchaseId: purchase.id }
        }
      });

      logger.info(`Created purchase from email: ${purchase.id} - ${item.productName} from ${aiResult.retailer}`);

      purchases.push(purchase);
    }

    return purchases.length > 0 ? purchases : null;
  }
}

module.exports = new EmailParser();
