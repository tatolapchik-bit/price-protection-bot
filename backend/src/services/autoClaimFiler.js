/**
 * Auto Claim Filer Service
 * Handles automated filing of price protection claims via:
 * 1. Email submission (primary method - works for most issuers)
 * 2. Portal form filling via Puppeteer (for issuers with online portals)
 */

const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const claimService = require('./claimService');

const prisma = new PrismaClient();

// Claim portal configurations with form field selectors
const CLAIM_PORTALS = {
  Chase: {
    url: 'https://www.chasebenefits.com/chase',
    loginRequired: true,
    steps: [
      { action: 'navigate', url: 'https://www.chasebenefits.com/chase' },
      { action: 'click', selector: 'a[href*="FileClaim"], button:has-text("File a Claim"), .file-claim-btn' },
      { action: 'select', selector: '#benefitType, select[name="benefitType"]', value: 'Price Protection' },
      { action: 'fill', selector: '#cardNumber, input[name="cardNumber"]', field: 'lastFour' },
      { action: 'fill', selector: '#purchaseDate, input[name="purchaseDate"]', field: 'purchaseDate' },
      { action: 'fill', selector: '#purchaseAmount, input[name="purchaseAmount"]', field: 'originalPrice' },
      { action: 'fill', selector: '#currentPrice, input[name="currentPrice"]', field: 'newPrice' },
      { action: 'fill', selector: '#merchantName, input[name="merchantName"]', field: 'retailer' },
      { action: 'fill', selector: '#itemDescription, input[name="itemDescription"]', field: 'productName' },
      { action: 'upload', selector: 'input[type="file"]', field: 'proofDocument' },
      { action: 'submit', selector: 'button[type="submit"], .submit-claim-btn' }
    ]
  },
  Citi: {
    url: 'https://www.cardbenefitservices.com/ebdcaz/completeReg.do',
    loginRequired: true,
    steps: [
      { action: 'navigate', url: 'https://www.cardbenefitservices.com/ebdcaz/completeReg.do' },
      { action: 'fill', selector: '#cardNumber, input[name="cardNumber"]', field: 'lastFour' },
      { action: 'fill', selector: '#purchaseDate, input[name="purchaseDate"]', field: 'purchaseDate' },
      { action: 'fill', selector: '#originalPrice, input[name="originalPrice"]', field: 'originalPrice' },
      { action: 'fill', selector: '#lowerPrice, input[name="lowerPrice"]', field: 'newPrice' },
      { action: 'fill', selector: '#itemDesc, input[name="itemDesc"]', field: 'productName' },
      { action: 'fill', selector: '#retailer, input[name="retailer"]', field: 'retailer' },
      { action: 'upload', selector: 'input[type="file"]', field: 'proofDocument' },
      { action: 'submit', selector: 'button[type="submit"], .submit-btn' }
    ]
  },
  Discover: {
    url: 'https://www.discover.com/credit-cards/member-benefits/',
    loginRequired: true,
    steps: [
      { action: 'navigate', url: 'https://www.discover.com/credit-cards/member-benefits/' },
      { action: 'click', selector: 'a:has-text("Price Protection"), .price-protection-link' },
      { action: 'fill', selector: '#itemName, input[name="itemName"]', field: 'productName' },
      { action: 'fill', selector: '#purchaseDate, input[name="purchaseDate"]', field: 'purchaseDate' },
      { action: 'fill', selector: '#purchasePrice, input[name="purchasePrice"]', field: 'originalPrice' },
      { action: 'fill', selector: '#currentPrice, input[name="currentPrice"]', field: 'newPrice' },
      { action: 'fill', selector: '#retailerName, input[name="retailerName"]', field: 'retailer' },
      { action: 'upload', selector: 'input[type="file"]', field: 'proofDocument' },
      { action: 'submit', selector: 'button[type="submit"]' }
    ]
  }
};

/**
 * Build the data object for form filling from a claim
 */
