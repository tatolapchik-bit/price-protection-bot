const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Register with email/password
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').optional().trim()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { email, password, name } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError('Email already registered', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        notificationEmail: email
      },
      select: { id: true, email: true, name: true }
    });

    const token = generateToken(user.id);

    res.status(201).json({
      user,
      token
    });
  } catch (error) {
    next(error);
  }
});

// Login with email/password
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Invalid credentials', 400);
    }

    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new AppError('Invalid credentials', 401);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = generateToken(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        gmailConnected: user.gmailConnected
      },
      token
    });
  } catch (error) {
    next(error);
  }
});

// Google OAuth - Get auth URL
router.get('/google', (req, res) => {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.json({ url });
});

// Google OAuth - Callback
router.get('/google/callback', async (req, res, next) => {
  try {
    const { code } = req.query;

    if (!code) {
      throw new AppError('No authorization code provided', 400);
    }

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId },
          { email }
        ]
      }
    });

    if (user) {
      // Update existing user with Google credentials
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId,
          gmailAccessToken: tokens.access_token,
          gmailRefreshToken: tokens.refresh_token || user.gmailRefreshToken,
          gmailConnected: true
        }
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          email,
          name,
          googleId,
          gmailAccessToken: tokens.access_token,
          gmailRefreshToken: tokens.refresh_token,
          gmailConnected: true,
          notificationEmail: email
        }
      });
    }

    const token = generateToken(user.id);

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        subscriptionStatus: true,
        subscriptionEndDate: true,
        gmailConnected: true,
        autoFileClaimsEnabled: true,
        priceDropThreshold: true,
        notificationEmail: true,
        createdAt: true,
        _count: {
          select: {
            purchases: true,
            claims: true,
            creditCards: true
          }
        }
      }
    });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Update user settings
router.patch('/settings', authenticate, [
  body('autoFileClaimsEnabled').optional().isBoolean(),
  body('priceDropThreshold').optional().isFloat({ min: 1, max: 100 }),
  body('notificationEmail').optional().isEmail(),
  body('name').optional().trim()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { autoFileClaimsEnabled, priceDropThreshold, notificationEmail, name } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(autoFileClaimsEnabled !== undefined && { autoFileClaimsEnabled }),
        ...(priceDropThreshold !== undefined && { priceDropThreshold }),
        ...(notificationEmail && { notificationEmail }),
        ...(name && { name })
      },
      select: {
        id: true,
        autoFileClaimsEnabled: true,
        priceDropThreshold: true,
        notificationEmail: true,
        name: true
      }
    });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Disconnect Gmail
router.post('/gmail/disconnect', authenticate, async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        gmailAccessToken: null,
        gmailRefreshToken: null,
        gmailConnected: false
      }
    });

    res.json({ message: 'Gmail disconnected successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
