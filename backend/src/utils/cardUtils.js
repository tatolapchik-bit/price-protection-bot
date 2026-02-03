/**
 * Card Issuer Detection Utility
 * Detects card issuer and type from card number using IIN/BIN ranges
 */

// Card issuer configurations with IIN/BIN ranges and price protection details
const CARD_ISSUERS = {
  amex: {
    name: 'American Express',
    shortName: 'Amex',
    patterns: [/^3[47]/],
    lengths: [15],
    cardType: 'AMEX',
    priceProtection: {
      protectionDays: 90,
      maxClaimAmount: 300,
      claimMethod: 'EMAIL',
      claimEmail: 'priceprotection@americanexpress.com',
      claimPhone: '1-800-297-8019',
      claimPortalUrl: null
    }
  },
  visa: {
    name: 'Visa',
    shortName: 'Visa',
    patterns: [/^4/],
    lengths: [13, 16, 19],
    cardType: 'VISA',
    priceProtection: {
      protectionDays: 60,
      maxClaimAmount: 250,
      claimMethod: 'PHONE',
      claimEmail: null,
      claimPhone: null,
      claimPortalUrl: null
    }
  },
  mastercard: {
    name: 'Mastercard',
    shortName: 'Mastercard',
    patterns: [/^5[1-5]/, /^2[2-7]/],
    lengths: [16],
    cardType: 'MASTERCARD',
    priceProtection: {
      protectionDays: 60,
      maxClaimAmount: 250,
      claimMethod: 'PHONE',
      claimEmail: null,
      claimPhone: null,
      claimPortalUrl: null
    }
  },
  discover: {
    name: 'Discover',
    shortName: 'Discover',
    patterns: [/^6011/, /^65/, /^64[4-9]/],
    lengths: [16, 19],
    cardType: 'DISCOVER',
    priceProtection: {
      protectionDays: 90,
      maxClaimAmount: 500,
      claimMethod: 'ONLINE_PORTAL',
      claimEmail: null,
      claimPhone: '1-800-347-2683',
      claimPortalUrl: 'https://www.discover.com/credit-cards/member-benefits/'
    }
  }
};

const BANK_ISSUERS = {
  chase: {
    name: 'Chase',
    binRanges: ['414720', '414721', '421413', '423456'],
    priceProtection: {
      protectionDays: 120,
      maxClaimAmount: 500,
      claimMethod: 'ONLINE_PORTAL',
      claimEmail: null,
      claimPhone: '1-888-320-9961',
      claimPortalUrl: 'https://www.chasebenefits.com/chase'
    }
  },
  citi: {
    name: 'Citi',
    binRanges: ['417500', '541234'],
    priceProtection: {
      protectionDays: 60,
      maxClaimAmount: 250,
      claimMethod: 'PHONE',
      claimEmail: null,
      claimPhone: '1-866-918-4969',
      claimPortalUrl: 'https://www.cardbenefitservices.com/ebdcaz/completeReg.do'
    }
  },
  capitalone: {
    name: 'Capital One',
    binRanges: ['414709', '524896'],
    priceProtection: {
      protectionDays: 60,
      maxClaimAmount: 250,
      claimMethod: 'PHONE',
      claimEmail: null,
      claimPhone: '1-800-227-4825',
      claimPortalUrl: null
    }
  }
};

function detectCardIssuer(cardNumber) {
  const cleanNumber = cardNumber.replace(/\D/g, '');
  if (!cleanNumber || cleanNumber.length < 13) {
    return { error: 'Invalid card number', issuer: null, cardType: 'OTHER' };
  }
  for (const [key, issuer] of Object.entries(CARD_ISSUERS)) {
    for (const pattern of issuer.patterns) {
      if (pattern.test(cleanNumber) && issuer.lengths.includes(cleanNumber.length)) {
        return {
          issuer: issuer.shortName,
          issuerKey: key,
          fullName: issuer.name,
          cardType: issuer.cardType,
          lastFour: cleanNumber.slice(-4),
          maskedNumber: maskCardNumber(cleanNumber),
          priceProtection: issuer.priceProtection,
          isValid: luhnCheck(cleanNumber)
        };
      }
    }
  }
  return {
    issuer: 'Unknown',
    issuerKey: 'unknown',
    fullName: 'Unknown Card Issuer',
    cardType: 'OTHER',
    lastFour: cleanNumber.slice(-4),
    maskedNumber: maskCardNumber(cleanNumber),
    priceProtection: null,
    isValid: luhnCheck(cleanNumber)
  };
}

function maskCardNumber(cardNumber) {
  const clean = cardNumber.replace(/\D/g, '');
  if (clean.length < 10) return clean;
  const firstSix = clean.slice(0, 6);
  const lastFour = clean.slice(-4);
  const middleLength = clean.length - 10;
  return firstSix + '*'.repeat(middleLength) + lastFour;
}

function luhnCheck(cardNumber) {
  const clean = cardNumber.replace(/\D/g, '');
  if (!clean) return false;
  let sum = 0;
  let isEven = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean[i], 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

function getPriceProtectionInfo(issuer) {
  const issuerKey = issuer.toLowerCase().replace(/\s+/g, '');
  if (CARD_ISSUERS[issuerKey]) return CARD_ISSUERS[issuerKey].priceProtection;
  if (BANK_ISSUERS[issuerKey]) return BANK_ISSUERS[issuerKey].priceProtection;
  return { protectionDays: 60, maxClaimAmount: 250, claimMethod: 'PHONE', claimEmail: null, claimPhone: null, claimPortalUrl: null };
}

function getClaimEmailForIssuer(issuer) {
  const issuerKey = issuer.toLowerCase().replace(/\s+/g, '');
  if (CARD_ISSUERS[issuerKey]?.priceProtection?.claimEmail) return CARD_ISSUERS[issuerKey].priceProtection.claimEmail;
  if (BANK_ISSUERS[issuerKey]?.priceProtection?.claimEmail) return BANK_ISSUERS[issuerKey].priceProtection.claimEmail;
  const fallbackEmails = {
    'amex': 'priceprotection@americanexpress.com',
    'americanexpress': 'priceprotection@americanexpress.com',
    'chase': 'priceprotection@chase.com',
    'citi': 'priceprotection@citi.com',
    'discover': 'priceprotection@discover.com',
    'capitalone': 'priceprotection@capitalone.com'
  };
  return fallbackEmails[issuerKey] || null;
}

function encryptCardNumber(cardNumber) {
  const clean = cardNumber.replace(/\D/g, '');
  return Buffer.from(clean).toString('base64');
}

function decryptCardNumber(encrypted) {
  return Buffer.from(encrypted, 'base64').toString('utf8');
}

module.exports = {
  detectCardIssuer,
  maskCardNumber,
  luhnCheck,
  getPriceProtectionInfo,
  getClaimEmailForIssuer,
  encryptCardNumber,
  decryptCardNumber,
  CARD_ISSUERS,
  BANK_ISSUERS
};
