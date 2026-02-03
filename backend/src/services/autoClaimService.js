/**
 * Auto-Claim Service
 * Handles automatic filing of price protection claims via email
 */

const sgMail = require('@sendgrid/mail');
const { PrismaClient } = require('@prisma/client');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { getClaimEmailForIssuer, maskCardNumber } = require('../utils/cardUtils');
const claimService = require('./claimService');

const prisma = new PrismaClient();

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const CLAIM_EMAIL_TEMPLATES = {
  default: {
    subject: 'Price Protection Claim Request - {productName}',
    body: `Dear Price Protection Claims Department,

I am writing to submit a price protection claim for a recent purchase made with my credit card.

PURCHASE DETAILS:
- Product: {productName}
- Retailer: {retailer}
- Purchase Date: {purchaseDate}
- Original Purchase Price: ${'{originalPrice}'}
- Card Number (Last 4): ****{lastFour}

PRICE DROP DETAILS:
- New Lower Price Found: ${'{newPrice}'}
- Price Difference (Claim Amount): ${'{priceDifference}'}
- Date Lower Price Found: {priceFoundDate}
- Retailer Where Lower Price Found: {retailer}

I am requesting a refund of ${'{priceDifference}'} as per the price protection benefit of my card.

Sincerely,
{userName}
{userEmail}

Claim Reference: {claimId}`
  },
  amex: {
    subject: 'American Express Price Protection Claim - {productName}',
    body: `Dear American Express Price Protection Team,

I would like to file a price protection claim for the following purchase:

CARDHOLDER INFORMATION:
- Name: {userName}
- Card Ending In: ****{lastFour}
- Email: {userEmail}

PURCHASE INFORMATION:
- Item: {productName}
- Retailer: {retailer}
- Purchase Date: {purchaseDate}
- Amount Charged: ${'{originalPrice}'}

CLAIM INFORMATION:
- Current Advertised Price: ${'{newPrice}'}
- Requested Refund Amount: ${'{priceDifference}'}
- Price Found On: {priceFoundDate}

Best regards,
{userName}

Claim ID: {claimId}`
  }
};

