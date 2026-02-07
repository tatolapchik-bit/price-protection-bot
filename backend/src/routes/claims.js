const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { authenticate, requireSubscription } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const claimService = require('../services/claimService');
const autoClaimFiler = require('../services/autoClaimFiler');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();
const prisma = new PrismaClient();

// Get all claims
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const where = { userId: req.user.id };
    if (status) {
      where.status = status;
    }

    const [claims, total] = await Promise.all([
      prisma.claim.findMany({
        where,
        include: {
          purchase: {
            select: {
              productName: true,
              retailer: true,
              imageUrl: true,
              productUrl: true
            }
          },
          creditCard: {
            select: { nickname: true, issuer: true, lastFour: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.claim.count({ where })
    ]);

    res.json({
      claims,
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

// Get claim by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        purchase: {
          include: {
            priceHistory: {
              orderBy: { checkedAt: 'desc' },
              take: 10
            }
          }
        },
        creditCard: true
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    res.json(claim);
  } catch (error) {
    next(error);
  }
});

// Create claim from eligible purchase
router.post('/', authenticate, [
  body('purchaseId').isUUID()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { purchaseId } = req.body;

    // Verify purchase ownership and eligibility
    const purchase = await prisma.purchase.findFirst({
      where: {
        id: purchaseId,
        userId: req.user.id
      },
      include: { creditCard: true }
    });

    if (!purchase) {
      throw new AppError('Purchase not found', 404);
    }

    if (!purchase.creditCardId) {
      throw new AppError('Purchase must be linked to a credit card', 400);
    }

    if (!['PRICE_DROP_DETECTED', 'CLAIM_ELIGIBLE'].includes(purchase.status)) {
      throw new AppError('Purchase is not eligible for a claim', 400);
    }

    if (purchase.protectionEnds && purchase.protectionEnds < new Date()) {
      throw new AppError('Price protection period has expired', 400);
    }

    // Calculate price difference
    const priceDifference = purchase.purchasePrice - purchase.lowestPrice;
    if (priceDifference <= 0) {
      throw new AppError('No price drop detected', 400);
    }

    // Check max claim amount
    if (priceDifference > purchase.creditCard.maxClaimAmount) {
      // Still create claim but cap at max
    }

    // Check if claim already exists for this purchase
    const existingClaim = await prisma.claim.findFirst({
      where: {
        purchaseId,
        status: { notIn: ['DENIED', 'EXPIRED'] }
      }
    });

    if (existingClaim) {
      throw new AppError('A claim already exists for this purchase', 409);
    }

    // Create the claim
    const claim = await prisma.claim.create({
      data: {
        userId: req.user.id,
        purchaseId,
        creditCardId: purchase.creditCardId,
        originalPrice: purchase.purchasePrice,
        newPrice: purchase.lowestPrice,
        priceDifference: Math.min(priceDifference, purchase.creditCard.maxClaimAmount),
        status: 'DRAFT'
      },
      include: {
        purchase: {
          select: { productName: true, retailer: true, imageUrl: true }
        },
        creditCard: {
          select: { nickname: true, issuer: true, claimMethod: true }
        }
      }
    });

    // Update purchase status
    await prisma.purchase.update({
      where: { id: purchaseId },
      data: { status: 'CLAIM_ELIGIBLE' }
    });

    res.status(201).json(claim);
  } catch (error) {
    next(error);
  }
});

// Generate claim documentation
router.post('/:id/generate-docs', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        purchase: true,
        creditCard: true
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    // Generate documentation
    const docUrl = await claimService.generateClaimDocumentation(claim);

    // Update claim with doc URL
    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        proofDocumentUrl: docUrl,
        status: 'READY_TO_FILE'
      }
    });

    res.json({ documentUrl: docUrl });
  } catch (error) {
    next(error);
  }
});

// Mark claim as filed
router.post('/:id/file', authenticate, [
  body('claimNumber').optional().trim()
], async (req, res, next) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: { creditCard: true }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    if (!['DRAFT', 'READY_TO_FILE'].includes(claim.status)) {
      throw new AppError('Claim cannot be filed in current status', 400);
    }

    const { claimNumber } = req.body;

    const updatedClaim = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: 'FILED',
        filedAt: new Date(),
        ...(claimNumber && { claimNumber })
      }
    });

    // Update purchase status
    await prisma.purchase.update({
      where: { id: claim.purchaseId },
      data: { status: 'CLAIM_FILED' }
    });

    // Send notification
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'CLAIM_STATUS_UPDATE',
        title: 'Claim Filed Successfully',
        message: `Your claim for ${claim.purchase?.productName || 'item'} has been filed.`,
        data: { claimId: claim.id }
      }
    });

    res.json(updatedClaim);
  } catch (error) {
    next(error);
  }
});

