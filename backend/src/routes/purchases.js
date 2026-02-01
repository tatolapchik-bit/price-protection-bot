const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, query, validationResult } = require('express-validator');
const { authenticate, optionalSubscription } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const priceMonitorService = require('../services/priceMonitor');

const router = express.Router();
const prisma = new PrismaClient();

// Get all purchases
router.get('/', authenticate, optionalSubscription, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const where = { userId: req.user.id };
    if (status) {
      where.status = status;
    }

    const [purchases, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: {
          creditCard: {
            select: { nickname: true, issuer: true, lastFour: true }
          },
          priceHistory: {
            orderBy: { checkedAt: 'desc' },
            take: 5
          },
          _count: {
            select: { claims: true }
          }
        },
        orderBy: { purchaseDate: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.purchase.count({ where })
    ]);

    res.json({
      purchases,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get purchase by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const purchase = await prisma.purchase.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        creditCard: true,
        priceHistory: {
          orderBy: { checkedAt: 'desc' }
        },
        claims: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!purchase) {
      throw new AppError('Purchase not found', 404);
    }

    res.json(purchase);
  } catch (error) {
    next(error);
  }
});

// Add purchase manually
router.post('/', authenticate, [
  body('productName').trim().notEmpty(),
  body('retailer').trim().notEmpty(),
  body('purchasePrice').isFloat({ min: 0.01 }),
  body('purchaseDate').isISO8601(),
  body('productUrl').optional().isURL(),
  body('creditCardId').optional().isUUID(),
  body('retailerOrderId').optional().trim(),
  body('category').optional().trim(),
  body('imageUrl').optional().isURL()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed: ' + errors.array().map(e => e.msg).join(', '), 400);
    }

    const {
      productName,
      retailer,
      purchasePrice,
      purchaseDate,
      productUrl,
      creditCardId,
      retailerOrderId,
      category,
      imageUrl
    } = req.body;

    // Verify credit card belongs to user if provided
    if (creditCardId) {
      const card = await prisma.creditCard.findFirst({
        where: { id: creditCardId, userId: req.user.id }
      });
      if (!card) {
        throw new AppError('Credit card not found', 404);
      }
    }

    // Calculate protection end date
    let protectionEnds = null;
    if (creditCardId) {
      const card = await prisma.creditCard.findUnique({ where: { id: creditCardId } });
      protectionEnds = new Date(purchaseDate);
      protectionEnds.setDate(protectionEnds.getDate() + card.protectionDays);
    }

    const purchase = await prisma.purchase.create({
      data: {
        userId: req.user.id,
        productName,
        retailer,
        purchasePrice,
        currentPrice: purchasePrice,
        lowestPrice: purchasePrice,
        lowestPriceDate: new Date(purchaseDate),
        purchaseDate: new Date(purchaseDate),
        protectionEnds,
        productUrl,
        creditCardId,
        retailerOrderId,
        category,
        imageUrl,
        sourceType: 'MANUAL',
        status: 'MONITORING'
      },
      include: {
        creditCard: {
          select: { nickname: true, issuer: true, lastFour: true }
        }
      }
    });

    // Create initial price history entry
    await prisma.priceHistory.create({
      data: {
        purchaseId: purchase.id,
        price: purchasePrice,
        source: retailer
      }
    });

    // Trigger initial price check if URL provided
    if (productUrl) {
      priceMonitorService.checkPriceForPurchase(purchase.id).catch(console.error);
    }

    res.status(201).json(purchase);
  } catch (error) {
    next(error);
  }
});

// Update purchase
router.patch('/:id', authenticate, [
  body('productName').optional().trim().notEmpty(),
  body('productUrl').optional().isURL(),
  body('creditCardId').optional().isUUID(),
  body('category').optional().trim()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    // Verify ownership
    const existing = await prisma.purchase.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      throw new AppError('Purchase not found', 404);
    }

    const { productName, productUrl, creditCardId, category } = req.body;

    // Recalculate protection end if credit card changes
    let protectionEnds = existing.protectionEnds;
    if (creditCardId && creditCardId !== existing.creditCardId) {
      const card = await prisma.creditCard.findFirst({
        where: { id: creditCardId, userId: req.user.id }
      });
      if (!card) {
        throw new AppError('Credit card not found', 404);
      }
      protectionEnds = new Date(existing.purchaseDate);
      protectionEnds.setDate(protectionEnds.getDate() + card.protectionDays);
    }

    const purchase = await prisma.purchase.update({
      where: { id: req.params.id },
      data: {
        ...(productName && { productName }),
        ...(productUrl && { productUrl }),
        ...(creditCardId && { creditCardId, protectionEnds }),
        ...(category && { category })
      },
      include: {
        creditCard: {
          select: { nickname: true, issuer: true, lastFour: true }
        }
      }
    });

    res.json(purchase);
  } catch (error) {
    next(error);
  }
});

