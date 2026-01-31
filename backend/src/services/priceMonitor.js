const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Price selectors for popular retailers
const PRICE_SELECTORS = {
  'amazon.com': [
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '#apex_offerDisplay_desktop .a-price .a-offscreen',
    'span[data-a-color="price"] .a-offscreen'
  ],
  'bestbuy.com': [
    '.priceView-customer-price span',
    '.priceView-hero-price span',
    '[data-testid="customer-price"] span'
  ],
  'walmart.com': [
    '[itemprop="price"]',
    '.price-characteristic',
    'span[data-automation="buybox-price"]'
  ],
  'target.com': [
    '[data-test="product-price"]',
    '.h-text-bs span',
    '.styles__CurrentPriceFontSize-sc-1fx04p3-0'
  ],
  'costco.com': [
    '#pull-right-price',
    '.your-price .value'
  ],
  'newegg.com': [
    '.price-current',
    '.product-price .price-current'
  ],
  'homedepot.com': [
    '.price__dollars',
    '[data-testid="productPrice"] .price'
  ],
  'lowes.com': [
    '.main-price',
    '[data-selector="splp-item-price"]'
  ]
};

// API-based price checking where available
const PRICE_APIS = {
  // Keepa API for Amazon (requires API key)
  amazon: async (asin) => {
    if (!process.env.KEEPA_API_KEY || !asin) return null;
    try {
      const response = await axios.get(
        `https://api.keepa.com/product?key=${process.env.KEEPA_API_KEY}&domain=1&asin=${asin}`
      );
      const product = response.data.products?.[0];
      if (product?.csv?.[0]) {
        // Keepa stores prices in cents
        const latestPrice = product.csv[0][product.csv[0].length - 1];
        return latestPrice > 0 ? latestPrice / 100 : null;
      }
    } catch (err) {
      logger.error('Keepa API error:', err);
    }
    return null;
  }
};

class PriceMonitor {
  constructor() {
    this.browser = null;
  }

