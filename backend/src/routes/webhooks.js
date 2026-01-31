const express = require('express');
const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe webhook - needs raw body
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', err);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  logger.info(`Stripe webhook received: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.subscription_data?.metadata?.userId;

        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);

          await prisma.user.update({
            where: { id: userId },
            data: {
              subscriptionId: subscription.id,
              subscriptionStatus: 'ACTIVE',
              subscriptionEndDate: new Date(subscription.current_period_end * 1000)
            }
          });

          // Send welcome notification
          await prisma.notification.create({
            data: {
              userId,
              type: 'SUBSCRIPTION',
              title: 'Welcome to PriceProtectionBot Pro!',
              message: 'Your subscription is now active. Start adding purchases to track and save money!'
            }
          });

          logger.info(`Subscription activated for user ${userId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          // Try to find user by customer ID
          const user = await prisma.user.findFirst({
            where: { stripeCustomerId: subscription.customer }
          });
          if (user) {
            await updateUserSubscription(user.id, subscription);
          }
        } else {
          await updateUserSubscription(userId, subscription);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        const user = await prisma.user.findFirst({
          where: { subscriptionId: subscription.id }
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'CANCELED',
              subscriptionEndDate: new Date()
            }
          });

          await prisma.notification.create({
            data: {
              userId: user.id,
              type: 'SUBSCRIPTION',
              title: 'Subscription Canceled',
              message: 'Your subscription has ended. Resubscribe to continue tracking prices and filing claims.'
            }
          });

          logger.info(`Subscription canceled for user ${user.id}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;

        if (invoice.subscription) {
          const user = await prisma.user.findFirst({
            where: { subscriptionId: invoice.subscription }
          });

          if (user) {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

            await prisma.user.update({
              where: { id: user.id },
              data: {
                subscriptionStatus: 'ACTIVE',
                subscriptionEndDate: new Date(subscription.current_period_end * 1000)
              }
            });

            logger.info(`Payment succeeded for user ${user.id}`);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;

        if (invoice.subscription) {
          const user = await prisma.user.findFirst({
            where: { subscriptionId: invoice.subscription }
          });

          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: { subscriptionStatus: 'PAST_DUE' }
            });

            await prisma.notification.create({
              data: {
                userId: user.id,
                type: 'SUBSCRIPTION',
                title: 'Payment Failed',
                message: 'Your subscription payment failed. Please update your payment method to continue service.'
              }
            });

            logger.warn(`Payment failed for user ${user.id}`);
          }
        }
        break;
      }

      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing Stripe webhook', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function updateUserSubscription(userId, subscription) {
  const status = subscription.status === 'active' ? 'ACTIVE' :
    subscription.status === 'past_due' ? 'PAST_DUE' :
      subscription.status === 'canceled' ? 'CANCELED' : 'ACTIVE';

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: status,
      subscriptionEndDate: new Date(subscription.current_period_end * 1000)
    }
  });

  logger.info(`Subscription updated for user ${userId}: ${status}`);
}

module.exports = router;
