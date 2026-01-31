const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireSubscription } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const emailParser = require('../services/emailParser');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

// Get Gmail connection status
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        gmailConnected: true,
        email: true
      }
    });

    // Get last sync info
    const lastSync = await prisma.emailSyncLog.findFirst({
      where: { userId: req.user.id },
      orderBy: { startedAt: 'desc' }
    });

    res.json({
      connected: user.gmailConnected,
      email: user.email,
      lastSync: lastSync ? {
        status: lastSync.status,
        date: lastSync.completedAt || lastSync.startedAt,
        emailsProcessed: lastSync.emailsProcessed,
        purchasesFound: lastSync.purchasesFound
      } : null
    });
  } catch (error) {
    next(error);
  }
});

// Trigger email sync
router.post('/sync', authenticate, requireSubscription, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user.gmailConnected) {
      throw new AppError('Gmail not connected', 400);
    }

    // Check for existing sync in progress
    const existingSync = await prisma.emailSyncLog.findFirst({
      where: {
        userId: req.user.id,
        status: 'IN_PROGRESS'
      }
    });

    if (existingSync) {
      throw new AppError('Sync already in progress', 409);
    }

    // Create sync log
    const syncLog = await prisma.emailSyncLog.create({
      data: {
        userId: req.user.id,
        status: 'IN_PROGRESS'
      }
    });

    // Start async sync (don't wait)
    emailParser.syncEmails(user.id, syncLog.id)
      .catch(err => logger.error('Email sync failed', err));

    res.json({
      message: 'Email sync started',
      syncId: syncLog.id
    });
  } catch (error) {
    next(error);
  }
});

// Get sync status
router.get('/sync/:syncId', authenticate, async (req, res, next) => {
  try {
    const syncLog = await prisma.emailSyncLog.findFirst({
      where: {
        id: req.params.syncId,
        userId: req.user.id
      }
    });

    if (!syncLog) {
      throw new AppError('Sync not found', 404);
    }

    res.json(syncLog);
  } catch (error) {
    next(error);
  }
});

// Get sync history
router.get('/sync-history', authenticate, async (req, res, next) => {
  try {
    const syncs = await prisma.emailSyncLog.findMany({
      where: { userId: req.user.id },
      orderBy: { startedAt: 'desc' },
      take: 10
    });

    res.json(syncs);
  } catch (error) {
    next(error);
  }
});

// Get supported retailers
router.get('/retailers', async (req, res, next) => {
  try {
    const retailers = await prisma.retailerConfig.findMany({
      select: {
        id: true,
        name: true,
        domain: true,
        logoUrl: true,
        priceCheckEnabled: true
      },
      orderBy: { name: 'asc' }
    });

    res.json(retailers);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