  async getBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      });
    }
    return this.browser;
  }

  getDomainFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return null;
    }
  }

  async checkPriceForPurchase(purchaseId) {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { user: true, creditCard: true }
    });

    if (!purchase || !purchase.productUrl) {
      return { success: false, error: 'No product URL' };
    }

    try {
      const currentPrice = await this.scrapePrice(purchase.productUrl);

      if (currentPrice === null) {
        return { success: false, error: 'Could not fetch price' };
      }

      // Record price history
      await prisma.priceHistory.create({
        data: {
          purchaseId,
          price: currentPrice,
          source: this.getDomainFromUrl(purchase.productUrl) || 'web'
        }
      });

      // Calculate price drop
      const priceDrop = purchase.purchasePrice - currentPrice;
      const priceDropPercent = (priceDrop / purchase.purchasePrice) * 100;

      // Update purchase with new price info
      const updateData = {
        currentPrice
      };

      // Check if this is the new lowest price
      if (!purchase.lowestPrice || currentPrice < purchase.lowestPrice) {
        updateData.lowestPrice = currentPrice;
        updateData.lowestPriceDate = new Date();
      }

      // Determine if claim-eligible
      const isWithinProtection = purchase.protectionEnds && purchase.protectionEnds > new Date();
      const meetsThreshold = priceDrop >= (purchase.user?.priceDropThreshold || 5);

      if (priceDrop > 0 && meetsThreshold) {
        updateData.status = isWithinProtection ? 'CLAIM_ELIGIBLE' : 'PRICE_DROP_DETECTED';

        // Send notification if significant drop
        await prisma.notification.create({
          data: {
            userId: purchase.userId,
            type: 'PRICE_DROP',
            title: 'Price Drop Detected! 💰',
            message: `${purchase.productName} dropped by $${priceDrop.toFixed(2)} (${priceDropPercent.toFixed(1)}%)${isWithinProtection ? ' - Eligible for claim!' : ''}`,
            data: {
              purchaseId,
              priceDrop,
              priceDropPercent,
              newPrice: currentPrice,
              isEligible: isWithinProtection
            }
          }
        });

        logger.info(`Price drop detected for ${purchaseId}: $${priceDrop.toFixed(2)} (${priceDropPercent.toFixed(1)}%)`);
      }

      await prisma.purchase.update({
        where: { id: purchaseId },
        data: updateData
      });

      return {
        success: true,
        previousPrice: purchase.currentPrice,
        currentPrice,
        priceDrop,
        priceDropPercent,
        isEligible: isWithinProtection && meetsThreshold
      };
    } catch (error) {
      logger.error(`Price check failed for purchase ${purchaseId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async scrapePrice(url) {
    const domain = this.getDomainFromUrl(url);

    // Try API first for supported retailers
    if (domain === 'amazon.com') {
      const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (asinMatch) {
        const apiPrice = await PRICE_APIS.amazon(asinMatch[1]);
        if (apiPrice) return apiPrice;
      }
    }

    // Fall back to scraping
    const selectors = PRICE_SELECTORS[domain];
    if (!selectors) {
      // Try generic selectors
      return this.scrapeWithGenericSelectors(url);
    }

    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Block unnecessary resources
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Try each selector
      let price = null;
      for (const selector of selectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            const text = await page.evaluate(el => el.textContent, element);
            price = this.parsePrice(text);
            if (price) break;
          }
        } catch (e) {
          continue;
        }
      }

      await page.close();
      return price;
    } catch (error) {
      logger.error(`Scraping failed for ${url}:`, error);
      return null;
    }
  }

  async scrapeWithGenericSelectors(url) {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const html = await page.content();
      const $ = cheerio.load(html);

      // Generic price selectors
      const genericSelectors = [
        '[itemprop="price"]',
        '[class*="price"]',
        '[class*="Price"]',
        '[data-price]',
        '.product-price',
        '.sale-price',
        '.current-price'
      ];

      let price = null;
      for (const selector of genericSelectors) {
        const element = $(selector).first();
        if (element.length) {
          const text = element.attr('content') || element.text();
          price = this.parsePrice(text);
          if (price && price > 0 && price < 50000) {
            break;
          }
        }
      }

      await page.close();
      return price;
    } catch (error) {
      logger.error(`Generic scraping failed for ${url}:`, error);
      return null;
    }
  }

  parsePrice(text) {
    if (!text) return null;

    // Remove common currency symbols and clean up
    const cleaned = text
      .replace(/[£€¥₹]/g, '')
      .replace(/\s/g, '')
      .replace(/,/g, '');

    // Match price pattern
    const match = cleaned.match(/\$?([\d.]+)/);
    if (match) {
      const price = parseFloat(match[1]);
      if (!isNaN(price) && price > 0) {
        return price;
      }
    }

    return null;
  }

  async checkAllEligiblePurchases() {
    const purchases = await prisma.purchase.findMany({
      where: {
        status: { in: ['MONITORING', 'PRICE_DROP_DETECTED'] },
        productUrl: { not: null },
        protectionEnds: { gte: new Date() }
      },
      orderBy: { updatedAt: 'asc' },
      take: parseInt(process.env.MAX_PRICE_CHECKS_PER_DAY) || 1000
    });

    logger.info(`Starting price check for ${purchases.length} purchases`);

    const results = {
      checked: 0,
      priceDrops: 0,
      errors: 0
    };

    for (const purchase of purchases) {
      try {
        const result = await this.checkPriceForPurchase(purchase.id);
        results.checked++;

        if (result.priceDrop > 0) {
          results.priceDrops++;
        }

        // Rate limiting - wait between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        results.errors++;
        logger.error(`Price check error for ${purchase.id}:`, error);
      }
    }

    logger.info(`Price check completed: ${results.checked} checked, ${results.priceDrops} drops, ${results.errors} errors`);

    return results;
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new PriceMonitor();