function buildFormData(claim) {
  return {
    lastFour: claim.creditCard.lastFour,
    purchaseDate: new Date(claim.purchase.purchaseDate).toLocaleDateString('en-US'),
    originalPrice: claim.originalPrice.toFixed(2),
    newPrice: claim.newPrice.toFixed(2),
    priceDifference: claim.priceDifference.toFixed(2),
    retailer: claim.purchase.retailer,
    productName: claim.purchase.productName,
    productUrl: claim.purchase.productUrl || '',
    orderId: claim.purchase.retailerOrderId || '',
    userName: claim.user?.name || claim.user?.email?.split('@')[0] || 'Cardholder',
    userEmail: claim.user?.email || '',
    claimId: claim.id
  };
}

/**
 * Try to fill a form field using multiple possible selectors
 */
async function tryFillField(page, selectorStr, value, timeout = 5000) {
  const selectors = selectorStr.split(',').map(s => s.trim());

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout });
      await page.click(selector, { clickCount: 3 }); // Select all existing text
      await page.type(selector, String(value), { delay: 50 });
      logger.info(`Filled field: ${selector}`);
      return true;
    } catch (e) {
      continue;
    }
  }

  logger.warn(`Could not fill any selector: ${selectorStr}`);
  return false;
}

/**
 * Try to click an element using multiple possible selectors
 */
async function tryClick(page, selectorStr, timeout = 5000) {
  const selectors = selectorStr.split(',').map(s => s.trim());

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout });
      await page.click(selector);
      logger.info(`Clicked: ${selector}`);
      return true;
    } catch (e) {
      continue;
    }
  }

  logger.warn(`Could not click any selector: ${selectorStr}`);
  return false;
}

/**
 * Attempt to file a claim through the issuer's online portal
 * Falls back to email if portal filing fails
 */
