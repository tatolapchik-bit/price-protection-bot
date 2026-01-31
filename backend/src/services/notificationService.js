const sgMail = require('@sendgrid/mail');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

class NotificationService {
  async sendEmail(to, subject, htmlContent, textContent = null) {
    if (!process.env.SENDGRID_API_KEY) {
      logger.warn('SendGrid not configured, skipping email');
      return false;
    }

    try {
      await sgMail.send({
        to,
        from: {
          email: process.env.FROM_EMAIL || 'notifications@priceprotectionbot.com',
          name: 'PriceProtectionBot'
        },
        subject,
        html: htmlContent,
        text: textContent || htmlContent.replace(/<[^>]*>/g, '')
      });

      logger.info(`Email sent to ${to}: ${subject}`);
      return true;
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  }

  async sendPriceDropAlert(userId, purchase, priceDrop, isEligible) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user?.notificationEmail) return;

    const subject = isEligible
      ? `💰 Claim Eligible: $${priceDrop.toFixed(2)} price drop on ${purchase.productName}!`
      : `📉 Price Drop Alert: ${purchase.productName}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
          .price-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #22c55e; }
          .savings { font-size: 24px; font-weight: bold; color: #22c55e; }
          .cta-button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">Price Drop Detected! 🎉</h1>
          </div>
          <div class="content">
            <p>Great news! The price dropped on an item you purchased:</p>

            <div class="price-box">
              <h3 style="margin-top:0;">${purchase.productName}</h3>
              <p>
                <strong>Original Price:</strong> $${purchase.purchasePrice.toFixed(2)}<br>
                <strong>Current Price:</strong> $${purchase.lowestPrice.toFixed(2)}<br>
                <strong>Retailer:</strong> ${purchase.retailer}
              </p>
              <p class="savings">You can save: $${priceDrop.toFixed(2)}</p>
            </div>

            ${isEligible ? `
              <p style="background:#dcfce7;padding:15px;border-radius:8px;">
                <strong>✅ This purchase is eligible for a price protection claim!</strong><br>
                Your credit card's price protection is still active. File a claim to get the difference refunded.
              </p>
              <a href="${process.env.FRONTEND_URL}/claims/new?purchaseId=${purchase.id}" class="cta-button">
                File Claim Now
              </a>
            ` : `
              <p style="background:#fef3c7;padding:15px;border-radius:8px;">
                <strong>⚠️ Note:</strong> This purchase may not be eligible for a claim.
                Check if it's within your card's protection period or if a credit card has been linked.
              </p>
              <a href="${process.env.FRONTEND_URL}/purchases/${purchase.id}" class="cta-button">
                View Details
              </a>
            `}
          </div>
          <div class="footer">
            <p>You're receiving this because you signed up for price drop alerts.</p>
            <p><a href="${process.env.FRONTEND_URL}/settings">Manage notification preferences</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail(user.notificationEmail, subject, html);
  }

  async sendClaimStatusUpdate(userId, claim, newStatus) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user?.notificationEmail) return;

    const statusMessages = {
      FILED: {
        subject: '📝 Claim Submitted Successfully',
        message: 'Your price protection claim has been filed. We\'ll notify you when there\'s an update.'
      },
      APPROVED: {
        subject: '🎉 Claim Approved!',
        message: `Great news! Your claim has been approved. You should receive $${claim.approvedAmount?.toFixed(2) || claim.priceDifference.toFixed(2)} back.`
      },
      DENIED: {
        subject: '❌ Claim Update',
        message: 'Unfortunately, your claim was not approved. Check the claim details for more information.'
      },
      ADDITIONAL_INFO_NEEDED: {
        subject: '📋 Action Required: Additional Information Needed',
        message: 'The issuer needs more information to process your claim. Please check your account for details.'
      }
    };

    const statusInfo = statusMessages[newStatus];
    if (!statusInfo) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: ${newStatus === 'APPROVED' ? '#22c55e' : newStatus === 'DENIED' ? '#ef4444' : '#667eea'}; color: white; padding: 20px; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
          .cta-button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">${statusInfo.subject}</h1>
          </div>
          <div class="content">
            <p>${statusInfo.message}</p>
            <p>
              <strong>Product:</strong> ${claim.purchase?.productName || 'N/A'}<br>
              <strong>Claim Amount:</strong> $${claim.priceDifference.toFixed(2)}
            </p>
            <a href="${process.env.FRONTEND_URL}/claims/${claim.id}" class="cta-button">
              View Claim Details
            </a>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail(user.notificationEmail, statusInfo.subject, html);
  }

  async sendWeeklySummary(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user?.notificationEmail) return;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Get weekly stats
    const [newPurchases, priceDrops, claimsApproved, totalSaved] = await Promise.all([
      prisma.purchase.count({
        where: { userId, createdAt: { gte: weekAgo } }
      }),
      prisma.notification.count({
        where: { userId, type: 'PRICE_DROP', createdAt: { gte: weekAgo } }
      }),
      prisma.claim.count({
        where: { userId, status: 'APPROVED', resolvedAt: { gte: weekAgo } }
      }),
      prisma.claim.aggregate({
        where: { userId, status: 'APPROVED', resolvedAt: { gte: weekAgo } },
        _sum: { approvedAmount: true }
      })
    ]);

    const totalSavedAmount = totalSaved._sum.approvedAmount || 0;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
          .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
          .stat-box { background: white; padding: 15px; border-radius: 8px; text-align: center; }
          .stat-number { font-size: 28px; font-weight: bold; color: #667eea; }
          .stat-label { color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">Your Weekly Summary 📊</h1>
            <p style="margin:10px 0 0 0;opacity:0.9;">Week of ${weekAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}</p>
          </div>
          <div class="content">
            <div class="stats-grid">
              <div class="stat-box">
                <div class="stat-number">${newPurchases}</div>
                <div class="stat-label">New Purchases</div>
              </div>
              <div class="stat-box">
                <div class="stat-number">${priceDrops}</div>
                <div class="stat-label">Price Drops</div>
              </div>
              <div class="stat-box">
                <div class="stat-number">${claimsApproved}</div>
                <div class="stat-label">Claims Approved</div>
              </div>
              <div class="stat-box">
                <div class="stat-number" style="color:#22c55e;">$${totalSavedAmount.toFixed(2)}</div>
                <div class="stat-label">Money Recovered</div>
              </div>
            </div>
            <p style="text-align:center;margin-top:20px;">
              <a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#667eea;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">
                View Dashboard
              </a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail(
      user.notificationEmail,
      `Your Weekly PriceProtectionBot Summary`,
      html
    );
  }
}

module.exports = new NotificationService();
