const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { AppError } = require('./errorHandler');

const prisma = new PrismaClient();

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        subscriptionStatus: true,
        gmailConnected: true,
        autoFileClaimsEnabled: true
      }
    });

    if (!user) {
      throw new AppError('User not found', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Check if user has active subscription
const requireSubscription = (req, res, next) => {
  if (req.user.subscriptionStatus !== 'ACTIVE') {
    return next(new AppError('Active subscription required', 403, 'SUBSCRIPTION_REQUIRED'));
  }
  next();
};

// Allow limited access for free users
const optionalSubscription = (req, res, next) => {
  req.hasSubscription = req.user.subscriptionStatus === 'ACTIVE';
  next();
};

module.exports = { authenticate, requireSubscription, optionalSubscription };
