import React from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheckIcon,
  EnvelopeIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

const features = [
  {
    name: 'Automatic Email Scanning',
    description: 'Connect your Gmail and we automatically detect purchases from major retailers.',
    icon: EnvelopeIcon
  },
  {
    name: 'Price Monitoring',
    description: 'We check prices multiple times daily across all tracked items.',
    icon: ChartBarIcon
  },
  {
    name: 'Smart Claim Filing',
    description: 'Get step-by-step instructions and auto-generated documentation for claims.',
    icon: ShieldCheckIcon
  },
  {
    name: 'Money Back Guarantee',
    description: 'If you don\'t save more than the subscription cost, we\'ll refund you.',
    icon: CurrencyDollarIcon
  }
];

const retailers = [
  'Amazon', 'Best Buy', 'Walmart', 'Target', 'Costco', 'Home Depot', 'Lowes', 'Newegg'
];

const cards = [
  'Chase Sapphire', 'Citi Double Cash', 'American Express', 'Discover', 'Capital One'
];

export default function Landing() {
  return (
    <div className="bg-white">
      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-50">
        <nav className="flex items-center justify-between p-6 lg:px-8">
          <div className="flex lg:flex-1">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-purple-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold">PP</span>
              </div>
              <span className="text-xl font-bold text-gray-900">PriceProtectionBot</span>
            </Link>
          </div>
          <div className="flex gap-x-6">
            <Link to="/pricing" className="text-sm font-semibold text-gray-900 hover:text-primary-600">
              Pricing
            </Link>
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

      {/* Hero */}
      <div className="relative isolate pt-14">
        <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
          <div
            className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-primary-200 to-purple-200 opacity-30 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
            style={{
              clipPath:
                'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)'
            }}
          />
        </div>

        <div className="py-24 sm:py-32 lg:pb-40">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
                Stop leaving <span className="text-primary-600">hundreds of dollars</span> on the table
              </h1>
              <p className="mt-6 text-lg leading-8 text-gray-600">
                Your credit cards have price protection benefits that refund you when prices drop.
                But less than 1% of cardholders use them because filing claims manually is a pain.
                <br /><br />
                <strong>We fix that.</strong>
              </p>
              <div className="mt-10 flex items-center justify-center gap-x-6">
                <Link
                  to="/register"
                  className="rounded-lg bg-primary-600 px-6 py-3 text-lg font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
                >
                  Start Saving Now
                </Link>
                <Link to="/pricing" className="text-lg font-semibold text-gray-900 hover:text-primary-600">
                  See pricing <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            {/* Stats */}
            <div className="mt-16 grid grid-cols-2 gap-8 md:grid-cols-4">
              {[
                { stat: '$500+', label: 'Average annual savings' },
                { stat: '90%', label: 'Claim approval rate' },
                { stat: '< 1%', label: 'Current utilization' },
                { stat: '2 min', label: 'Setup time' }
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <div className="text-4xl font-bold text-primary-600">{item.stat}</div>
                  <div className="mt-1 text-sm text-gray-600">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              How it works
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Three simple steps to start recovering money you're owed
            </p>
          </div>

          <div className="mt-16 grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                title: 'Connect Your Email',
                description: 'Link your Gmail and we\'ll automatically detect purchases from 50+ major retailers.'
              },
              {
                step: '2',
                title: 'Add Your Cards',
                description: 'Tell us which credit cards you use. We know the price protection terms for all major issuers.'
              },
              {
                step: '3',
                title: 'We Do The Rest',
                description: 'We monitor prices, alert you to drops, and generate claim documentation automatically.'
              }
            ].map((item) => (
              <div key={item.step} className="relative bg-white rounded-2xl p-8 shadow-sm">
                <div className="absolute -top-4 left-8 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-bold">
                  {item.step}
                </div>
                <h3 className="mt-4 text-xl font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-gray-600">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Everything you need to maximize savings
            </h2>
          </div>

          <div className="mt-16 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature) => (
              <div key={feature.name} className="relative">
                <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mb-4">
                  <feature.icon className="h-6 w-6 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{feature.name}</h3>
                <p className="mt-2 text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Supported retailers & cards */}
      <div className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-16">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Supported Retailers</h3>
              <div className="flex flex-wrap gap-3">
                {retailers.map((retailer) => (
                  <span key={retailer} className="bg-white px-4 py-2 rounded-lg shadow-sm text-gray-700">
                    {retailer}
                  </span>
                ))}
                <span className="bg-white px-4 py-2 rounded-lg shadow-sm text-gray-500">
                  + 40 more
                </span>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Supported Credit Cards</h3>
              <div className="flex flex-wrap gap-3">
                {cards.map((card) => (
                  <span key={card} className="bg-white px-4 py-2 rounded-lg shadow-sm text-gray-700">
                    {card}
                  </span>
                ))}
                <span className="bg-white px-4 py-2 rounded-lg shadow-sm text-gray-500">
                  + more
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Pay less than a coffee per week to potentially save hundreds
            </p>
          </div>

          <div className="mt-16 mx-auto max-w-md">
            <div className="rounded-3xl bg-white shadow-xl ring-1 ring-gray-200 p-8">
              <h3 className="text-2xl font-bold text-gray-900">Pro</h3>
              <p className="mt-4 flex items-baseline">
                <span className="text-5xl font-bold text-gray-900">$15</span>
                <span className="ml-2 text-gray-500">/month</span>
              </p>
              <p className="mt-4 text-gray-600">
                Everything you need to maximize your price protection benefits.
              </p>

              <ul className="mt-8 space-y-4">
                {[
                  'Unlimited purchase tracking',
                  'Automatic email scanning',
                  'Price monitoring every 6 hours',
                  'Claim documentation generation',
                  'Email notifications',
                  'Priority support',
                  'Money-back guarantee'
                ].map((feature) => (
                  <li key={feature} className="flex items-center">
                    <CheckCircleIcon className="h-5 w-5 text-green-500 mr-3" />
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/register"
                className="mt-8 block w-full bg-primary-600 text-center py-3 rounded-lg text-white font-semibold hover:bg-primary-500"
              >
                Start Free Trial
              </Link>
              <p className="mt-4 text-center text-sm text-gray-500">
                14-day free trial. No credit card required.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="bg-primary-600 py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to stop leaving money on the table?
          </h2>
          <p className="mt-4 text-lg text-primary-100">
            Join thousands of smart shoppers saving hundreds every year.
          </p>
          <Link
            to="/register"
            className="mt-8 inline-block bg-white text-primary-600 px-8 py-4 rounded-lg font-semibold text-lg hover:bg-gray-100"
          >
            Get Started for Free
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">PP</span>
              </div>
              <span className="text-white font-medium">PriceProtectionBot</span>
            </div>
            <p className="text-gray-400 text-sm">
              © {new Date().getFullYear()} PriceProtectionBot. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
