const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Card issuer claim filing info
const ISSUER_INFO = {
  chase: {
    name: 'Chase',
    portal: 'https://www.chasebenefits.com/chase',
    phone: '1-888-320-9961',
    email: null,
    requiredDocs: ['receipt', 'price_screenshot', 'credit_card_statement'],
    protectionDays: 120,
    maxClaim: 500,
    instructions: [
      'Log in to Chase Benefits portal',
      'Select "Price Protection" from the menu',
      'Fill out the claim form with purchase details',
      'Upload required documentation',
      'Submit claim and note the confirmation number'
    ]
  },
  citi: {
    name: 'Citi',
    portal: 'https://www.cardbenefitservices.com/ebdcaz/completeReg.do',
    phone: '1-866-918-4969',
    email: null,
    requiredDocs: ['receipt', 'price_screenshot'],
    protectionDays: 60,
    maxClaim: 250,
    instructions: [
      'Call the Citi Benefits Center',
      'Provide your card number and purchase details',
      'You will receive a claim form via email',
      'Complete and return with documentation',
      'Track claim status online'
    ]
  },
  amex: {
    name: 'American Express',
    portal: null,
    phone: '1-800-297-8019',
    email: null,
    requiredDocs: ['receipt', 'price_screenshot', 'item_details'],
    protectionDays: 90,
    maxClaim: 300,
    instructions: [
      'Call American Express Purchase Protection',
      'Provide card details and explain the price drop',
      'Representative will guide you through the process',
      'Email required documentation as instructed',
      'Receive confirmation via email'
    ]
  },
  discover: {
    name: 'Discover',
    portal: 'https://www.discover.com/credit-cards/member-benefits/',
    phone: '1-800-347-2683',
    email: null,
    requiredDocs: ['receipt', 'price_screenshot'],
    protectionDays: 90,
    maxClaim: 500,
    instructions: [
      'Log in to Discover account',
      'Navigate to Card Benefits',
      'Select Price Protection',
      'Submit claim with documentation',
      'Track claim in your account'
    ]
  },
  capitalone: {
    name: 'Capital One',
    portal: null,
    phone: '1-800-227-4825',
    email: null,
    requiredDocs: ['receipt', 'price_screenshot'],
    protectionDays: 60,
    maxClaim: 250,
    instructions: [
      'Note: Capital One discontinued Price Protection for most cards in 2018',
      'Check your specific card benefits to confirm eligibility',
      'If eligible, call the number on the back of your card',
      'Request price protection claim form',
      'Submit with required documentation'
    ]
  }
};

class ClaimService {
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
        page1.drawText(value.substring(0, 60), { x: 150, y: yPosition, size: 11, font });
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
        ['Date Found:', new Date(purchase.lowestPriceDate).toLocaleDateString()],
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

