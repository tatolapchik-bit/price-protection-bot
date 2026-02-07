/**
 * Admin routes – one-time data-fix endpoints.
 * Protected by a simple secret key (ADMIN_SECRET env var or fallback).
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const { simpleParser } = require('mailparser');
const logger = require('../utils/logger');
const autoClaimFiler = require('../services/autoClaimFiler');
const emailParser = require('../services/emailParser');

const router = express.Router();
const prisma = new PrismaClient();

// Simple admin auth via secret key in header
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  const expected = process.env.ADMIN_SECRET || 'fix-my-claims-2026';
  if (secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── GET /api/admin/diagnose ─────────────────────────────────────────────────
// Show all claims, their linked cards, and source emails to diagnose issues.
router.get('/diagnose', adminAuth, async (req, res, next) => {
  try {
    // Get all claims with their purchases and cards
    const claims = await prisma.claim.findMany({
      include: {
        purchase: {
          select: {
            id: true,
            productName: true,
            retailer: true,
            purchasePrice: true,
            currentPrice: true,
            lowestPrice: true,
            status: true,
            sourceEmailId: true,
            paymentCardLast4: true,
            creditCardId: true,
            protectionEnds: true,
            productUrl: true,
          }
        },
        creditCard: {
          select: {
            id: true,
            nickname: true,
            issuer: true,
            lastFour: true,
            network: true,
            cardType: true,
            autoClaimEnabled: true,
          }
        },
        user: {
          select: { id: true, email: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get all credit cards
    const allCards = await prisma.creditCard.findMany({
      select: {
        id: true,
        nickname: true,
        issuer: true,
        lastFour: true,
        network: true,
        cardType: true,
        autoClaimEnabled: true,
        userId: true,
      }
    });

    // Get all purchases
    const allPurchases = await prisma.purchase.findMany({
      select: {
        id: true,
        productName: true,
        retailer: true,
        purchasePrice: true,
        status: true,
        creditCardId: true,
        sourceEmailId: true,
        paymentCardLast4: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      claims,
      allCards,
      allPurchases,
      summary: {
        totalClaims: claims.length,
        totalCards: allCards.length,
        totalPurchases: allPurchases.length,
        purchasesWithoutCards: allPurchases.filter(p => !p.creditCardId).length,
      }
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/admin/email-content/:sourceEmailId ─────────────────────────────
// Try to find the stored email body for a purchase
router.get('/email-content/:purchaseId', adminAuth, async (req, res, next) => {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.purchaseId },
      select: { sourceEmailId: true, retailer: true, productName: true }
    });
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    // Check if there's a stored email
    const email = purchase.sourceEmailId
      ? await prisma.email.findUnique({ where: { id: purchase.sourceEmailId } }).catch(() => null)
      : null;

    res.json({ purchase, email: email || 'No stored email found' });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/fix-card ────────────────────────────────────────────────
// Update a credit card's issuer/network info
router.post('/fix-card', adminAuth, async (req, res, next) => {
  try {
    const { cardId, issuer, network, cardType, nickname, cardName } = req.body;

    if (!cardId) {
      return res.status(400).json({ error: 'cardId is required' });
    }

    const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const updateData = {};
    if (issuer) updateData.issuer = issuer;
    if (network) updateData.network = network;
    if (cardType) updateData.cardType = cardType;
    if (nickname) updateData.nickname = nickname;
    if (cardName) updateData.cardName = cardName;

    const updated = await prisma.creditCard.update({
      where: { id: cardId },
      data: updateData
    });

    logger.info(`[Admin] Fixed card ${cardId}: ${JSON.stringify(updateData)}`);
    res.json({ success: true, card: updated });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/fix-and-file/:claimId ───────────────────────────────────
// Fix the card info on a claim and re-file it
router.post('/fix-and-file/:claimId', adminAuth, async (req, res, next) => {
  try {
    const { claimId } = req.params;
    const { issuer, network, cardType, nickname } = req.body;

    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        creditCard: true,
        purchase: true,
        user: true,
      }
    });

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    // Step 1: Fix the card if new issuer info provided
    if (issuer && claim.creditCardId) {
      const cardUpdateData = {};
      if (issuer) cardUpdateData.issuer = issuer;
      if (network) cardUpdateData.network = network;
      if (cardType) cardUpdateData.cardType = cardType;
      if (nickname) cardUpdateData.nickname = nickname;

      await prisma.creditCard.update({
        where: { id: claim.creditCardId },
        data: cardUpdateData
      });
      logger.info(`[Admin] Updated card ${claim.creditCardId}: ${JSON.stringify(cardUpdateData)}`);
    }

    // Step 2: Reset claim status so autoFileClaim can run
    await prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'READY_TO_FILE',
        claimEmailSentAt: null,
        claimEmailMessageId: null,
        claimEmailTo: null,
        claimEmailSubject: null,
        claimEmailBody: null,
        claimEmailScreenshot: null,
        filedAt: null,
      }
    });

    // Step 3: Auto-file with correct issuer
    logger.info(`[Admin] Filing claim ${claimId}...`);
    const result = await autoClaimFiler.autoFileClaim(claimId);

    res.json({
      success: result.success,
      message: result.message,
      sentTo: result.sentTo,
      messageId: result.messageId,
      method: result.method,
    });

  } catch (error) {
    logger.error(`[Admin] fix-and-file error: ${error.message}`);
    next(error);
  }
});

// ── POST /api/admin/refile/:claimId ─────────────────────────────────────────
// Just re-file a claim (no card changes)
router.post('/refile/:claimId', adminAuth, async (req, res, next) => {
  try {
    const { claimId } = req.params;

    // Reset status
    await prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'READY_TO_FILE',
        claimEmailSentAt: null,
        claimEmailMessageId: null,
      }
    });

    const result = await autoClaimFiler.autoFileClaim(claimId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/admin/read-email/:purchaseId ───────────────────────────────────
// Fetch the actual Gmail message for a purchase and re-detect the card
router.get('/read-email/:purchaseId', adminAuth, async (req, res, next) => {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.purchaseId },
      include: { user: true }
    });
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    if (!purchase.sourceEmailId) {
      return res.json({ error: 'No source email ID for this purchase' });
    }

    // Get Gmail client using user's OAuth tokens
    const user = await prisma.user.findUnique({
      where: { id: purchase.userId },
      select: { gmailAccessToken: true, gmailRefreshToken: true }
    });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: user.gmailAccessToken,
      refresh_token: user.gmailRefreshToken
    });
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await prisma.user.update({
          where: { id: purchase.userId },
          data: { gmailAccessToken: tokens.access_token }
        });
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch the email
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

    // Re-detect card info with new algorithm
    const cardInfo = emailParser.extractCardInfo(fullText);
    const detectedNetwork = emailParser.detectCardNetwork(fullText, cardInfo.last4);

    // Show payment-related lines for diagnosis
    const paymentLines = fullText.split(/[\n\r]+/).filter(line =>
      /(?:card|payment|charged|ending|credit|debit|paid|billing|visa|mastercard|amex|discover|chase)/i.test(line)
    ).slice(0, 20);

    res.json({
      purchaseId: purchase.id,
      productName: purchase.productName,
      retailer: purchase.retailer,
      sourceEmailId: purchase.sourceEmailId,
      emailSubject: subject,
      emailFrom: parsed.from?.text || '',
      emailDate: parsed.date,
      detection: {
        cardInfo,
        detectedNetwork,
        currentCardLast4: purchase.paymentCardLast4,
      },
      paymentLines,
      // First 2000 chars of body for context
      bodyPreview: body.substring(0, 2000),
    });

  } catch (error) {
    logger.error(`[Admin] read-email error: ${error.message}`);
    next(error);
  }
});

// ── POST /api/admin/rescan-and-fix/:purchaseId ──────────────────────────────
// Re-read email, detect correct card, fix records, re-file any claims
router.post('/rescan-and-fix/:purchaseId', adminAuth, async (req, res, next) => {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.purchaseId },
      include: {
        user: true,
        claims: true,
      }
    });
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    if (!purchase.sourceEmailId) {
      return res.json({ error: 'No source email ID for this purchase' });
    }

    // Get Gmail client
    const user = await prisma.user.findUnique({
      where: { id: purchase.userId },
      select: { id: true, gmailAccessToken: true, gmailRefreshToken: true }
    });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: user.gmailAccessToken,
      refresh_token: user.gmailRefreshToken
    });
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await prisma.user.update({
          where: { id: purchase.userId },
          data: { gmailAccessToken: tokens.access_token }
        });
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch the email
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

    // Re-detect card info with new proximity-based algorithm
    const cardInfo = emailParser.extractCardInfo(fullText);
    const detectedNetwork = emailParser.detectCardNetwork(fullText, cardInfo.last4);

    logger.info(`[Admin] Re-detected: last4=${cardInfo.last4}, networkHint=${cardInfo.networkHint}, detectedNetwork=${detectedNetwork}`);

    // Try to match to user's existing cards
    const matchedCard = await emailParser.matchCardToUser(user.id, cardInfo.last4, fullText, cardInfo.networkHint);

    const actions = [];

    if (matchedCard) {
      // Link purchase to correct card
      const protectionEnds = new Date(purchase.purchaseDate.getTime() + (matchedCard.protectionDays * 24 * 60 * 60 * 1000));
      await prisma.purchase.update({
        where: { id: purchase.id },
        data: {
          creditCardId: matchedCard.id,
          paymentCardLast4: cardInfo.last4 || purchase.paymentCardLast4,
          protectionEnds,
        }
      });
      actions.push(`Linked purchase to card: ${matchedCard.nickname} (${matchedCard.issuer} ending ${matchedCard.lastFour})`);

      // Update any claims on this purchase
      for (const claim of purchase.claims) {
        await prisma.claim.update({
          where: { id: claim.id },
          data: { creditCardId: matchedCard.id }
        });
        actions.push(`Updated claim ${claim.id} to use card ${matchedCard.id}`);

        // If the claim was stuck at READY_TO_FILE, re-file it
        if (['DRAFT', 'READY_TO_FILE'].includes(claim.status)) {
          await prisma.claim.update({
            where: { id: claim.id },
            data: {
              status: 'READY_TO_FILE',
              claimEmailSentAt: null,
              claimEmailMessageId: null,
              claimEmailTo: null,
              claimEmailSubject: null,
              claimEmailBody: null,
              claimEmailScreenshot: null,
              filedAt: null,
            }
          });

          const result = await autoClaimFiler.autoFileClaim(claim.id);
          actions.push(`Auto-filed claim ${claim.id}: ${result.success ? 'SUCCESS' : 'FAILED'} → ${result.sentTo || result.error}`);
        }
      }
    } else {
      actions.push(`No matching card found for last4=${cardInfo.last4}, network=${detectedNetwork || cardInfo.networkHint || 'unknown'}`);

      // If we detected a network, update the existing card record
      if (purchase.creditCardId && (detectedNetwork || cardInfo.networkHint)) {
        const networkName = detectedNetwork || emailParser._mapNetworkString(cardInfo.networkHint) || 'Unknown';
        await prisma.creditCard.update({
          where: { id: purchase.creditCardId },
          data: {
            issuer: networkName,
            network: networkName.toLowerCase(),
            nickname: `${networkName} ending ${cardInfo.last4 || purchase.paymentCardLast4}`,
            cardType: networkName.toUpperCase() === 'VISA' ? 'VISA'
              : networkName.toUpperCase() === 'MASTERCARD' ? 'MASTERCARD'
              : networkName.toUpperCase().includes('AMEX') ? 'AMEX'
              : networkName.toUpperCase() === 'DISCOVER' ? 'DISCOVER'
              : 'OTHER',
          }
        });
        actions.push(`Updated existing card to: ${networkName} ending ${cardInfo.last4 || purchase.paymentCardLast4}`);

        // Re-file claims with updated card
        for (const claim of purchase.claims) {
          if (['DRAFT', 'READY_TO_FILE'].includes(claim.status)) {
            await prisma.claim.update({
              where: { id: claim.id },
              data: {
                status: 'READY_TO_FILE',
                claimEmailSentAt: null,
                claimEmailMessageId: null,
                claimEmailTo: null,
                claimEmailSubject: null,
                claimEmailBody: null,
                claimEmailScreenshot: null,
                filedAt: null,
              }
            });
            const result = await autoClaimFiler.autoFileClaim(claim.id);
            actions.push(`Auto-filed claim ${claim.id}: ${result.success ? 'SUCCESS' : 'FAILED'} → ${result.sentTo || result.error}`);
          }
        }
      }
    }

    res.json({
      success: true,
      detection: {
        last4: cardInfo.last4,
        networkHint: cardInfo.networkHint,
        detectedNetwork,
        matchedCardId: matchedCard?.id || null,
        matchedCardIssuer: matchedCard?.issuer || null,
      },
      actions,
    });

  } catch (error) {
    logger.error(`[Admin] rescan-and-fix error: ${error.message}`);
    next(error);
  }
});

module.exports = router;
