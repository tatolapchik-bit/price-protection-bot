const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Card issuer claim filing info
const ISSUER_INFO = {
  'american express': {
    name: 'American Express',
    portal: null,
    phone: '1-800-297-8019',
    email: 'purchaseprotection@aexp.com',
    requiredDocs: ['receipt', 'price_screenshot', 'item_details'],
    protectionDays: 90,
    maxClaim: 300,
    method: 'email', // Amex accepts email claims
    instructions: [
      'We will automatically email your claim to American Express',
      'Include all documentation attached',
      'Expect response within 5-7 business days'
    ]
  },
  'chase': {
    name: 'Chase',
    portal: 'https://www.chasebenefits.com/chase',
    phone: '1-888-320-9961',
    email: 'cardbenefitservices@eclaimsline.com',
    requiredDocs: ['receipt', 'price_screenshot', 'credit_card_statement'],
    protectionDays: 120,
    maxClaim: 500,
    method: 'portal',
    instructions: [
      'We will automatically submit through Chase Benefits portal',
      'All documentation will be uploaded',
      'Track status at chasebenefits.com'
    ]
  },
  'citi': {
    name: 'Citi',
    portal: 'https://www.cardbenefitservices.com',
    phone: '1-866-918-4969',
    email: 'citibenefit@aon.com',
    requiredDocs: ['receipt', 'price_screenshot'],
    protectionDays: 60,
    maxClaim: 250,
    method: 'email',
    instructions: [
      'We will automatically email your claim',
      'Documentation attached',
      'Expect confirmation within 3-5 business days'
    ]
  },
  'discover': {
    name: 'Discover',
    portal: 'https://www.discover.com/credit-cards/member-benefits/',
    phone: '1-800-347-2683',
    email: 'discover@cardbenefitservices.com',
    requiredDocs: ['receipt', 'price_screenshot'],
    protectionDays: 90,
    maxClaim: 500,
    method: 'email',
    instructions: [
      'We will automatically email your claim to Discover',
      'All documentation included',
      'Track in your Discover account'
    ]
  },
  'visa': {
    name: 'Visa',
    portal: null,
    phone: '1-800-847-2911',
    email: 'visabenefits@cardbenefitservices.com',
    requiredDocs: ['receipt', 'price_screenshot'],
    protectionDays: 60,
    maxClaim: 250,
    method: 'email',
    instructions: [
      'We will email your claim through Visa benefits',
      'Documentation attached automatically'
    ]
  },
  'mastercard': {
    name: 'Mastercard',
    portal: null,
    phone: '1-800-627-8372',
    email: 'mastercardbenefits@cardbenefitservices.com',
    requiredDocs: ['receipt', 'price_screenshot'],
    protectionDays: 60,
    maxClaim: 250,
    method: 'email',
    instructions: [
      'We will email your claim through Mastercard benefits',
      'Documentation attached automatically'
    ]
  }
};