      page1.drawText('CLAIM AMOUNT', {
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
      page1.drawText('Document generated by PriceProtectionBot', {
        x: 50,
        y: 30,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5)
      });

      // Page 2: Filing Instructions
      const page2 = pdfDoc.addPage([612, 792]);
      yPosition = height - 50;

      page2.drawText('FILING INSTRUCTIONS', {
        x: 50,
        y: yPosition,
        size: 20,
        font: boldFont
      });

      const issuerKey = card.issuer.toLowerCase();
      const issuerInfo = ISSUER_INFO[issuerKey] || {
        instructions: [
          'Contact your credit card issuer',
          'Request price protection claim form',
          'Submit with documentation of original purchase and lower price'
        ]
      };

      yPosition -= 40;
      page2.drawText(`For ${card.issuer} cardholders:`, {
        x: 50,
        y: yPosition,
        size: 14,
        font: boldFont
      });

      yPosition -= 30;
      let stepNum = 1;
      for (const instruction of issuerInfo.instructions) {
        page2.drawText(`${stepNum}. ${instruction}`, {
          x: 50,
          y: yPosition,
          size: 11,
          font
        });
        yPosition -= 20;
        stepNum++;
      }

      // Contact info
      yPosition -= 30;
      page2.drawText('Contact Information:', {
        x: 50,
        y: yPosition,
        size: 14,
        font: boldFont
      });

      yPosition -= 25;
      if (issuerInfo.phone) {
        page2.drawText(`Phone: ${issuerInfo.phone}`, { x: 50, y: yPosition, size: 11, font });
        yPosition -= 18;
      }
      if (issuerInfo.portal) {
        page2.drawText(`Portal: ${issuerInfo.portal}`, { x: 50, y: yPosition, size: 11, font });
        yPosition -= 18;
      }

      // Required documents
      yPosition -= 30;
      page2.drawText('Required Documents:', {
        x: 50,
        y: yPosition,
        size: 14,
        font: boldFont
      });

      yPosition -= 25;
      const docDescriptions = {
        receipt: '☐ Original purchase receipt',
        price_screenshot: '☐ Screenshot of lower advertised price',
        credit_card_statement: '☐ Credit card statement showing the charge',
        item_details: '☐ Product details/specifications'
      };

      for (const doc of (issuerInfo.requiredDocs || ['receipt', 'price_screenshot'])) {
        page2.drawText(docDescriptions[doc] || `☐ ${doc}`, {
          x: 50,
          y: yPosition,
          size: 11,
          font
        });
        yPosition -= 18;
      }

      // Serialize PDF
      const pdfBytes = await pdfDoc.save();

      // Save to file (in production, upload to S3/cloud storage)
      const fileName = `claim_${claim.id}_${Date.now()}.pdf`;
      const filePath = path.join('/tmp', fileName);
      await fs.writeFile(filePath, pdfBytes);

      // In production, upload to cloud storage and return URL
      // For now, return local path
      const documentUrl = `/documents/${fileName}`;

      logger.info(`Generated claim documentation: ${fileName}`);

      return documentUrl;
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
      await page.setViewport({ width: 1280, height: 800 });

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const fileName = `price_screenshot_${uuidv4()}.png`;
      const filePath = path.join('/tmp', fileName);

      await page.screenshot({ path: filePath, fullPage: false });
      await browser.close();

      return filePath;
    } catch (error) {
      logger.error('Failed to capture price screenshot:', error);
      return null;
    }
  }

  getFilingInstructions(claim) {
    const card = claim.creditCard;
    const issuerKey = card.issuer.toLowerCase();
    const issuerInfo = ISSUER_INFO[issuerKey];

    return {
      issuer: card.issuer,
      claimAmount: Math.min(claim.priceDifference, card.maxClaimAmount),
      method: card.claimMethod,
      portal: card.claimPortalUrl || issuerInfo?.portal,
      phone: card.claimPhoneNumber || issuerInfo?.phone,
      email: card.claimEmail || issuerInfo?.email,
      requiredDocuments: issuerInfo?.requiredDocs || ['receipt', 'price_screenshot'],
      instructions: issuerInfo?.instructions || [
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
        protectionEnds: claim.purchase.protectionEnds,
        daysRemaining: claim.purchase.protectionEnds
          ? Math.ceil((new Date(claim.purchase.protectionEnds) - new Date()) / (1000 * 60 * 60 * 24))
          : null
      }
    };
  }

  async autoFileClaim(claimId) {
    // Note: Full automation would require integration with each issuer's
    // portal, which may involve:
    // - Maintaining authenticated sessions
    // - Handling CAPTCHA
    // - Form filling automation
    // - File uploads

    // For now, this prepares all materials and provides detailed instructions
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

    // Generate documentation
    const docUrl = await this.generateClaimDocumentation(claim);

    // Capture current price screenshot if URL available
    let screenshotPath = null;
    if (claim.purchase.productUrl) {
      screenshotPath = await this.capturePriceScreenshot(claim.purchase.productUrl);
    }

    // Update claim
    await prisma.claim.update({
      where: { id: claimId },
      data: {
        proofDocumentUrl: docUrl,
        status: 'READY_TO_FILE'
      }
    });

    return {
      claimId,
      documentUrl: docUrl,
      screenshotPath,
      instructions: this.getFilingInstructions(claim)
    };
  }
}

module.exports = new ClaimService();
