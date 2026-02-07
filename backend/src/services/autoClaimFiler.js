/**
 * Auto Claim Filer Service
 * Files price protection claims via email using Gmail API (OAuth2).
 * Falls back to SendGrid if Gmail is unavailable.
 * Generates proof: PDF documentation, price screenshot, email proof screenshot.
 *
 * Flow:
 *   1. Generate claim PDF
 *   2. Capture price screenshot (if product URL exists)
 *   3. Send claim email to card issuer via Gmail API (or SendGrid fallback)
 *   4. Capture email proof screenshot (rendered HTML of the sent email)
 *   5. Update claim record with all proof data
 *   6. Notify user
 */

const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const claimService = require('./claimService');

const prisma = new PrismaClient();

// SendGrid is optional fallback
let sgMail = null;
try {
  sgMail = require('@sendgrid/mail');
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }
} catch (e) {
  logger.info('SendGrid not available, using Gmail API only');
}

// ── Issuer claim email addresses ─────────────────────────────────────────────
// These are the benefit-services addresses that handle price protection claims.
const ISSUER_CLAIM_EMAILS = {
  'american express': 'purchaseprotection@aexp.com',
  'amex':             'purchaseprotection@aexp.com',
  'chase':            'cardbenefitservices@eclaimsline.com',
  'citi':             'citibenefit@aon.com',
  'citibank':         'citibenefit@aon.com',
  'discover':         'discover@cardbenefitservices.com',
  'visa':             'visabenefits@cardbenefitservices.com',
  'mastercard':       'mastercardbenefits@cardbenefitservices.com',
  'capital one':      'priceprotection@capitalone.com',
  'capitalone':       'priceprotection@capitalone.com',
  'wells fargo':      'priceprotection@wellsfargo.com',
  'wellsfargo':       'priceprotection@wellsfargo.com',
  'barclays':         'benefits@barclaysus.com',
  'usbank':           'cardmemberservice@usbank.com',
  'us bank':          'cardmemberservice@usbank.com',
};

// ── Issuer-specific email templates ──────────────────────────────────────────
const EMAIL_TEMPLATES = {
  amex: {
    subject: 'American Express Purchase Protection Claim – {productName}',
    greeting: 'Dear American Express Purchase Protection Team,',
  },
  chase: {
    subject: 'Chase Price Protection Claim – Card ending {lastFour}',
    greeting: 'Dear Chase Benefits Services,',
  },
  citi: {
    subject: 'Citi Price Rewind Claim – {productName}',
    greeting: 'Dear Citi Card Benefit Services,',
  },
  discover: {
    subject: 'Discover Price Protection Claim – {productName}',
    greeting: 'Dear Discover Card Member Benefits,',
  },
  default: {
    subject: 'Price Protection Claim – {productName} – Card ending {lastFour}',
    greeting: 'Dear Price Protection Claims Department,',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClaimEmail(issuer, card) {
  // 1. Check if the credit-card record has a custom claim email
  if (card?.claimEmail) return card.claimEmail;

  // 2. Look up from our map (case-insensitive)
  const key = (issuer || '').toLowerCase().trim();
  if (ISSUER_CLAIM_EMAILS[key]) return ISSUER_CLAIM_EMAILS[key];

  // 3. Also check the card's network (visa/mastercard) as fallback
  const network = (card?.network || '').toLowerCase().trim();
  if (ISSUER_CLAIM_EMAILS[network]) return ISSUER_CLAIM_EMAILS[network];

  // 4. Fall back to a generic email (better than nothing)
  return 'cardbenefitservices@eclaimsline.com';
}

function getTemplate(issuer) {
  const key = (issuer || '').toLowerCase().trim();
  if (key.includes('amex') || key.includes('american express')) return EMAIL_TEMPLATES.amex;
  if (key.includes('chase'))   return EMAIL_TEMPLATES.chase;
  if (key.includes('citi'))    return EMAIL_TEMPLATES.citi;
  if (key.includes('discover')) return EMAIL_TEMPLATES.discover;
  return EMAIL_TEMPLATES.default;
}

function fillTemplate(str, data) {
  return str.replace(/\{(\w+)\}/g, (_, k) => data[k] ?? '');
}

function buildEmailBody(claim) {
  const card = claim.creditCard;
  const purchase = claim.purchase;
  const user = claim.user;
  const template = getTemplate(card.issuer);
  const claimAmount = Math.min(claim.priceDifference, card.maxClaimAmount);

  const data = {
    productName: purchase.productName,
    lastFour:    card.lastFour,
    retailer:    purchase.retailer,
    claimId:     claim.id,
  };

  const subject = fillTemplate(template.subject, data);

  const body = `${fillTemplate(template.greeting, data)}

I am writing to submit a Price Protection claim for a recent purchase.

CARDHOLDER INFORMATION:
- Cardholder Name: ${user?.name || user?.email?.split('@')[0] || 'Cardholder'}
- Card Ending In: ****${card.lastFour}
- Email: ${user?.email || ''}

PURCHASE DETAILS:
- Product: ${purchase.productName}
- Retailer: ${purchase.retailer}
- Order ID: ${purchase.retailerOrderId || 'See attached receipt'}
- Purchase Date: ${new Date(purchase.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
- Original Purchase Price: $${claim.originalPrice.toFixed(2)}

PRICE DROP INFORMATION:
- Current Lower Price: $${claim.newPrice.toFixed(2)}
- Price Difference: $${claim.priceDifference.toFixed(2)}
- Date Lower Price Found: ${purchase.lowestPriceDate ? new Date(purchase.lowestPriceDate).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US')}${purchase.productUrl ? `\n- Price Source URL: ${purchase.productUrl}` : ''}

CLAIM AMOUNT REQUESTED: $${claimAmount.toFixed(2)}

I have attached the following documentation:
1. Claim summary document (PDF) with full details
2. Screenshot of the current lower price (if available)

Please process this claim at your earliest convenience. I understand the claim is subject to the standard terms and conditions of my card's price protection benefit.

Thank you for your assistance.

Best regards,
${user?.name || user?.email?.split('@')[0] || 'Cardholder'}

---
Claim Reference: ${claim.id}
Submitted automatically via PriceDropped`;

  return { subject, body };
}

// ── Helper: Get Gmail client for a user ──────────────────────────────────────

async function getGmailClient(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      gmailAccessToken: true,
      gmailRefreshToken: true,
    }
  });

  if (!user?.gmailAccessToken) {
    throw new Error('Gmail not connected for this user');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.gmailAccessToken,
    refresh_token: user.gmailRefreshToken,
  });

  // Handle token refresh
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.user.update({
        where: { id: userId },
        data: { gmailAccessToken: tokens.access_token }
      });
    }
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ── Core: Send claim email via Gmail API ─────────────────────────────────────

