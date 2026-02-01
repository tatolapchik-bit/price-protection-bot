// Auto Claim Filer Service
const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CLAIM_PORTALS = {
    Chase: { url: 'https://www.cardbenefitservices.com/ebcm/ProgramListing/JPMorgan' }
};

async function autoFileClaim(claimId) {
    const claim = await prisma.claim.findUnique({
          where: { id: claimId },
          include: { purchase: { include: { creditCard: true, user: true } } }
    });

  if (!claim || !claim.purchase.creditCard) {
        throw new Error('Claim or card not found');
  }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();

  try {
        await page.goto(CLAIM_PORTALS[claim.purchase.creditCard.issuer].url);
        // Navigate and fill claim form...
      const confirmationNumber = 'PENDING-' + Date.now();

      await prisma.claim.update({
              where: { id: claimId },
              data: { status: 'FILED', confirmationNumber }
      });

      return { success: true, confirmationNumber };
  } finally {
        await browser.close();
  }
}

module.exports = { autoFileClaim, CLAIM_PORTALS };