class AutoClaimService {
  async fileClaimViaEmail(claimId) {
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: { purchase: true, creditCard: true, user: true }
    });

    if (!claim) throw new Error('Claim not found');
    if (!claim.creditCard) throw new Error('No credit card linked to this claim');

    const claimEmail = claim.creditCard.claimEmail || getClaimEmailForIssuer(claim.creditCard.issuer);
    if (!claimEmail) throw new Error(`No claim email configured for issuer: ${claim.creditCard.issuer}`);

    try {
      logger.info(`Generating claim documentation for claim ${claimId}`);
      const docUrl = await claimService.generateClaimDocumentation(claim);

      let screenshotPath = null;
      if (claim.purchase.productUrl) {
        logger.info(`Capturing price screenshot for claim ${claimId}`);
        screenshotPath = await claimService.capturePriceScreenshot(claim.purchase.productUrl);
      }

      const emailData = this.prepareEmailContent(claim);
      logger.info(`Sending claim email to ${claimEmail} for claim ${claimId}`);
      
      const emailResult = await this.sendClaimEmail(
        claimEmail, emailData.subject, emailData.body,
        docUrl, screenshotPath, claim.user.email
      );

      const emailScreenshotUrl = await this.captureEmailProof(emailData);
      const statusHistory = claim.statusHistory || [];
      statusHistory.push({
        status: 'EMAIL_SENT',
        timestamp: new Date().toISOString(),
        notes: `Claim email sent to ${claimEmail}`
      });

      await prisma.claim.update({
        where: { id: claimId },
        data: {
          status: 'EMAIL_SENT',
          filedAt: new Date(),
          autoFiled: true,
          claimEmailSentAt: new Date(),
          claimEmailMessageId: emailResult.messageId,
          claimEmailTo: claimEmail,
          claimEmailSubject: emailData.subject,
          claimEmailBody: emailData.body,
          claimEmailScreenshot: emailScreenshotUrl,
          proofDocumentUrl: docUrl,
          priceScreenshotUrl: screenshotPath,
          statusHistory
        }
      });

      await prisma.purchase.update({
        where: { id: claim.purchaseId },
        data: { status: 'CLAIM_FILED' }
      });

      await prisma.notification.create({
        data: {
          userId: claim.userId,
          type: 'CLAIM_STATUS_UPDATE',
          title: 'Claim Filed Automatically',
          message: `Your price protection claim for ${claim.purchase.productName} has been automatically filed with ${claim.creditCard.issuer}.`,
          data: { claimId: claim.id, purchaseId: claim.purchaseId, amount: claim.priceDifference, sentTo: claimEmail }
        }
      });

      logger.info(`Successfully filed claim ${claimId} via email to ${claimEmail}`);
      return { success: true, claimId, emailSentTo: claimEmail, messageId: emailResult.messageId, proofDocumentUrl: docUrl, emailScreenshotUrl };

    } catch (error) {
      logger.error(`Failed to auto-file claim ${claimId}:`, error);
      const statusHistory = claim.statusHistory || [];
      statusHistory.push({ status: 'ERROR', timestamp: new Date().toISOString(), notes: `Auto-file failed: ${error.message}` });
      await prisma.claim.update({ where: { id: claimId }, data: { statusHistory, responseNotes: `Auto-file error: ${error.message}` } });
      throw error;
    }
  }

  prepareEmailContent(claim) {
    const issuerKey = claim.creditCard.issuer.toLowerCase();
    const template = CLAIM_EMAIL_TEMPLATES[issuerKey] || CLAIM_EMAIL_TEMPLATES.default;
    const replacements = {
      productName: claim.purchase.productName,
      retailer: claim.purchase.retailer,
      purchaseDate: new Date(claim.purchase.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      originalPrice: claim.originalPrice.toFixed(2),
      newPrice: claim.newPrice.toFixed(2),
      priceDifference: claim.priceDifference.toFixed(2),
      priceFoundDate: claim.purchase.lowestPriceDate ? new Date(claim.purchase.lowestPriceDate).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US'),
      productUrl: claim.purchase.productUrl || '',
      lastFour: claim.creditCard.lastFour,
      userName: claim.user.name || claim.user.email.split('@')[0],
      userEmail: claim.user.email,
      claimId: claim.id
    };
    let subject = template.subject;
    let body = template.body;
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      subject = subject.replace(regex, value);
      body = body.replace(regex, value);
    }
    return { subject, body };
  }

  async sendClaimEmail(to, subject, body, pdfPath, screenshotPath, replyTo) {
    if (!process.env.SENDGRID_API_KEY) throw new Error('SendGrid not configured');
    const attachments = [];
    if (pdfPath) {
      try {
        const pdfFile = pdfPath.startsWith('/tmp') ? pdfPath : path.join('/tmp', pdfPath.split('/').pop());
        const pdfContent = await fs.readFile(pdfFile);
        attachments.push({ content: pdfContent.toString('base64'), filename: 'price_protection_claim.pdf', type: 'application/pdf', disposition: 'attachment' });
      } catch (err) { logger.warn(`Could not attach PDF: ${err.message}`); }
    }
    if (screenshotPath) {
      try {
        const screenshotContent = await fs.readFile(screenshotPath);
        attachments.push({ content: screenshotContent.toString('base64'), filename: 'price_screenshot.png', type: 'image/png', disposition: 'attachment' });
      } catch (err) { logger.warn(`Could not attach screenshot: ${err.message}`); }
    }
    const msg = {
      to,
      from: { email: process.env.CLAIM_FROM_EMAIL || process.env.FROM_EMAIL || 'claims@priceprotectionbot.com', name: 'PriceProtectionBot Claims' },
      replyTo, subject, text: body, html: body.replace(/\n/g, '<br>'),
      attachments: attachments.length > 0 ? attachments : undefined
    };
    const response = await sgMail.send(msg);
    return { messageId: response[0]?.headers?.['x-message-id'] || uuidv4(), statusCode: response[0]?.statusCode };
  }

  async captureEmailProof(emailData) {
    try {
      const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 800, height: 1000 });
      const emailHtml = `<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#f5f5f5;}.email-container{max-width:700px;margin:0 auto;background:white;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);overflow:hidden;}.email-header{background:#4f46e5;color:white;padding:15px 20px;}.email-header h2{margin:0;font-size:14px;}.email-subject{background:#f9fafb;padding:15px 20px;border-bottom:1px solid #e5e7eb;}.email-body{padding:20px;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#374151;}.timestamp{text-align:center;padding:10px;background:#f9fafb;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;}.checkmark{color:#22c55e;font-size:18px;}</style></head><body><div class="email-container"><div class="email-header"><h2><span class="checkmark">✓</span> Email Sent Successfully</h2></div><div class="email-subject"><strong>Subject:</strong> ${emailData.subject}</div><div class="email-body">${emailData.body}</div><div class="timestamp">Sent on ${new Date().toLocaleString('en-US')}</div></div></body></html>`;
      await page.setContent(emailHtml, { waitUntil: 'networkidle0' });
      const fileName = `email_proof_${uuidv4()}.png`;
      const filePath = path.join('/tmp', fileName);
      await page.screenshot({ path: filePath, fullPage: true });
      await browser.close();
      return `/proofs/${fileName}`;
    } catch (error) {
      logger.error('Failed to capture email proof:', error);
      return null;
    }
  }

  async processAutoClaimsForUser(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { creditCards: true } });
    if (!user || !user.autoFileClaimsEnabled) return { processed: 0, filed: 0 };
    const eligibleClaims = await prisma.claim.findMany({
      where: { userId, status: { in: ['DRAFT', 'READY_TO_FILE'] }, purchase: { status: 'CLAIM_ELIGIBLE', protectionEnds: { gte: new Date() } } },
      include: { purchase: true, creditCard: true }
    });
    let filed = 0;
    const results = [];
    for (const claim of eligibleClaims) {
      if (!claim.creditCard?.autoClaimEnabled) continue;
      try {
        const result = await this.fileClaimViaEmail(claim.id);
        results.push(result);
        filed++;
      } catch (error) {
        logger.error(`Failed to auto-file claim ${claim.id}:`, error);
        results.push({ success: false, claimId: claim.id, error: error.message });
      }
    }
    return { processed: eligibleClaims.length, filed, results };
  }

  async createAndFileClaim(purchaseId, creditCardId) {
    const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId }, include: { user: true } });
    if (!purchase) throw new Error('Purchase not found');
    const creditCard = await prisma.creditCard.findUnique({ where: { id: creditCardId } });
    if (!creditCard) throw new Error('Credit card not found');
    const priceDifference = purchase.purchasePrice - (purchase.lowestPrice || purchase.currentPrice);
    if (priceDifference <= 0) throw new Error('No price drop to claim');
    const claim = await prisma.claim.create({
      data: {
        userId: purchase.userId, purchaseId: purchase.id, creditCardId: creditCard.id,
        originalPrice: purchase.purchasePrice,
        newPrice: purchase.lowestPrice || purchase.currentPrice,
        priceDifference: Math.min(priceDifference, creditCard.maxClaimAmount),
        status: 'DRAFT',
        statusHistory: [{ status: 'DRAFT', timestamp: new Date().toISOString(), notes: 'Claim created automatically' }]
      }
    });
    return await this.fileClaimViaEmail(claim.id);
  }

  async updateClaimStatus(claimId, newStatus, notes = null) {
    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new Error('Claim not found');
    const statusHistory = claim.statusHistory || [];
    statusHistory.push({ status: newStatus, timestamp: new Date().toISOString(), notes });
    const updateData = { status: newStatus, statusHistory };
    if (['APPROVED', 'DENIED', 'MONEY_RECEIVED'].includes(newStatus)) updateData.resolvedAt = new Date();
    if (newStatus === 'MONEY_RECEIVED') updateData.payoutReceivedAt = new Date();
    return await prisma.claim.update({ where: { id: claimId }, data: updateData });
  }
}

module.exports = new AutoClaimService();
