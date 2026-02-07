const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const priceMonitor = require('../services/priceMonitor');
const emailParser = require('../services/emailParser');
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

  logger.info('Cron jobs scheduled successfully');
}

module.exports = { setupCronJobs };