async function sendClaimEmailViaGmail(userId, fromEmail, toEmail, subject, body, attachments) {
  const gmail = await getGmailClient(userId);

  // Build MIME message with attachments
  const boundary = `boundary_${uuidv4().replace(/-/g, '')}`;
  const htmlBody = body.replace(/\n/g, '<br>');

  let mimeMessage = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="alt_${boundary}"`,
    ``,
    `--alt_${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
    ``,
    `--alt_${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    htmlBody,
    ``,
    `--alt_${boundary}--`,
  ].join('\r\n');

  // Add attachments
  for (const att of attachments) {
    try {
      const fileContent = await fs.readFile(att.filePath);
      const base64Content = fileContent.toString('base64');
      const filename = att.displayName || path.basename(att.filePath);
      const mimeType = att.mimeType || 'application/octet-stream';

      mimeMessage += [
        ``,
        `--${boundary}`,
        `Content-Type: ${mimeType}; name="${filename}"`,
        `Content-Disposition: attachment; filename="${filename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        base64Content,
      ].join('\r\n');
    } catch (err) {
      logger.warn(`Could not attach file ${att.filePath}: ${err.message}`);
    }
  }

  mimeMessage += `\r\n--${boundary}--`;

  // Encode to base64url
  const encodedMessage = Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Send via Gmail API
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });

  return {
    messageId: response.data.id || `gmail-${uuidv4()}`,
    threadId: response.data.threadId,
    statusCode: 200,
  };
}

// ── Core: Send claim email via SendGrid (fallback) ───────────────────────────

async function sendClaimEmailViaSendGrid(toEmail, subject, body, attachments, replyTo) {
  if (!process.env.SENDGRID_API_KEY || !sgMail) {
    throw new Error('SENDGRID_API_KEY is not configured. Cannot send claim email via SendGrid.');
  }

  const sgAttachments = [];

  for (const att of attachments) {
    try {
      const fileContent = await fs.readFile(att.filePath);
      sgAttachments.push({
        content:     fileContent.toString('base64'),
        filename:    att.displayName || path.basename(att.filePath),
        type:        att.mimeType || 'application/octet-stream',
        disposition: 'attachment',
      });
    } catch (err) {
      logger.warn(`Could not attach file ${att.filePath}: ${err.message}`);
    }
  }

  const msg = {
    to:      toEmail,
    from: {
      email: process.env.CLAIM_FROM_EMAIL || process.env.FROM_EMAIL || 'claims@pricedropped.app',
      name:  'PriceDropped Claims',
    },
    replyTo: replyTo || undefined,
    subject,
    text: body,
    html: body.replace(/\n/g, '<br>'),
    attachments: sgAttachments.length > 0 ? sgAttachments : undefined,
  };

  const response = await sgMail.send(msg);

  return {
    messageId:  response[0]?.headers?.['x-message-id'] || `sg-${uuidv4()}`,
    statusCode: response[0]?.statusCode,
  };
}

