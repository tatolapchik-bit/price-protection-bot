const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

// Initialize Anthropic client - uses ANTHROPIC_API_KEY env var automatically
let anthropic = null;

function getAnthropicClient() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.error('ANTHROPIC_API_KEY environment variable is not set!');
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    anthropic = new Anthropic();
    logger.info('Anthropic client initialized');
  }
  return anthropic;
}

/**
 * Parse an email using Claude AI to extract purchase information
 * @param {Object} emailData - Email data from mailparser
 * @returns {Object} Parsed purchase data or indication it's not a purchase
 */
async function parseEmailWithAI(emailData) {
  const { subject, from, date, textContent, htmlContent } = emailData;

  // Prefer text content, fall back to stripped HTML
  const body = textContent || stripHtml(htmlContent);

  // Truncate body to avoid token limits (keep first 8000 chars)
  const truncatedBody = body.substring(0, 8000);

  const prompt = `Analyze this email and determine if it's a purchase/order confirmation email.

EMAIL DETAILS:
From: ${from}
Subject: ${subject}
Date: ${date}
Body:
${truncatedBody}

INSTRUCTIONS:
1. Determine if this is a purchase confirmation, order receipt, or shipping notification for an actual product purchase
2. If it IS a purchase email, extract the following information:
   - The actual product name(s) purchased (NOT the email subject - find the real item name)
   - The price of each item
   - The retailer/store name
   - Order ID if present
   - The purchase date
   - Product URL if available (link to the product page)

If this IS a purchase/order email, respond with this JSON format:
{
  "isPurchase": true,
  "items": [
    {
      "productName": "The actual product name from the email body",
      "price": 123.45,
      "quantity": 1,
      "productUrl": "https://retailer.com/product/... or null if not found"
    }
  ],
  "retailer": "Store Name",
  "orderId": "order number or null",
  "purchaseDate": "YYYY-MM-DD",
  "totalPrice": 123.45,
  "category": "electronics|clothing|travel|food|services|home|other"
}

If this is NOT a purchase email (marketing, newsletter, account notification, etc.), respond with:
{
  "isPurchase": false,
  "reason": "Brief explanation of why this isn't a purchase email"
}

IMPORTANT: Return ONLY valid JSON, no other text.`;

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = response.content[0].text.trim();

    // Parse the JSON response
    const parsed = JSON.parse(responseText);

    logger.info('AI parsing result', {
      subject,
      isPurchase: parsed.isPurchase,
      retailer: parsed.retailer || 'N/A'
    });

    return parsed;
  } catch (error) {
    logger.error('AI parsing failed', {
      error: error.message,
      subject
    });

    // Return non-purchase on error to avoid blocking
    return {
      isPurchase: false,
      reason: 'AI parsing error: ' + error.message
    };
  }
}

/**
 * Strip HTML tags from content
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Quick check if an email is likely a purchase (for pre-filtering)
 * This is a fast regex-based check before calling the AI
 */
function isLikelyPurchase(emailData) {
  const { subject, from } = emailData;
  const subjectLower = (subject || '').toLowerCase();
  const fromLower = (from || '').toLowerCase();

  // Keywords that suggest purchase/order emails
  const purchaseKeywords = [
    'order', 'receipt', 'confirmation', 'purchase', 'invoice',
    'booking', 'itinerary', 'shipped', 'shipping', 'delivery',
    'payment', 'transaction', 'your order', 'order #', 'thank you for your'
  ];

  // Domains that typically send purchase emails
  const purchaseDomains = [
    'amazon', 'bestbuy', 'walmart', 'target', 'costco', 'newegg',
    'homedepot', 'lowes', 'ebay', 'apple', 'microsoft', 'dell',
    'hp.com', 'lenovo', 'samsung', 'lg.com', 'sony', 'nike',
    'adidas', 'nordstrom', 'macys', 'kohls', 'jcpenney', 'wayfair',
    'overstock', 'chewy', 'petco', 'petsmart', 'ticketmaster',
    'stubhub', 'eventbrite', 'uber', 'lyft', 'doordash', 'grubhub',
    'instacart', 'postmates', 'airbnb', 'booking.com', 'expedia',
    'hotels.com', 'southwest', 'delta', 'united', 'american airlines',
    'jetblue', 'spirit', 'frontier', 'kayak', 'priceline'
  ];

  // Check subject for purchase keywords
  const hasKeyword = purchaseKeywords.some(kw => subjectLower.includes(kw));

  // Check if from a known retailer domain
  const hasRetailerDomain = purchaseDomains.some(domain => fromLower.includes(domain));

  return hasKeyword || hasRetailerDomain;
}

/**
 * Generate a Google search URL for price checking a product
 */
function generatePriceCheckUrl(productName, retailer) {
  const searchQuery = encodeURIComponent(`${productName} price ${retailer || ''}`);
  return `https://www.google.com/search?q=${searchQuery}&tbm=shop`;
}

module.exports = {
  parseEmailWithAI,
  isLikelyPurchase,
  stripHtml,
  generatePriceCheckUrl
};
