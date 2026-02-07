const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { detectCardIssuer, getPriceProtectionInfo } = require('../utils/cardUtils');

const router = express.Router();
const prisma = new PrismaClient();

// Get all credit cards for user
router.get('/', authenticate, async (req, res, next) => {
  try {
    const cards = await prisma.creditCard.findMany({
      where: { userId: req.user.id },
      include: {
        _count: {
          select: { purchases: true, claims: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(cards);
  } catch (error) {
    next(error);
  }
});

// Get card issuer configurations (public)
router.get('/issuers', async (req, res, next) => {
  try {
    const issuers = await prisma.cardIssuerConfig.findMany({
      orderBy: { name: 'asc' }
    });

    res.json(issuers);
  } catch (error) {
    next(error);
  }
});

// Detect card issuer from card number
router.post('/detect', authenticate, [
  body('cardNumber').trim().notEmpty()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Card number is required', 400);
    }

    const { cardNumber } = req.body;
    const result = detectCardIssuer(cardNumber);

    if (result.error) {
      throw new AppError(result.error, 400);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Quick-add card with auto-detection
router.post('/quick-add', authenticate, [
  body('cardNumber').trim().notEmpty(),
  body('nickname').optional().trim()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Card number is required', 400);
    }

    const { cardNumber, nickname } = req.body;
    const detected = detectCardIssuer(cardNumber);

    if (detected.error || !detected.isValid) {
      throw new AppError(detected.error || 'Invalid card number', 400);
    }

    // Check for duplicate
    const existing = await prisma.creditCard.findFirst({
      where: {
        userId: req.user.id,
        lastFour: detected.lastFour,
        issuer: detected.issuer
      }
    });
    if (existing) {
      throw new AppError('A card with these details already exists', 409);
    }

    // Get price protection info
    const protection = detected.priceProtection || getPriceProtectionInfo(detected.issuer);

    const card = await prisma.creditCard.create({
      data: {
        userId: req.user.id,
        nickname: nickname || `${detected.fullName || detected.issuer} ****${detected.lastFour}`,
        issuer: detected.issuer,
        lastFour: detected.lastFour,
        cardType: detected.cardType || 'OTHER',
        network: detected.issuerKey || null,
        protectionDays: protection?.protectionDays || 60,
        maxClaimAmount: protection?.maxClaimAmount || 500,
        claimMethod: protection?.claimMethod || 'EMAIL',
        claimPortalUrl: protection?.claimPortalUrl || null,
        claimPhoneNumber: protection?.claimPhone || null,
        claimEmail: protection?.claimEmail || null,
        autoClaimEnabled: false
      }
    });

    res.status(201).json({ card, detected });
  } catch (error) {
    next(error);
  }
});

// Add credit card
router.post('/', authenticate, [
  body('nickname').trim().notEmpty(),
  body('issuer').trim().notEmpty(),
  body('lastFour').isLength({ min: 4, max: 4 }).isNumeric(),
  body('cardType').isIn(['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER']),
  body('protectionDays').optional().isInt({ min: 1, max: 365 }),
  body('maxClaimAmount').optional().isFloat({ min: 0 }),
  body('maxAnnualClaims').optional().isFloat({ min: 0 }),
  body('claimMethod').isIn(['ONLINE_PORTAL', 'PHONE', 'EMAIL', 'MAIL']),
  body('claimPortalUrl').optional().isURL(),
  body('claimPhoneNumber').optional().trim(),
  body('claimEmail').optional().isEmail()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed: ' + errors.array().map(e => e.msg).join(', '), 400);
    }

    const {
      nickname,
      issuer,
      lastFour,
      cardType,
      protectionDays = 60,
      maxClaimAmount = 500,
      maxAnnualClaims,
      claimMethod,
      claimPortalUrl,
      claimPhoneNumber,
      claimEmail
    } = req.body;

    // Check for duplicate
    const existing = await prisma.creditCard.findFirst({
      where: {
        userId: req.user.id,
        lastFour,
        issuer
      }
    });
    if (existing) {
      throw new AppError('A card with these details already exists', 409);
    }

    const card = await prisma.creditCard.create({
      data: {
        userId: req.user.id,
        nickname,
        issuer,
        lastFour,
        cardType,
        protectionDays,
        maxClaimAmount,
        maxAnnualClaims,
        claimMethod,
        claimPortalUrl,
        claimPhoneNumber,
        claimEmail
      }
    });

    res.status(201).json(card);
  } catch (error) {
    next(error);
  }
});

// Update credit card
router.patch('/:id', authenticate, [
  body('nickname').optional().trim().notEmpty(),
  body('protectionDays').optional().isInt({ min: 1, max: 365 }),
  body('maxClaimAmount').optional().isFloat({ min: 0 }),
  body('maxAnnualClaims').optional().isFloat({ min: 0 }),
  body('claimMethod').optional().isIn(['ONLINE_PORTAL', 'PHONE', 'EMAIL', 'MAIL']),
  body('claimPortalUrl').optional().isURL(),
  body('claimPhoneNumber').optional().trim(),
  body('claimEmail').optional().isEmail()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    // Verify ownership
    const existing = await prisma.creditCard.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      throw new AppError('Credit card not found', 404);
    }

    const card = await prisma.creditCard.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json(card);
  } catch (error) {
    next(error);
  }
});

// Delete credit card
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.creditCard.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      throw new AppError('Credit card not found', 404);
    }

    // Check if card has any claims
    const claimsCount = await prisma.claim.count({
      where: { creditCardId: req.params.id }
    });
    if (claimsCount > 0) {
      throw new AppError('Cannot delete card with existing claims', 400);
    }

    await prisma.creditCard.delete({ where: { id: req.params.id } });

    res.json({ message: 'Credit card deleted' });
  } catch (error) {
    next(error);
  }
});

// Get card statistics
router.get('/:id/stats', authenticate, async (req, res, next) => {
  try {
    const card = await prisma.creditCard.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!card) {
      throw new AppError('Credit card not found', 404);
    }

    const yearStart = new Date();
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);

    const [
      totalPurchases,
      activePurchases,
      totalClaims,
      approvedThisYear
    ] = await Promise.all([
      prisma.purchase.count({ where: { creditCardId: req.params.id } }),
      prisma.purchase.count({
        where: {
          creditCardId: req.params.id,
          status: { in: ['MONITORING', 'PRICE_DROP_DETECTED', 'CLAIM_ELIGIBLE'] },
          protectionEnds: { gte: new Date() }
        }
      }),
      prisma.claim.count({ where: { creditCardId: req.params.id } }),
      prisma.claim.aggregate({
        where: {
          creditCardId: req.params.id,
          status: 'APPROVED',
          resolvedAt: { gte: yearStart }
        },
        _sum: { approvedAmount: true }
      })
    ]);

    const remainingAnnualLimit = card.maxAnnualClaims
      ? card.maxAnnualClaims - (approvedThisYear._sum.approvedAmount || 0)
      : null;

    res.json({
      totalPurchases,
      activePurchases,
      totalClaims,
      approvedThisYear: approvedThisYear._sum.approvedAmount || 0,
      remainingAnnualLimit,
      protectionDays: card.protectionDays,
      maxClaimAmount: card.maxClaimAmount
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