// ── Core: Capture email proof screenshot ─────────────────────────────────────

async function captureEmailProofScreenshot(subject, body, toEmail, sentAt) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200 });

    const escapedBody = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; background: #f3f4f6; }
  .container { max-width: 700px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden; }
  .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; padding: 18px 24px; display: flex; align-items: center; gap: 10px; }
  .header .check { font-size: 22px; }
  .header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .meta { background: #f9fafb; padding: 14px 24px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; }
  .meta strong { color: #111827; }
  .body-text { padding: 24px; white-space: pre-wrap; font-size: 14px; line-height: 1.7; color: #374151; }
  .footer { background: #f9fafb; padding: 12px 24px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af; }
</style></head><body>
  <div class="container">
    <div class="header"><span class="check">✓</span><h2>Claim Email Sent Successfully</h2></div>
    <div class="meta">
      <div><strong>To:</strong> ${toEmail}</div>
      <div><strong>Subject:</strong> ${subject}</div>
      <div><strong>Sent:</strong> ${sentAt.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</div>
    </div>
    <div class="body-text">${escapedBody}</div>
    <div class="footer">Proof of email sent via PriceDropped &bull; ${sentAt.toISOString()}</div>
  </div>
</body></html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const fileName = `email_proof_${uuidv4()}.png`;
    const filePath = path.join('/tmp', fileName);
    await page.screenshot({ path: filePath, fullPage: true });
    await browser.close();
    browser = null;

    logger.info(`Captured email proof screenshot: ${fileName}`);
    return { filePath, fileName };
  } catch (error) {
    logger.error('Failed to capture email proof screenshot:', error);
    if (browser) try { await browser.close(); } catch (_) {}
    return null;
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

async function autoFileClaim(claimId) {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      purchase: true,
      creditCard: true,
      user: true,
    },
  });

  if (!claim)            throw new Error('Claim not found');
  if (!claim.creditCard) throw new Error('No credit card linked to this claim');

  const card    = claim.creditCard;
  const issuer  = card.issuer;
  const toEmail = getClaimEmail(issuer, card);

  logger.info(`[AutoFile] Starting auto-file for claim ${claimId} → ${issuer} (${toEmail})`);

  const attachments = [];
  let pdfFilePath       = null;
  let screenshotFilePath = null;
  let emailProofPath     = null;

  try {
    // ── Step 1: Generate claim PDF ───────────────────────────────────────────
    logger.info('[AutoFile] Generating claim PDF...');
    const doc = await claimService.generateClaimDocumentation(claim);
    pdfFilePath = doc.filePath;
    attachments.push({
      filePath:    doc.filePath,
      displayName: 'PriceProtection_Claim.pdf',
      mimeType:    'application/pdf',
    });
    logger.info(`[AutoFile] PDF generated: ${doc.fileName}`);

    // ── Step 2: Capture price screenshot (if URL available) ──────────────────
    if (claim.purchase.productUrl) {
      logger.info('[AutoFile] Capturing price screenshot...');
      const screenshot = await claimService.capturePriceScreenshot(claim.purchase.productUrl);
      if (screenshot) {
        screenshotFilePath = screenshot.filePath;
        attachments.push({
          filePath:    screenshot.filePath,
          displayName: 'Current_Price_Screenshot.png',
          mimeType:    'image/png',
        });
        logger.info(`[AutoFile] Price screenshot captured: ${screenshot.fileName}`);
      }
    } else {
      logger.info('[AutoFile] No product URL — skipping price screenshot');
    }

    // ── Step 3: Build & send claim email (Gmail primary, SendGrid fallback) ─
    const { subject, body } = buildEmailBody(claim);
    const sentAt = new Date();
    let emailResult;
    let sendMethod = 'gmail';

    logger.info(`[AutoFile] Sending claim email to ${toEmail}...`);

    // Try Gmail API first (uses user's own email — more legitimate for claims)
    try {
      emailResult = await sendClaimEmailViaGmail(
        claim.userId,
        claim.user?.email || 'noreply@pricedropped.app',
        toEmail,
        subject,
        body,
        attachments
      );
      logger.info(`[AutoFile] Email sent via Gmail! messageId=${emailResult.messageId}`);
    } catch (gmailError) {
      logger.warn(`[AutoFile] Gmail send failed: ${gmailError.message}. Trying SendGrid...`);

      // Fallback to SendGrid
      sendMethod = 'sendgrid';
      emailResult = await sendClaimEmailViaSendGrid(
        toEmail,
        subject,
        body,
        attachments,
        claim.user?.email
      );
      logger.info(`[AutoFile] Email sent via SendGrid! messageId=${emailResult.messageId}`);
    }

    // ── Step 4: Capture email proof screenshot ───────────────────────────────
    logger.info('[AutoFile] Capturing email proof screenshot...');
    const emailProof = await captureEmailProofScreenshot(subject, body, toEmail, sentAt);
    if (emailProof) {
      emailProofPath = emailProof.filePath;
      logger.info(`[AutoFile] Email proof captured: ${emailProof.fileName}`);
    }

    // ── Step 5: Update claim record with all proof data ──────────────────────
    const statusHistory = Array.isArray(claim.statusHistory) ? [...claim.statusHistory] : [];
    statusHistory.push({
      status:    'EMAIL_SENT',
      timestamp: sentAt.toISOString(),
      notes:     `Claim email sent to ${toEmail} via ${sendMethod} (${emailResult.messageId})`,
    });

    await prisma.claim.update({
      where: { id: claimId },
      data: {
        status:               'EMAIL_SENT',
        filedAt:              sentAt,
        autoFiled:            true,
        claimEmailSentAt:     sentAt,
        claimEmailMessageId:  emailResult.messageId,
        claimEmailTo:         toEmail,
        claimEmailSubject:    subject,
        claimEmailBody:       body,
        claimEmailScreenshot: emailProofPath  ? path.basename(emailProofPath)  : null,
        proofDocumentUrl:     pdfFilePath     ? path.basename(pdfFilePath)     : null,
        priceScreenshotUrl:   screenshotFilePath ? path.basename(screenshotFilePath) : null,
        statusHistory,
      },
    });

    // ── Step 6: Update purchase status ───────────────────────────────────────
    await prisma.purchase.update({
      where: { id: claim.purchaseId },
      data: { status: 'CLAIM_FILED' },
    });

    // ── Step 7: Notify user ──────────────────────────────────────────────────
    const claimAmount = Math.min(claim.priceDifference, card.maxClaimAmount);
    await prisma.notification.create({
      data: {
        userId: claim.userId,
        type:   'CLAIM_FILED',
        title:  'Claim Filed Automatically!',
        message: `Your $${claimAmount.toFixed(2)} claim for ${claim.purchase.productName} was submitted to ${issuer} (${toEmail}). Check your claim details for proof of filing.`,
        data: {
          claimId,
          emailMessageId: emailResult.messageId,
          sentTo:         toEmail,
          amount:         claimAmount,
        },
      },
    });

    logger.info(`[AutoFile] Claim ${claimId} filed successfully!`);

    return {
      success:     true,
      method:      'email',
      claimId,
      sentTo:      toEmail,
      sentAt:      sentAt.toISOString(),
      messageId:   emailResult.messageId,
      subject,
      claimAmount,
      proof: {
        pdfFile:           pdfFilePath     ? path.basename(pdfFilePath)     : null,
        priceScreenshot:   screenshotFilePath ? path.basename(screenshotFilePath) : null,
        emailProof:        emailProofPath  ? path.basename(emailProofPath)  : null,
        emailBody:         body,
      },
      message: `Claim submitted via email to ${issuer} (${toEmail}). You'll receive a CC at ${claim.user?.email || 'your email'}.`,
    };

  } catch (error) {
    logger.error(`[AutoFile] Failed for claim ${claimId}:`, error);

    // Mark as ready-to-file manually so user can still proceed
    const statusHistory = Array.isArray(claim.statusHistory) ? [...claim.statusHistory] : [];
    statusHistory.push({
      status:    'ERROR',
      timestamp: new Date().toISOString(),
      notes:     `Auto-file failed: ${error.message}`,
    });

    await prisma.claim.update({
      where: { id: claimId },
      data: {
        status:        'READY_TO_FILE',
        statusHistory,
        responseNotes: `Auto-filing failed: ${error.message}. Please file manually.`,
        // Still save any proof we generated before the error
        proofDocumentUrl:   pdfFilePath     ? path.basename(pdfFilePath)     : claim.proofDocumentUrl,
        priceScreenshotUrl: screenshotFilePath ? path.basename(screenshotFilePath) : claim.priceScreenshotUrl,
      },
    });

    return {
      success: false,
      method:  'manual',
      claimId,
      error:   error.message,
      message: 'Auto-filing failed. Claim is ready for manual filing.',
      instructions: claimService.getFilingInstructions(claim),
    };
  }
}

module.exports = { autoFileClaim, getClaimEmail, ISSUER_CLAIM_EMAILS };
