import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBagIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  ArrowTrendingDownIcon,
  PlusIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';
import { purchasesAPI, emailAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { format, formatDistanceToNow } from 'date-fns';

export default function Dashboard() {
  const { user, hasSubscription } = useAuth();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => purchasesAPI.getStats()
  });

  const { data: recentPurchases } = useQuery({
    queryKey: ['recent-purchases'],
    queryFn: () => purchasesAPI.getAll({ limit: 5 })
  });

  // Email sync mutation
  const syncMutation = useMutation({
    mutationFn: () => emailAPI.sync(),
    onSuccess: () => {
      queryClient.invalidateQueries(['recent-purchases']);
      queryClient.invalidateQueries(['dashboard-stats']);
      setSyncing(false);
    },
    onError: () => {
      setSyncing(false);
    }
  });

  const handleSync = () => {
    setSyncing(true);
    syncMutation.mutate();
  };

  const statCards = [
    {
      name: 'Total Purchases',
      value: stats?.data?.purchases?.total || 0,
      icon: ShoppingBagIcon,
      color: 'bg-blue-500'
    },
    {
      name: 'Active Monitoring',
      value: stats?.data?.purchases?.monitoring || 0,
      icon: ArrowTrendingDownIcon,
      color: 'bg-green-500'
    },
    {
      name: 'Price Drops',
      value: stats?.data?.purchases?.priceDrops || 0,
      icon: ArrowTrendingDownIcon,
      color: 'bg-yellow-500'
    },
    {
      name: 'Total Recovered',
      value: `$${(stats?.data?.claims?.totalRecovered || 0).toFixed(2)}`,
      icon: CurrencyDollarIcon,
      color: 'bg-primary-500'
    }
  ];

  // Format purchase date nicely
  const formatPurchaseDate = (date) => {
    if (!date) return 'Unknown date';
    const purchaseDate = new Date(date);
    return format(purchaseDate, 'MMM d, yyyy');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!
          </h1>
          <p className="text-gray-600 mt-1">Here's what's happening with your purchases.</p>
        </div>
        <div className="flex gap-3">
          {user?.gmailConnected && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn-secondary flex items-center"
            >
              <ArrowPathIcon className={`h-5 w-5 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Emails'}
            </button>
          )}
          <Link to="/purchases/new" className="btn-primary">
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Purchase
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {statCards.map((stat) => (
          <div key={stat.name} className="card p-6">
            <div className="flex items-center">
              <div className={`${stat.color} p-3 rounded-lg`}>
                <stat.icon className="h-6 w-6 text-white" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                <p className="text-2xl font-bold text-gray-900">
                  {isLoading ? '...' : stat.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Potential Savings */}
      {stats?.data?.potentialSavings > 0 && (
        <div className="card bg-gradient-to-r from-green-500 to-emerald-600 p-6 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium opacity-90">Potential Savings Available!</h3>
              <p className="text-3xl font-bold mt-1">
                ${stats.data.potentialSavings.toFixed(2)}
              </p>
              <p className="text-sm opacity-75 mt-1">
                You have {stats.data.purchases?.priceDrops || 0} items with price drops eligible for claims
              </p>
            </div>
            <Link
              to="/claims"
              className="bg-white text-green-600 px-4 py-2 rounded-lg font-semibold hover:bg-green-50"
            >
              View Claims
            </Link>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Recent Purchases */}
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Recent Purchases</h2>
              <Link to="/purchases" className="text-sm text-primary-600 hover:text-primary-700">
                View all
              </Link>
            </div>
          </div>
          <div className="divide-y divide-gray-200">
            {recentPurchases?.data?.purchases?.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <ShoppingBagIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No purchases yet</p>
                <Link to="/purchases/new" className="text-primary-600 text-sm mt-2 inline-block">
                  Add your first purchase →
                </Link>
              </div>
            ) : (
              recentPurchases?.data?.purchases?.map((purchase) => (
                <div key={purchase.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start">
                    {purchase.imageUrl ? (
                      <img
                        src={purchase.imageUrl}
                        alt={purchase.productName}
                        className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <ShoppingBagIcon className="h-7 w-7 text-gray-400" />
                      </div>
                    )}
                    <div className="ml-4 flex-1 min-w-0">
                      <Link to={`/purchases/${purchase.id}`}>
                        <p className="text-sm font-medium text-gray-900 hover:text-primary-600 truncate">
                          {purchase.productName}
                        </p>
                      </Link>
                      <p className="text-sm text-gray-500">{purchase.retailer}</p>
                      <div className="flex items-center mt-1 text-xs text-gray-400">
                        <CalendarIcon className="h-3 w-3 mr-1" />
                        <span>{formatPurchaseDate(purchase.purchaseDate)}</span>
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-sm font-semibold text-gray-900">
                        ${purchase.purchasePrice?.toFixed(2)}
                      </p>
                      {purchase.lowestPrice && purchase.lowestPrice < purchase.purchasePrice && (
                        <p className="text-xs text-green-600 font-medium">
                          Now ${purchase.lowestPrice.toFixed(2)}
                        </p>
                      )}
                      {purchase.productUrl && (
                        <a
                          href={purchase.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 mt-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MagnifyingGlassIcon className="h-3 w-3 mr-1" />
                          Check Price
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-6">
          {/* Gmail Status */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Email Integration</h2>
            {user?.gmailConnected ? (
              <div>
                <div className="flex items-center text-green-600 mb-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                  <span>Gmail connected - automatically detecting purchases</span>
                </div>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="btn-secondary text-sm"
                >
                  <ArrowPathIcon className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Scanning...' : 'Scan for new purchases'}
                </button>
              </div>
            ) : (
              <div>
                <p className="text-gray-600 mb-3">
                  Connect your Gmail to automatically detect purchases from your emails.
                </p>
                <Link to="/settings" className="btn-secondary">
                  Connect Gmail
                </Link>
              </div>
            )}
          </div>

          {/* Subscription Status */}
          {!hasSubscription && (
            <div className="card p-6 bg-gradient-to-br from-primary-50 to-purple-50 border-primary-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                Upgrade to Pro
              </h2>
              <p className="text-gray-600 mb-4">
                Unlock automatic claim documentation, priority price monitoring, and more.
              </p>
              <Link to="/settings/subscription" className="btn-primary">
                Upgrade for $15/month
              </Link>
            </div>
          )}

          {/* Claims Summary */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Claims Summary</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {stats?.data?.claims?.total || 0}
                </p>
                <p className="text-sm text-gray-500">Total</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">
                  {stats?.data?.claims?.approved || 0}
                </p>
                <p className="text-sm text-gray-500">Approved</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-yellow-600">
                  {stats?.data?.claims?.pending || 0}
                </p>
                <p className="text-sm text-gray-500">Pending</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
