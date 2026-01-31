import React from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { subscriptionAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function Subscription() {
  const [searchParams] = useSearchParams();
  const { hasSubscription } = useAuth();

  const success = searchParams.get('success');
  const canceled = searchParams.get('canceled');

  const { data: status } = useQuery({
    queryKey: ['subscription-status'],
    queryFn: () => subscriptionAPI.getStatus()
  });

  const { data: pricing } = useQuery({
    queryKey: ['pricing'],
    queryFn: () => subscriptionAPI.getPricing()
  });

  const checkoutMutation = useMutation({
    mutationFn: () => subscriptionAPI.createCheckout(),
    onSuccess: (result) => {
      window.location.href = result.data.url;
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to start checkout');
    }
  });

  const portalMutation = useMutation({
    mutationFn: () => subscriptionAPI.createPortal(),
    onSuccess: (result) => {
      window.location.href = result.data.url;
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to open portal');
    }
  });

  const cancelMutation = useMutation({
    mutationFn: () => subscriptionAPI.cancel(),
    onSuccess: () => {
      toast.success('Subscription will be canceled at period end');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to cancel');
    }
  });

  const features = pricing?.data?.features || [
    'Unlimited purchase tracking',
    'Automatic price monitoring',
    'Claim documentation generation',
    'Email notifications for price drops',
    'Priority support'
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/settings"
        className="text-gray-600 hover:text-gray-900 text-sm mb-6 inline-block"
      >
        ← Back to Settings
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Subscription</h1>

      {/* Success/Canceled Messages */}
      {success && (
        <div className="card bg-green-50 border-green-200 p-6 mb-6">
          <div className="flex items-center">
            <CheckCircleIcon className="h-8 w-8 text-green-500 mr-4" />
            <div>
              <h2 className="text-lg font-bold text-green-900">Welcome to Pro!</h2>
              <p className="text-green-700">Your subscription is now active.</p>
            </div>
          </div>
        </div>
      )}

      {canceled && (
        <div className="card bg-yellow-50 border-yellow-200 p-6 mb-6">
          <p className="text-yellow-800">
            Checkout was canceled. No charges were made.
          </p>
        </div>
      )}

      {/* Current Status */}
      {hasSubscription && status?.data && (
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Plan</h2>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-medium text-gray-900">Pro Plan</p>
              <p className="text-sm text-gray-500">
                ${pricing?.data?.amount || 15}/{pricing?.data?.interval || 'month'}
              </p>
            </div>
            <span className="badge-green">Active</span>
          </div>

          {status.data.subscription && (
            <div className="text-sm text-gray-600 space-y-1">
              <p>
                Next billing date:{' '}
                {format(new Date(status.data.subscription.currentPeriodEnd), 'MMMM d, yyyy')}
              </p>
              {status.data.subscription.cancelAtPeriodEnd && (
                <p className="text-yellow-600">
                  ⚠️ Will be canceled at period end
                </p>
              )}
            </div>
          )}

          <div className="mt-4 pt-4 border-t flex space-x-4">
            <button
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="btn-secondary"
            >
              Manage Billing
            </button>
            {!status.data.subscription?.cancelAtPeriodEnd && (
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to cancel your subscription?')) {
                    cancelMutation.mutate();
                  }
                }}
                disabled={cancelMutation.isPending}
                className="text-red-600 hover:text-red-700 text-sm"
              >
                Cancel Subscription
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pricing Card */}
      {!hasSubscription && (
        <div className="card p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Pro Plan</h2>
            <div className="mt-4">
              <span className="text-5xl font-bold text-gray-900">
                ${pricing?.data?.amount || 15}
              </span>
              <span className="text-gray-500">/{pricing?.data?.interval || 'month'}</span>
            </div>
            <p className="text-gray-600 mt-2">
              Everything you need to maximize your savings
            </p>
          </div>

          <ul className="space-y-4 mb-8">
            {features.map((feature, idx) => (
              <li key={idx} className="flex items-center">
                <CheckCircleIcon className="h-5 w-5 text-green-500 mr-3 flex-shrink-0" />
                <span className="text-gray-700">{feature}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={() => checkoutMutation.mutate()}
            disabled={checkoutMutation.isPending}
            className="w-full btn-primary py-3 text-lg"
          >
            {checkoutMutation.isPending ? 'Loading...' : 'Subscribe Now'}
          </button>

          <p className="text-center text-sm text-gray-500 mt-4">
            14-day money-back guarantee. Cancel anytime.
          </p>
        </div>
      )}

      {/* FAQ */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">FAQ</h2>

        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-medium text-gray-900">Can I cancel anytime?</h3>
            <p className="text-gray-600 mt-1">
              Yes, you can cancel your subscription at any time. You'll continue to have access
              until the end of your billing period.
            </p>
          </div>

          <div className="card p-4">
            <h3 className="font-medium text-gray-900">What's the money-back guarantee?</h3>
            <p className="text-gray-600 mt-1">
              If you don't save at least the cost of your subscription in your first month,
              we'll refund your payment in full.
            </p>
          </div>

          <div className="card p-4">
            <h3 className="font-medium text-gray-900">What payment methods do you accept?</h3>
            <p className="text-gray-600 mt-1">
              We accept all major credit cards (Visa, Mastercard, American Express, Discover)
              through our secure payment processor, Stripe.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
