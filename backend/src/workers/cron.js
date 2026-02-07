const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const priceMonitor = require('../services/priceMonitor');
const emailParser = require('../services/emailParser');
const autoClaimFiler = require('../services/autoClaimFiler');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

function setupCronJobs() {
  logger.info('Setting up cron jobs...');

  // Price monitoring - every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    logger.info('Starting scheduled price check...');
    try {
      const result = await priceMonitor.checkAllEligiblePurchases();
      logger.info(`Price check completed: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error('Scheduled price check failed:', error);
    }
  });

  // Email sync for connected users - every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    logger.info('Starting scheduled email sync...');
    try {
      // Sync emails for ALL users with Gmail connected (including free tier)
      const users = await prisma.user.findMany({
        where: {
          gmailConnected: true
        },
        select: { id: true }
      });

      for (const user of users) {
        try {
          const syncLog = await prisma.emailSyncLog.create({
            data: {
              userId: user.id,
              status: 'IN_PROGRESS'
            }
          });
          await emailParser.syncEmails(user.id, syncLog.id);
        } catch (err) {
          logger.error(`Email sync failed for user ${user.id}:`, err);
        }
      }

      logger.info(`Email sync completed for ${users.length} users`);
    } catch (error) {
      logger.error('Scheduled email sync failed:', error);
    }
  });

  // Expire old purchases - daily at midnight
  cron.schedule('0 0 * * *', async () => {
    logger.info('Starting purchase expiration check...');
    try {
      const expired = await prisma.purchase.updateMany({
        where: {
          protectionEnds: { lt: new Date() },
          status: { in: ['MONITORING', 'PRICE_DROP_DETECTED', 'CLAIM_ELIGIBLE'] }
        },
        data: { status: 'EXPIRED' }
      });

      logger.info(`Marked ${expired.count} purchases as expired`);
    } catch (error) {
      logger.error('Purchase expiration check failed:', error);
    }
  });

  // Weekly summary emails - Sunday at 9am
  cron.schedule('0 9 * * 0', async () => {
    logger.info('Sending weekly summary emails...');
    try {
      const users = await prisma.user.findMany({
        where: {
          subscriptionStatus: 'ACTIVE',
          notificationEmail: { not: null }
        },
        select: { id: true }
      });

      for (const user of users) {
        try {
          await notificationService.sendWeeklySummary(user.id);
        } catch (err) {
          logger.error(`Weekly summary failed for user ${user.id}:`, err);
        }
      }

      logger.info(`Weekly summaries sent to ${users.length} users`);
    } catch (error) {
      logger.error('Weekly summary sending failed:', error);
    }
  });

  // Expire old claims - daily
  cron.schedule('0 1 * * *', async () => {
    logger.info('Checking for expired claims...');
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const expired = await prisma.claim.updateMany({
        where: {
          status: { in: ['DRAFT', 'READY_TO_FILE'] },
          createdAt: { lt: thirtyDaysAgo }
        },
        data: { status: 'EXPIRED' }
      });

      logger.info(`Marked ${expired.count} claims as expired`);
    } catch (error) {
      logger.error('Claim expiration check failed:', error);
    }
  });

  // Cleanup old notifications - weekly
  cron.schedule('0 2 * * 1', async () => {
    logger.info('Cleaning up old notifications...');
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const deleted = await prisma.notification.deleteMany({
        where: {
          read: true,
          createdAt: { lt: thirtyDaysAgo }
        }
      });

      logger.info(`Deleted ${deleted.count} old notifications`);
    } catch (error) {
      logger.error('Notification cleanup failed:', error);
    }
  });

  // Reminder for eligible claims about to expire - daily
  cron.schedule('0 10 * * *', async () => {
    logger.info('Sending claim deadline reminders...');
    try {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      const expiringPurchases = await prisma.purchase.findMany({
        where: {
          status: 'CLAIM_ELIGIBLE',
          protectionEnds: {
            gte: new Date(),
            lte: threeDaysFromNow
          }
        },
        include: { user: true }
      });

      for (const purchase of expiringPurchases) {
        // Check if we already notified about this
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: purchase.userId,
            type: 'CLAIM_ELIGIBLE',
            data: {
              path: ['purchaseId'],
              equals: purchase.id
            },
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        });

        if (!existingNotification) {
          await prisma.notification.create({
            data: {
              userId: purchase.userId,
              type: 'CLAIM_ELIGIBLE',
              title: '⚠️ Claim Deadline Approaching!',
              message: `Your price protection for ${purchase.productName} expires in ${Math.ceil((purchase.protectionEnds - new Date()) / (1000 * 60 * 60 * 24))} days. File your claim now!`,
              data: { purchaseId: purchase.id }
            }
          });
        }
      }

      logger.info(`Sent reminders for ${expiringPurchases.length} expiring claims`);
    } catch (error) {
      logger.error('Claim reminder sending failed:', error);
    }
  });

  // Retry failed auto-files - every 2 hours
  // Picks up claims that were created but failed to send (e.g., DRAFT or READY_TO_FILE with autoFiled=true)
  cron.schedule('0 */2 * * *', async () => {
    logger.info('Starting auto-file retry for stuck claims...');
    try {
      const stuckClaims = await prisma.claim.findMany({
        where: {
          autoFiled: true,
          status: { in: ['DRAFT', 'READY_TO_FILE'] },
          // Only retry claims less than 7 days old
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        },
        include: {
          purchase: { select: { protectionEnds: true, status: true } },
          creditCard: { select: { autoClaimEnabled: true } }
        }
      });

      let retried = 0;
      let succeeded = 0;

      for (const claim of stuckClaims) {
        // Only retry if card still has auto-claim enabled and protection isn't expired
        if (!claim.creditCard?.autoClaimEnabled) continue;
        if (claim.purchase?.protectionEnds && claim.purchase.protectionEnds < new Date()) continue;

        try {
          logger.info(`Retrying auto-file for claim ${claim.id}...`);
          const result = await autoClaimFiler.autoFileClaim(claim.id);
          retried++;

          if (result.success) {
            succeeded++;
            logger.info(`Auto-file retry succeeded for claim ${claim.id}`);
          } else {
            logger.warn(`Auto-file retry failed for claim ${claim.id}: ${result.error}`);
          }
        } catch (err) {
          logger.error(`Auto-file retry error for claim ${claim.id}:`, err);
        }
      }

      logger.info(`Auto-file retry completed: ${retried} retried, ${succeeded} succeeded out of ${stuckClaims.length} stuck claims`);
    } catch (error) {
      logger.error('Auto-file retry cron failed:', error);
    }
  });

  // Auto-file eligible claims that have a card but were never filed - every 3 hours
  // This catches purchases where price dropped and claim was created but auto-file wasn't triggered
  cron.schedule('30 */3 * * *', async () => {
    logger.info('Checking for unfiled eligible claims...');
    try {
      // Find purchases that are CLAIM_ELIGIBLE with a linked card but no claim yet
      const eligiblePurchases = await prisma.purchase.findMany({
        where: {
          status: { in: ['CLAIM_ELIGIBLE', 'PRICE_DROP_DETECTED'] },
          creditCardId: { not: null },
          protectionEnds: { gt: new Date() },
          // Must have a price drop
          currentPrice: { not: null }
        },
        include: {
          creditCard: { select: { id: true, autoClaimEnabled: true, maxClaimAmount: true } },
          user: { select: { id: true, priceDropThreshold: true } }
        }
      });

      let claimsCreated = 0;

      for (const purchase of eligiblePurchases) {
        if (!purchase.creditCard?.autoClaimEnabled) continue;

        const priceDrop = purchase.purchasePrice - purchase.currentPrice;
        if (priceDrop <= 0) continue;

        const threshold = purchase.user?.priceDropThreshold || 5;
        if (priceDrop < threshold) continue;

        // Check no existing active claim
        const existingClaim = await prisma.claim.findFirst({
          where: {
            purchaseId: purchase.id,
            status: { notIn: ['DENIED', 'EXPIRED'] }
          }
        });

        if (existingClaim) continue;

        try {
          // Create and auto-file the claim
          const claim = await prisma.claim.create({
            data: {
              userId: purchase.userId,
              purchaseId: purchase.id,
              creditCardId: purchase.creditCard.id,
              originalPrice: purchase.purchasePrice,
              newPrice: purchase.currentPrice,
              priceDifference: Math.min(priceDrop, purchase.creditCard.maxClaimAmount || 500),
              status: 'DRAFT',
              autoFiled: true,
              statusHistory: [
                { status: 'DRAFT', timestamp: new Date().toISOString(), notes: 'Auto-created by claim catch-up cron' }
              ]
            }
          });

          const result = await autoClaimFiler.autoFileClaim(claim.id);
          claimsCreated++;

          if (result.success) {
            await prisma.purchase.update({
              where: { id: purchase.id },
              data: { status: 'CLAIM_FILED' }
            });
            logger.info(`Catch-up auto-file succeeded for purchase ${purchase.id}`);
          }
        } catch (err) {
          logger.error(`Catch-up claim creation failed for purchase ${purchase.id}:`, err);
        }
      }

      logger.info(`Claim catch-up completed: ${claimsCreated} claims created/filed out of ${eligiblePurchases.length} eligible`);
    } catch (error) {
      logger.error('Claim catch-up cron failed:', error);
    }
  });

  logger.info('Cron jobs scheduled successfully');
}

module.exports = { setupCronJobs };