// Update claim status (for tracking resolution)
router.patch('/:id/status', authenticate, [
  body('status').isIn(['PENDING_REVIEW', 'ADDITIONAL_INFO_NEEDED', 'APPROVED', 'DENIED', 'MONEY_RECEIVED']),
  body('claimNumber').optional().trim(),
  body('approvedAmount').optional().isFloat({ min: 0 }),
  body('responseNotes').optional().trim()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    const { status, claimNumber, approvedAmount, responseNotes } = req.body;

    const updateData = {
      status,
      ...(claimNumber && { claimNumber }),
      ...(responseNotes && { responseNotes })
    };

    if (status === 'APPROVED') {
      updateData.resolvedAt = new Date();
      updateData.approvedAmount = approvedAmount || claim.priceDifference;

      // Update purchase status
      await prisma.purchase.update({
        where: { id: claim.purchaseId },
        data: { status: 'CLAIM_APPROVED' }
      });
    }

    if (status === 'DENIED') {
      updateData.resolvedAt = new Date();

      // Update purchase status
      await prisma.purchase.update({
        where: { id: claim.purchaseId },
        data: { status: 'CLAIM_DENIED' }
      });
    }

    const updatedClaim = await prisma.claim.update({
      where: { id: claim.id },
      data: updateData,
      include: {
        purchase: {
          select: { productName: true }
        }
      }
    });

    // Send notification
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'CLAIM_STATUS_UPDATE',
        title: `Claim ${status === 'APPROVED' ? 'Approved!' : status === 'DENIED' ? 'Denied' : 'Updated'}`,
        message: status === 'APPROVED'
          ? `Your claim for ${updatedClaim.purchase.productName} was approved for $${approvedAmount || claim.priceDifference}!`
          : `Your claim status has been updated to: ${status.replace(/_/g, ' ')}`,
        data: { claimId: claim.id }
      }
    });

    res.json(updatedClaim);
  } catch (error) {
    next(error);
  }
});

// Delete claim (only drafts)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    if (claim.status !== 'DRAFT') {
      throw new AppError('Only draft claims can be deleted', 400);
    }

    await prisma.claim.delete({ where: { id: claim.id } });

    // Revert purchase status
    await prisma.purchase.update({
      where: { id: claim.purchaseId },
      data: { status: 'PRICE_DROP_DETECTED' }
    });

    res.json({ message: 'Claim deleted' });
  } catch (error) {
    next(error);
  }
});

// Get claim filing instructions
router.get('/:id/instructions', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        creditCard: true,
        purchase: true
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    const instructions = claimService.getFilingInstructions(claim);

    res.json(instructions);
  } catch (error) {
    next(error);
  }
});

// AUTO-FILE: Fully automated claim submission
router.post('/:id/auto-file', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    if (!['DRAFT', 'READY_TO_FILE', 'PENDING'].includes(claim.status)) {
      throw new AppError('Claim has already been filed or processed', 400);
    }

    // Trigger fully automated filing (tries portal first, falls back to email)
    const result = await autoClaimFiler.autoFileClaim(claim.id);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ── Proof endpoints ──────────────────────────────────────────────────────────

// Get all proof data for a claim (JSON response with email details + base64 files)
router.get('/:id/proof', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        purchase: { select: { productName: true, retailer: true, productUrl: true } },
        creditCard: { select: { nickname: true, issuer: true, lastFour: true } }
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    const proof = {
      claimId:          claim.id,
      status:           claim.status,
      autoFiled:        claim.autoFiled || false,
      filedAt:          claim.filedAt,
      // Email details
      emailSentTo:      claim.claimEmailTo,
      emailSubject:     claim.claimEmailSubject,
      emailBody:        claim.claimEmailBody,
      emailSentAt:      claim.claimEmailSentAt,
      emailMessageId:   claim.claimEmailMessageId,
      // File references (frontend can use /claims/:id/proof/:type to fetch)
      hasClaimPdf:       !!claim.proofDocumentUrl,
      hasPriceScreenshot: !!claim.priceScreenshotUrl,
      hasEmailProof:     !!claim.claimEmailScreenshot,
      // Metadata
      responseNotes:    claim.responseNotes,
      statusHistory:    claim.statusHistory,
    };

    res.json(proof);
  } catch (error) {
    next(error);
  }
});

// Serve a specific proof file (pdf, price-screenshot, or email-screenshot)
router.get('/:id/proof/:type', authenticate, async (req, res, next) => {
  try {
    const { type } = req.params;

    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!claim) {
      throw new AppError('Claim not found', 404);
    }

    let fileName = null;
    let contentType = 'application/octet-stream';

    switch (type) {
      case 'pdf':
        fileName = claim.proofDocumentUrl;
        contentType = 'application/pdf';
        break;
      case 'price-screenshot':
        fileName = claim.priceScreenshotUrl;
        contentType = 'image/png';
        break;
      case 'email-screenshot':
        fileName = claim.claimEmailScreenshot;
        contentType = 'image/png';
        break;
      default:
        throw new AppError('Invalid proof type. Use: pdf, price-screenshot, or email-screenshot', 400);
    }

    if (!fileName) {
      throw new AppError(`No ${type} proof available for this claim`, 404);
    }

    // The file might be a full path or just a filename
    const filePath = fileName.startsWith('/') ? fileName : path.join('/tmp', fileName);

    try {
      await fs.access(filePath);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      const fileBuffer = await fs.readFile(filePath);
      res.send(fileBuffer);
    } catch (fileErr) {
      // File not found on disk (maybe after a redeploy) — return the text-based proof instead
      if (type === 'pdf' && claim.claimEmailBody) {
        // Return a simple text response with the claim details
        res.json({
          fallback: true,
          message: 'PDF file no longer available on server. Here are the claim details:',
          emailBody: claim.claimEmailBody,
          emailSubject: claim.claimEmailSubject,
          sentTo: claim.claimEmailTo,
          sentAt: claim.claimEmailSentAt,
        });
      } else {
        throw new AppError(`Proof file no longer available on server. Claim details are still stored in the database.`, 404);
      }
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
