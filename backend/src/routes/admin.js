/**
 * Admin routes – one-time data-fix endpoints.
 * Protected by a simple secret key (ADMIN_SECRET env var or fallback).
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
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

module.exports = router;
