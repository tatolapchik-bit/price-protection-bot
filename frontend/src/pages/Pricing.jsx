import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircleIcon } from '@heroicons/react/24/outline';

export default function Pricing() {
  const features = [
    'Unlimited purchase tracking',
    'Automatic email scanning (Gmail)',
    'Price monitoring every 6 hours',
    'Claim documentation generation',
    'Email notifications for price drops',
    'Support for all major retailers',
    'Support for all major credit cards',
    'Priority customer support',
    'Money-back guarantee'
  ];

  return (
    <div className="bg-white min-h-screen">
      {/* Header */}
      <header className="border-b">
        <nav className="flex items-center justify-between p-6 max-w-7xl mx-auto">
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-purple-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold">PP</span>
            </div>
            <span className="text-xl font-bold text-gray-900">PriceProtectionBot</span>
          </Link>
          <div className="flex gap-x-6">
            <Link to="/login" className="text-sm font-semibold text-gray-900 hover:text-primary-600">
              Log in
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      {/* Pricing Section */}
      <div className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">
              Simple, transparent pricing
            </h1>
            <p className="mt-4 text-xl text-gray-600">
              One plan with everything you need. No hidden fees.
            </p>
          </div>

          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-3xl shadow-xl border-2 border-primary-500 p-8">
              <div className="text-center">
                <span className="bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-sm font-medium">
                  Most Popular
                </span>
                <h2 className="mt-4 text-3xl font-bold text-gray-900">Pro</h2>
                <div className="mt-4">
                  <span className="text-6xl font-bold text-gray-900">$15</span>
                  <span className="text-xl text-gray-500">/month</span>
                </div>
                <p className="mt-4 text-gray-600">
                  Everything you need to maximize your credit card price protection benefits.
                </p>
              </div>

              <ul className="mt-8 space-y-4">
                {features.map((feature, idx) => (
                  <li key={idx} className="flex items-center">
                    <CheckCircleIcon className="h-6 w-6 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/register"
                className="mt-8 w-full block text-center bg-primary-600 text-white py-4 rounded-xl font-semibold text-lg hover:bg-primary-500 transition-colors"
              >
                Start Free Trial
              </Link>

              <p className="mt-4 text-center text-sm text-gray-500">
                14-day free trial. No credit card required.
              </p>
            </div>
          </div>

          {/* Value Proposition */}
          <div className="mt-24 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Is it worth $15/month?
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              The average person saves over $500/year in price protection claims - that's a
              33x return on your subscription. Even if you only recover one $50 claim,
              you've already paid for 3+ months of service.
            </p>

            <div className="mt-8 grid md:grid-cols-3 gap-8 max-w-3xl mx-auto">
              <div className="card p-6">
                <div className="text-3xl font-bold text-primary-600">$500+</div>
                <div className="text-sm text-gray-600 mt-1">Average annual savings</div>
              </div>
              <div className="card p-6">
                <div className="text-3xl font-bold text-primary-600">33x</div>
                <div className="text-sm text-gray-600 mt-1">Return on subscription</div>
              </div>
              <div className="card p-6">
                <div className="text-3xl font-bold text-primary-600">90%</div>
                <div className="text-sm text-gray-600 mt-1">Claim approval rate</div>
              </div>
            </div>
          </div>

          {/* FAQ */}
          <div className="mt-24 max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
              Frequently Asked Questions
            </h2>

            <div className="space-y-6">
              {[
                {
                  q: "How does the 14-day free trial work?",
                  a: "You get full access to all features for 14 days. No credit card required to start. If you decide to subscribe, you'll enter your payment info at the end of the trial."
                },
                {
                  q: "Can I cancel anytime?",
                  a: "Yes! You can cancel your subscription at any time with no penalties. You'll keep access until the end of your billing period."
                },
                {
                  q: "What's your money-back guarantee?",
                  a: "If you don't save at least $15 (the cost of one month's subscription) within your first 30 days, we'll refund your payment in full."
                },
                {
                  q: "Which credit cards are supported?",
                  a: "We support price protection programs from Chase, Citi, American Express, Discover, Capital One, and most other major issuers. We're constantly adding support for more."
                },
                {
                  q: "Which retailers can you track?",
                  a: "We track prices from 50+ major retailers including Amazon, Best Buy, Walmart, Target, Costco, Home Depot, and many more."
                },
                {
                  q: "Is my data secure?",
                  a: "Yes! We use bank-level encryption and never store your credit card numbers. Your email data is processed securely and never shared with third parties."
                }
              ].map((item, idx) => (
                <div key={idx} className="card p-6">
                  <h3 className="font-semibold text-gray-900">{item.q}</h3>
                  <p className="text-gray-600 mt-2">{item.a}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="mt-24 text-center">
            <h2 className="text-3xl font-bold text-gray-900">
              Ready to start saving?
            </h2>
            <p className="mt-4 text-gray-600">
              Join thousands of smart shoppers who are recovering money they're owed.
            </p>
            <Link
              to="/register"
              className="mt-8 inline-block bg-primary-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-primary-500"
            >
              Start Your Free Trial
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 py-12">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-gray-400 text-sm">
            © {new Date().getFullYear()} PriceProtectionBot. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