async function autoFileClaim(claimId) {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      purchase: true,
      creditCard: true,
      user: true
    }
  });

  if (!claim) throw new Error('Claim not found');
  if (!claim.creditCard) throw new Error('No credit card linked to this claim');

  const issuer = claim.creditCard.issuer;
  const portalConfig = CLAIM_PORTALS[issuer];

  // If no portal config, fall back to email-based filing
  if (!portalConfig) {
    logger.info(`No portal config for ${issuer}, using email-based filing`);
    return await fileClaimViaEmail(claim);
  }

  // Try portal-based filing
  logger.info(`Attempting portal-based filing for claim ${claimId} with ${issuer}`);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    const formData = buildFormData(claim);

    // Generate claim documentation first
    const doc = await claimService.generateClaimDocumentation(claim);

    // Execute form steps
    let stepSuccess = true;
    for (const step of portalConfig.steps) {
      try {
        switch (step.action) {
          case 'navigate':
            await page.goto(step.url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            break;

          case 'click':
            const clicked = await tryClick(page, step.selector, 8000);
            if (!clicked) {
              logger.warn(`Could not click ${step.selector}, continuing...`);
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
            break;

          case 'select':
            try {
              const selectSelectors = step.selector.split(',').map(s => s.trim());
              for (const sel of selectSelectors) {
                try {
                  await page.waitForSelector(sel, { timeout: 5000 });
                  await page.select(sel, step.value);
                  logger.info(`Selected "${step.value}" in ${sel}`);
                  break;
                } catch (e) { continue; }
              }
            } catch (e) {
              logger.warn(`Could not select ${step.selector}`);
            }
            break;

          case 'fill':
            const value = formData[step.field] || '';
            await tryFillField(page, step.selector, value);
            break;

          case 'upload':
            if (doc && doc.filePath) {
              try {
                const selectors = step.selector.split(',').map(s => s.trim());
                for (const sel of selectors) {
                  try {
                    const fileInput = await page.$(sel);
                    if (fileInput) {
                      await fileInput.uploadFile(doc.filePath);
                      logger.info(`Uploaded file to ${sel}`);
                      break;
                    }
                  } catch (e) { continue; }
                }
              } catch (e) {
                logger.warn(`Could not upload file: ${e.message}`);
              }
            }
            break;

          case 'submit':
            // Take screenshot before submitting
            const preSubmitPath = `/tmp/claim_${claimId}_pre_submit.png`;
            await page.screenshot({ path: preSubmitPath, fullPage: true });

            const submitted = await tryClick(page, step.selector, 8000);
            if (!submitted) {
              stepSuccess = false;
              logger.error('Could not find submit button');
            } else {
              // Wait for confirmation
              await new Promise(resolve => setTimeout(resolve, 5000));

              // Take screenshot of confirmation
              const confirmPath = `/tmp/claim_${claimId}_confirmation.png`;
              await page.screenshot({ path: confirmPath, fullPage: true });
            }
            break;
        }
      } catch (stepError) {
        logger.error(`Step failed (${step.action}): ${stepError.message}`);
        stepSuccess = false;
      }
    }

    // Try to extract confirmation number from the page
    let confirmationNumber = null;
    try {
      const pageText = await page.evaluate(() => document.body.innerText);
      const confirmMatch = pageText.match(/(?:confirmation|reference|claim|ticket)\s*(?:#|number|no\.?)?\s*:?\s*([A-Z0-9-]{6,20})/i);
      if (confirmMatch) {
        confirmationNumber = confirmMatch[1];
      }
    } catch (e) {
      logger.warn('Could not extract confirmation number');
    }

    await browser.close();
    browser = null;

    if (stepSuccess) {
      // Update claim as filed
      await prisma.claim.update({
        where: { id: claimId },
        data: {
          status: 'FILED',
          filedAt: new Date(),
          autoFiled: true,
          claimNumber: confirmationNumber,
          proofDocumentUrl: doc ? `/documents/${doc.fileName}` : null,
          statusHistory: [
            { status: 'FILED', timestamp: new Date().toISOString(), notes: `Auto-filed via ${issuer} portal` }
          ]
        }
      });

      await prisma.purchase.update({
        where: { id: claim.purchaseId },
        data: { status: 'CLAIM_FILED' }
      });

      await prisma.notification.create({
        data: {
          userId: claim.userId,
          type: 'CLAIM_FILED',
          title: 'Claim Filed Automatically!',
          message: `Your $${claim.priceDifference.toFixed(2)} claim for ${claim.purchase.productName} has been submitted through the ${issuer} portal.${confirmationNumber ? ` Confirmation: ${confirmationNumber}` : ''}`,
          data: { claimId: claim.id, confirmationNumber }
        }
      });

      return {
        success: true,
        method: 'portal',
        confirmationNumber: confirmationNumber || 'Pending',
        claimId,
        message: `Claim submitted through ${issuer} portal`
      };
    } else {
      // Portal filing failed, fall back to email
      logger.info(`Portal filing incomplete for ${issuer}, falling back to email`);
      return await fileClaimViaEmail(claim);
    }
  } catch (error) {
    logger.error(`Portal filing error for claim ${claimId}:`, error);

    if (browser) {
      try { await browser.close(); } catch (e) { }
    }

    // Fall back to email
    logger.info('Falling back to email-based filing');
    return await fileClaimViaEmail(claim);
  }
}

/**
 * File a claim via email as a fallback
 * Uses the main claimService.autoFileClaim method
 */
async function fileClaimViaEmail(claim) {
  try {
    const result = await claimService.autoFileClaim(claim.id);
    return {
      ...result,
      method: 'email',
      message: result.success
        ? `Claim submitted via email to ${claim.creditCard.issuer}`
        : 'Email filing also failed. Please file manually.'
    };
  } catch (error) {
    logger.error(`Email fallback failed for claim ${claim.id}:`, error);

    // Mark as ready to file manually
    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: 'READY_TO_FILE',
        responseNotes: `Auto-filing failed (both portal and email). Error: ${error.message}. Please file manually.`
      }
    });

    return {
      success: false,
      method: 'manual',
      claimId: claim.id,
      error: error.message,
      message: 'Auto-filing failed. Claim is ready for manual filing.',
      instructions: claimService.getFilingInstructions(claim)
    };
  }
}

module.exports = { autoFileClaim, fileClaimViaEmail, CLAIM_PORTALS };