// Delete purchase
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.purchase.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      throw new AppError('Purchase not found', 404);
    }

    await prisma.purchase.delete({ where: { id: req.params.id } });

    res.json({ message: 'Purchase deleted' });
  } catch (error) {
    next(error);
  }
});

// Manually trigger price check
router.post('/:id/check-price', authenticate, async (req, res, next) => {
  try {
    const purchase = await prisma.purchase.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!purchase) {
      throw new AppError('Purchase not found', 404);
    }

    if (!purchase.productUrl) {
      throw new AppError('No product URL available for price checking', 400);
    }

    const result = await priceMonitorService.checkPriceForPurchase(purchase.id);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get price history for purchase
router.get('/:id/price-history', authenticate, async (req, res, next) => {
  try {
    const purchase = await prisma.purchase.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!purchase) {
      throw new AppError('Purchase not found', 404);
    }

    const priceHistory = await prisma.priceHistory.findMany({
      where: { purchaseId: req.params.id },
      orderBy: { checkedAt: 'asc' }
    });

    res.json(priceHistory);
  } catch (error) {
    next(error);
  }
});

// DEV ONLY: Manually set price for testing (simulate price drop)
router.post('/:id/simulate-price-drop', authenticate, async (req, res, next) => {
  try {
    const { newPrice } = req.body;

    if (!newPrice || newPrice <= 0) {
      throw new AppError('Valid newPrice is required', 400);
    }

    const purchase = await prisma.purchase.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { user: true }
    });

    if (!purchase) {
      throw new AppError('Purchase not found', 404);
    }

    const priceDrop = purchase.purchasePrice - newPrice;
    const priceDropPercent = (priceDrop / purchase.purchasePrice) * 100;
    const meetsThreshold = priceDrop >= (purchase.user?.priceDropThreshold || 5);

    // Update purchase with new price
    const updated = await prisma.purchase.update({
      where: { id: req.params.id },
      data: {
        currentPrice: newPrice,
        lowestPrice: newPrice,
        lowestPriceDate: new Date(),
        status: meetsThreshold ? 'PRICE_DROP_DETECTED' : 'MONITORING'
      }
    });

    // Create price history entry
    await prisma.priceHistory.create({
      data: {
        purchaseId: purchase.id,
        price: newPrice,
        source: 'manual_simulation'
      }
    });

    // Create notification if significant drop
    if (meetsThreshold) {
      await prisma.notification.create({
        data: {
          userId: purchase.userId,
          type: 'PRICE_DROP',
          title: 'Price Drop Detected! 💰',
          message: `${purchase.productName} dropped by $${priceDrop.toFixed(2)} (${priceDropPercent.toFixed(1)}%)`,
          data: {
            purchaseId: purchase.id,
            priceDrop,
            priceDropPercent,
            newPrice
          }
        }
      });
    }

    res.json({
      success: true,
      purchasePrice: purchase.purchasePrice,
      currentPrice: newPrice,
      priceDrop: priceDrop.toFixed(2),
      priceDropPercent: priceDropPercent.toFixed(1),
      status: updated.status
    });
  } catch (error) {
    next(error);
  }
});

// Get dashboard stats
router.get('/stats/dashboard', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [
      totalPurchases,
      monitoringCount,
      priceDropCount,
      totalClaims,
      approvedClaims,
      pendingClaims
    ] = await Promise.all([
      prisma.purchase.count({ where: { userId } }),
      prisma.purchase.count({ where: { userId, status: 'MONITORING' } }),
      prisma.purchase.count({
        where: {
          userId,
          status: { in: ['PRICE_DROP_DETECTED', 'CLAIM_ELIGIBLE'] }
        }
      }),
      prisma.claim.count({ where: { userId } }),
      prisma.claim.aggregate({
        where: { userId, status: 'APPROVED' },
        _sum: { approvedAmount: true },
        _count: true
      }),
      prisma.claim.count({
        where: { userId, status: { in: ['FILED', 'PENDING_REVIEW'] } }
      })
    ]);

    // Calculate potential savings
    const potentialSavings = await prisma.purchase.aggregate({
      where: {
        userId,
        status: { in: ['PRICE_DROP_DETECTED', 'CLAIM_ELIGIBLE'] }
      },
      _sum: {
        purchasePrice: true
      }
    });

    const currentPrices = await prisma.purchase.findMany({
      where: {
        userId,
        status: { in: ['PRICE_DROP_DETECTED', 'CLAIM_ELIGIBLE'] }
      },
      select: { purchasePrice: true, lowestPrice: true }
    });

    const totalPotentialSavings = currentPrices.reduce((sum, p) => {
      return sum + (p.purchasePrice - (p.lowestPrice || p.purchasePrice));
    }, 0);

    res.json({
      purchases: {
        total: totalPurchases,
        monitoring: monitoringCount,
        priceDrops: priceDropCount
      },
      claims: {
        total: totalClaims,
        approved: approvedClaims._count,
        pending: pendingClaims,
        totalRecovered: approvedClaims._sum.approvedAmount || 0
      },
      potentialSavings: totalPotentialSavings
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