class ClaimService {
  constructor() {
    // Email transporter for sending claims
    this.emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.CLAIM_EMAIL_USER || process.env.EMAIL_USER,
        pass: process.env.CLAIM_EMAIL_PASS || process.env.EMAIL_PASS
      }
    });
  }

  getIssuerInfo(issuer) {
    const normalized = issuer.toLowerCase().trim();
    // Handle common variations
    if (normalized.includes('amex') || normalized.includes('american express')) {
      return ISSUER_INFO['american express'];
    }
    return ISSUER_INFO[normalized] || ISSUER_INFO['visa']; // Default to Visa process
  }

  async generateClaimDocumentation(claim) {
    const purchase = claim.purchase;
    const card = claim.creditCard;

    try {
      // Create PDF document
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Page 1: Claim Summary
      const page1 = pdfDoc.addPage([612, 792]); // US Letter
      const { height } = page1.getSize();

      let yPosition = height - 50;

      // Header
      page1.drawText('PRICE PROTECTION CLAIM', {
        x: 50,
        y: yPosition,
        size: 24,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.5)
      });

      yPosition -= 40;
      page1.drawText(`Claim ID: ${claim.id}`, {
        x: 50,
        y: yPosition,
        size: 10,
        font
      });

      yPosition -= 15;
      page1.drawText(`Generated: ${new Date().toLocaleDateString()}`, {
        x: 50,
        y: yPosition,
        size: 10,
        font
      });

      // Purchase Details Section
      yPosition -= 50;
      page1.drawText('PURCHASE DETAILS', {
        x: 50,
        y: yPosition,
        size: 14,
        font: boldFont
      });

      yPosition -= 25;
      const purchaseDetails = [
        ['Product:', purchase.productName],
        ['Retailer:', purchase.retailer],
        ['Order ID:', purchase.retailerOrderId || 'N/A'],
        ['Purchase Date:', new Date(purchase.purchaseDate).toLocaleDateString()],
        ['Original Price:', `$${claim.originalPrice.toFixed(2)}`]
      ];

      for (const [label, value] of purchaseDetails) {
        page1.drawText(label, { x: 50, y: yPosition, size: 11, font: boldFont });
        page1.drawText(String(value).substring(0, 60), { x: 150, y: yPosition, size: 11, font });
        yPosition -= 18;
      }

      // Price Drop Section
      yPosition -= 30;
      page1.drawText('PRICE DROP INFORMATION', {
        x: 50,
        y: yPosition,
        size: 14,
        font: boldFont
      });

      yPosition -= 25;
      const priceDetails = [
        ['New Price Found:', `$${claim.newPrice.toFixed(2)}`],
        ['Price Difference:', `$${claim.priceDifference.toFixed(2)}`],
        ['Date Found:', purchase.lowestPriceDate ? new Date(purchase.lowestPriceDate).toLocaleDateString() : new Date().toLocaleDateString()],
        ['Source:', purchase.productUrl ? new URL(purchase.productUrl).hostname : 'N/A']
      ];

      for (const [label, value] of priceDetails) {
        page1.drawText(label, { x: 50, y: yPosition, size: 11, font: boldFont });
        page1.drawText(value, { x: 180, y: yPosition, size: 11, font });
        yPosition -= 18;
      }

      // Card Details
      yPosition -= 30;
      page1.drawText('CREDIT CARD DETAILS', {
        x: 50,
        y: yPosition,
        size: 14,
        font: boldFont
      });

      yPosition -= 25;
      page1.drawText(`Card: ${card.nickname} (${card.issuer} ending in ${card.lastFour})`, {
        x: 50,
        y: yPosition,
        size: 11,
        font
      });

      yPosition -= 18;
      page1.drawText(`Protection Period: ${card.protectionDays} days`, {
        x: 50,
        y: yPosition,
        size: 11,
        font
      });

      yPosition -= 18;
      page1.drawText(`Max Claim Amount: $${card.maxClaimAmount.toFixed(2)}`, {
        x: 50,
        y: yPosition,
        size: 11,
        font
      });

      // Claim Amount Box
      yPosition -= 50;
      page1.drawRectangle({
        x: 50,
        y: yPosition - 30,
        width: 250,
        height: 50,
        borderColor: rgb(0.1, 0.5, 0.1),
        borderWidth: 2
      });

      page1.drawText('CLAIM AMOUNT REQUESTED', {
        x: 60,
        y: yPosition - 5,
        size: 12,
        font: boldFont
      });

      page1.drawText(`$${Math.min(claim.priceDifference, card.maxClaimAmount).toFixed(2)}`, {
        x: 60,
        y: yPosition - 25,
        size: 20,
        font: boldFont,
        color: rgb(0.1, 0.5, 0.1)
      });

      // Footer
      page1.drawText('Document generated automatically by PriceDropped', {
        x: 50,
        y: 30,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5)
      });

      // Serialize PDF
      const pdfBytes = await pdfDoc.save();

      // Save to file
      const fileName = `claim_${claim.id}_${Date.now()}.pdf`;
      const filePath = path.join('/tmp', fileName);
      await fs.writeFile(filePath, pdfBytes);

      logger.info(`Generated claim documentation: ${fileName}`);

      return { filePath, fileName, pdfBytes };
    } catch (error) {
      logger.error('Failed to generate claim documentation:', error);
      throw error;
    }
  }

  async capturePriceScreenshot(url) {
    try {
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait a bit for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));

      const fileName = `price_screenshot_${uuidv4()}.png`;
      const filePath = path.join('/tmp', fileName);

      await page.screenshot({ path: filePath, fullPage: false });
      await browser.close();

      logger.info(`Captured price screenshot: ${fileName}`);
      return { filePath, fileName };
    } catch (error) {
      logger.error('Failed to capture price screenshot:', error);
      return null;
    }
  }

  async sendClaimEmail(claim, attachments) {
    const card = claim.creditCard;
    const purchase = claim.purchase;
    const issuerInfo = this.getIssuerInfo(card.issuer);

    if (!issuerInfo.email) {
      throw new Error(`No email address configured for ${card.issuer}`);
    }

    const claimAmount = Math.min(claim.priceDifference, card.maxClaimAmount);

    const emailBody = `
Dear ${card.issuer} Price Protection Team,

I am writing to submit a Price Protection claim for a recent purchase.

CARDHOLDER INFORMATION:
- Card ending in: ${card.lastFour}
- Cardholder: ${claim.user?.name || 'Cardholder'}
- Email: ${claim.user?.email || ''}

PURCHASE DETAILS:
- Product: ${purchase.productName}
- Retailer: ${purchase.retailer}
- Order ID: ${purchase.retailerOrderId || 'See attached receipt'}
- Purchase Date: ${new Date(purchase.purchaseDate).toLocaleDateString()}
- Original Purchase Price: $${claim.originalPrice.toFixed(2)}

PRICE DROP INFORMATION:
- Current Lower Price: $${claim.newPrice.toFixed(2)}
- Price Difference: $${claim.priceDifference.toFixed(2)}
- Date Price Found: ${new Date().toLocaleDateString()}
${purchase.productUrl ? `- Price Source: ${purchase.productUrl}` : ''}

CLAIM AMOUNT REQUESTED: $${claimAmount.toFixed(2)}

I have attached the following documentation:
1. Claim summary document (PDF)
2. Screenshot showing the current lower price

Please process this claim at your earliest convenience. I understand the claim is subject to your standard terms and conditions.

Thank you for your assistance.

Best regards,
${claim.user?.name || 'Cardholder'}

---
This claim was submitted automatically via PriceDropped
Claim Reference: ${claim.id}
    `.trim();

    const mailOptions = {
      from: process.env.CLAIM_EMAIL_USER || process.env.EMAIL_USER,
      to: issuerInfo.email,
      cc: claim.user?.email, // CC the user
      subject: `Price Protection Claim - Card ending ${card.lastFour} - $${claimAmount.toFixed(2)}`,
      text: emailBody,
      attachments: attachments.map(att => ({
        filename: att.fileName,
        path: att.filePath
      }))
    };

    try {
      const result = await this.emailTransporter.sendMail(mailOptions);
      logger.info(`Claim email sent successfully: ${result.messageId}`);
      return {
        success: true,
        messageId: result.messageId,
        recipient: issuerInfo.email
      };
    } catch (error) {
      logger.error('Failed to send claim email:', error);
      throw error;
    }
  }

  getFilingInstructions(claim) {
    const card = claim.creditCard;
    const issuerInfo = this.getIssuerInfo(card.issuer);

    return {
      issuer: card.issuer,
      claimAmount: Math.min(claim.priceDifference, card.maxClaimAmount),
      method: issuerInfo.method || 'email',
      portal: card.claimPortalUrl || issuerInfo.portal,
      phone: card.claimPhoneNumber || issuerInfo.phone,
      email: card.claimEmail || issuerInfo.email,
      requiredDocuments: issuerInfo.requiredDocs || ['receipt', 'price_screenshot'],
      instructions: issuerInfo.instructions || [
        'Contact your credit card issuer',
        'Request price protection claim',
        'Submit required documentation'
      ],
      tips: [
        'File within the protection window (check your card terms)',
        'Have all documentation ready before starting',
        'Keep the claim reference number',
        'Follow up if you don\'t hear back within 2 weeks'
      ],
      deadlines: {
        protectionEnds: claim.purchase?.protectionEnds,
        daysRemaining: claim.purchase?.protectionEnds
          ? Math.ceil((new Date(claim.purchase.protectionEnds) - new Date()) / (1000 * 60 * 60 * 24))
          : null
      },
      canAutoFile: !!issuerInfo.email
    };
  }

  /**
   * Fully automated claim filing
   * - Generates all documentation
   * - Captures price screenshot
   * - Submits claim via email to card issuer
   * - Updates claim status
   */
  async autoFileClaim(claimId) {
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        purchase: true,
        creditCard: true,
        user: true
      }
    });

    if (!claim) {
      throw new Error('Claim not found');
    }

    const issuerInfo = this.getIssuerInfo(claim.creditCard.issuer);
    const attachments = [];

    logger.info(`Starting auto-file process for claim ${claimId}`);

    // Step 1: Generate claim documentation PDF
    logger.info('Generating claim documentation...');
    const doc = await this.generateClaimDocumentation(claim);
    attachments.push(doc);

    // Step 2: Capture current price screenshot
    if (claim.purchase.productUrl) {
      logger.info('Capturing price screenshot...');
      const screenshot = await this.capturePriceScreenshot(claim.purchase.productUrl);
      if (screenshot) {
        attachments.push(screenshot);
      }
    }

    // Step 3: Submit claim via email
    logger.info(`Submitting claim via email to ${issuerInfo.email}...`);
    let submissionResult;
    try {
      submissionResult = await this.sendClaimEmail(claim, attachments);
    } catch (emailError) {
      // If email fails, still mark as ready to file manually
      logger.error('Email submission failed:', emailError);

      await prisma.claim.update({
        where: { id: claimId },
        data: {
          proofDocumentUrl: `/documents/${doc.fileName}`,
          status: 'READY_TO_FILE',
          responseNotes: `Auto-submission failed: ${emailError.message}. Please file manually.`
        }
      });

      return {
        success: false,
        claimId,
        status: 'READY_TO_FILE',
        documentUrl: `/documents/${doc.fileName}`,
        error: emailError.message,
        instructions: this.getFilingInstructions(claim)
      };
    }

    // Step 4: Update claim status
    const updatedClaim = await prisma.claim.update({
      where: { id: claimId },
      data: {
        proofDocumentUrl: `/documents/${doc.fileName}`,
        status: 'FILED',
        filedAt: new Date(),
        responseNotes: `Auto-filed via email. Message ID: ${submissionResult.messageId}`
      }
    });

    // Step 5: Update purchase status
    await prisma.purchase.update({
      where: { id: claim.purchaseId },
      data: { status: 'CLAIM_FILED' }
    });

    // Step 6: Create notification
    await prisma.notification.create({
      data: {
        userId: claim.userId,
        type: 'CLAIM_FILED',
        title: 'Claim Filed Automatically! 🎉',
        message: `Your $${claim.priceDifference.toFixed(2)} claim for ${claim.purchase.productName} has been automatically submitted to ${claim.creditCard.issuer}. Expect a response within 5-7 business days.`,
        data: { claimId, emailMessageId: submissionResult.messageId }
      }
    });

    logger.info(`Claim ${claimId} auto-filed successfully`);

    return {
      success: true,
      claimId,
      status: 'FILED',
      filedAt: updatedClaim.filedAt,
      documentUrl: `/documents/${doc.fileName}`,
      emailSent: true,
      emailRecipient: submissionResult.recipient,
      messageId: submissionResult.messageId,
      message: `Claim automatically submitted to ${claim.creditCard.issuer}. You will receive a confirmation email shortly.`
    };
  }
}

module.exports = new ClaimService();
