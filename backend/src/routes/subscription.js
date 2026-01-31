const express = require('express');
const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Get subscription status
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        subscriptionStatus: true,
        subscriptionId: true,
        subscriptionEndDate: true,
        stripeCustomerId: true
      }
    });

    let subscription = null;
    if (user.subscriptionId) {
      try {
        subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
      } catch (e) {
        // Subscription might have been deleted
      }
    }

    res.json({
      status: user.subscriptionStatus,
      endDate: user.subscriptionEndDate,
      subscription: subscription ? {
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        priceId: subscription.items.data[0]?.price.id
      } : null
    });
  } catch (error) {
    next(error);
  }
});

// Create checkout session
router.post('/checkout', authenticate, async (req, res, next) => {
  try {
    let customerId = req.user.stripeCustomerId;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id }
      });

      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user.id
        }
      });

      customerId = customer.id;

      await prisma.user.update({
        where: { id: req.user.id },
        data: { stripeCustomerId: customerId }
      });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      success_url: `${process.env.FRONTEND_URL}/settings/subscription?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/settings/subscription?canceled=true`,
      subscription_data: {
        metadata: {
          userId: req.user.id
        }
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

// Create billing portal session
router.post('/portal', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user.stripeCustomerId) {
      throw new AppError('No subscription found', 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/settings/subscription`
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

// Cancel subscription
router.post('/cancel', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user.subscriptionId) {
      throw new AppError('No active subscription', 404);
    }

    // Cancel at period end
    await stripe.subscriptions.update(user.subscriptionId, {
      cancel_at_period_end: true
    });

    res.json({ message: 'Subscription will be canceled at the end of the billing period' });
  } catch (error) {
    next(error);
  }
});

// Resume subscription (if set to cancel)
router.post('/resume', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user.subscriptionId) {
      throw new AppError('No subscription found', 404);
    }

    await stripe.subscriptions.update(user.subscriptionId, {
      cancel_at_period_end: false
    });

    res.json({ message: 'Subscription resumed' });
  } catch (error) {
    next(error);
  }
});

// Get pricing info
router.get('/pricing', async (req, res, next) => {
  try {
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID, {
      expand: ['product']
    });

    res.json({
      priceId: price.id,
      amount: price.unit_amount / 100,
      currency: price.currency,
      interval: price.recurring?.interval,
      productName: price.product.name,
      features: price.product.metadata?.features?.split(',') || [
        'Unlimited purchase tracking',
        'Automatic price monitoring',
        'Claim documentation generation',
        'Email notifications for price drops',
        'Priority support'
      ]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
