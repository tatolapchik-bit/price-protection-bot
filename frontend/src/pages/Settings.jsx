import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { authAPI, emailAPI } from '../services/api';
import toast from 'react-hot-toast';
import {
  EnvelopeIcon,
  CreditCardIcon,
  BellIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

export default function Settings() {
  const { user, updateUser, hasSubscription } = useAuth();
  const queryClient = useQueryClient();

  const [settings, setSettings] = useState({
    name: user?.name || '',
    notificationEmail: user?.notificationEmail || '',
    priceDropThreshold: user?.priceDropThreshold || 5,
    autoFileClaimsEnabled: user?.autoFileClaimsEnabled || false
  });

  const { data: emailStatus } = useQuery({
    queryKey: ['email-status'],
    queryFn: () => emailAPI.getStatus()
  });

  const updateMutation = useMutation({
    mutationFn: (data) => authAPI.updateSettings(data),
    onSuccess: (result) => {
      updateUser(result.data);
      toast.success('Settings saved!');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to save');
    }
  });

  const disconnectGmailMutation = useMutation({
    mutationFn: () => authAPI.disconnectGmail(),
    onSuccess: () => {
      updateUser({ gmailConnected: false });
      queryClient.invalidateQueries(['email-status']);
      toast.success('Gmail disconnected');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to disconnect');
    }
  });

  const syncEmailMutation = useMutation({
    mutationFn: () => emailAPI.sync(),
    onSuccess: () => {
      toast.success('Email sync started!');
      queryClient.invalidateQueries(['email-status']);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to start sync');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateMutation.mutate({
      name: settings.name,
      notificationEmail: settings.notificationEmail,
      priceDropThreshold: parseFloat(settings.priceDropThreshold),
      autoFileClaimsEnabled: settings.autoFileClaimsEnabled
    });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Subscription Banner */}
      {!hasSubscription && (
        <div className="card bg-gradient-to-r from-primary-500 to-purple-600 p-6 mb-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Upgrade to Pro</h2>
              <p className="opacity-90 mt-1">
                Get automatic claim documentation, priority price monitoring, and more.
              </p>
            </div>
            <Link
              to="/settings/subscription"
              className="bg-white text-primary-600 px-4 py-2 rounded-lg font-semibold hover:bg-gray-100"
            >
              $15/month
            </Link>
          </div>
        </div>
      )}

      {/* Email Integration */}
      <div className="card p-6 mb-6">
        <div className="flex items-center mb-4">
          <EnvelopeIcon className="h-6 w-6 text-gray-600 mr-3" />
          <h2 className="text-lg font-semibold text-gray-900">Email Integration</h2>
        </div>

        {user?.gmailConnected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
              <div>
                <p className="font-medium text-green-800">Gmail Connected</p>
                <p className="text-sm text-green-600">{user.email}</p>
              </div>
              <button
                onClick={() => disconnectGmailMutation.mutate()}
                disabled={disconnectGmailMutation.isPending}
                className="text-red-600 text-sm hover:underline"
              >
                Disconnect
              </button>
            </div>

            {emailStatus?.data?.lastSync && (
              <div className="text-sm text-gray-600">
                Last sync: {new Date(emailStatus.data.lastSync.date).toLocaleString()} -
                {' '}{emailStatus.data.lastSync.purchasesFound} purchases found
              </div>
            )}

            {hasSubscription && (
              <button
                onClick={() => syncEmailMutation.mutate()}
                disabled={syncEmailMutation.isPending}
                className="btn-secondary flex items-center"
              >
                <ArrowPathIcon className={`h-4 w-4 mr-2 ${syncEmailMutation.isPending ? 'animate-spin' : ''}`} />
                Sync Emails Now
              </button>
            )}
          </div>
        ) : (
          <div>
            <p className="text-gray-600 mb-4">
              Connect your Gmail to automatically detect purchases from order confirmation emails.
            </p>
            <a
              href="/api/auth/google"
              className="btn-primary inline-flex items-center"
            >
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              </svg>
              Connect Gmail
            </a>
          </div>
        )}
      </div>

      {/* Profile Settings */}
      <form onSubmit={handleSubmit} className="card p-6 mb-6">
        <div className="flex items-center mb-4">
          <BellIcon className="h-6 w-6 text-gray-600 mr-3" />
          <h2 className="text-lg font-semibold text-gray-900">Notifications & Preferences</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              value={settings.name}
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
              className="input"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="label">Notification Email</label>
            <input
              type="email"
              value={settings.notificationEmail}
              onChange={(e) => setSettings({ ...settings, notificationEmail: e.target.value })}
              className="input"
              placeholder="you@example.com"
            />
            <p className="text-xs text-gray-500 mt-1">
              Where we'll send price drop alerts
            </p>
          </div>

          <div>
            <label className="label">Price Drop Threshold ($)</label>
            <input
              type="number"
              value={settings.priceDropThreshold}
              onChange={(e) => setSettings({ ...settings, priceDropThreshold: e.target.value })}
              className="input"
              min={1}
              max={100}
              step="0.01"
            />
            <p className="text-xs text-gray-500 mt-1">
              Minimum price drop to trigger notifications
            </p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="autoFile"
              checked={settings.autoFileClaimsEnabled}
              onChange={(e) => setSettings({ ...settings, autoFileClaimsEnabled: e.target.checked })}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              disabled={!hasSubscription}
            />
            <label htmlFor="autoFile" className="ml-2 text-gray-700">
              Enable automatic claim preparation
              {!hasSubscription && (
                <span className="text-primary-600 ml-1">(Pro only)</span>
              )}
            </label>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t flex justify-end">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="btn-primary"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Subscription */}
      <div className="card p-6">
        <div className="flex items-center mb-4">
          <CreditCardIcon className="h-6 w-6 text-gray-600 mr-3" />
          <h2 className="text-lg font-semibold text-gray-900">Subscription</h2>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">
              {hasSubscription ? 'Pro Plan' : 'Free Plan'}
            </p>
            <p className="text-sm text-gray-500">
              {hasSubscription
                ? 'Full access to all features'
                : 'Limited features - upgrade for full access'}
            </p>
          </div>
          <Link
            to="/settings/subscription"
            className={hasSubscription ? 'btn-secondary' : 'btn-primary'}
          >
            {hasSubscription ? 'Manage' : 'Upgrade'}
          </Link>
        </div>
      </div>
    </div>
  );
}
