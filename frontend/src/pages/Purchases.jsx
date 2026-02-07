import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PlusIcon,
  ShoppingBagIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  CreditCardIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { purchasesAPI, cardsAPI } from '../services/api';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const statusColors = {
  MONITORING: 'badge-blue',
  PRICE_DROP_DETECTED: 'badge-yellow',
  CLAIM_ELIGIBLE: 'badge-green',
  CLAIM_FILED: 'badge-blue',
  CLAIM_APPROVED: 'badge-green',
  CLAIM_DENIED: 'badge-red',
  EXPIRED: 'badge-gray'
};

const statusLabels = {
  MONITORING: 'Monitoring',
  PRICE_DROP_DETECTED: 'Price Drop!',
  CLAIM_ELIGIBLE: 'Claim Eligible',
  CLAIM_FILED: 'Claim Filed',
  CLAIM_APPROVED: 'Approved',
  CLAIM_DENIED: 'Denied',
  EXPIRED: 'Expired'
};

export default function Purchases() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [linkingPurchaseId, setLinkingPurchaseId] = useState(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', filter, page],
    queryFn: () => purchasesAPI.getAll({
      status: filter !== 'all' ? filter : undefined,
      page,
      limit: 20
    })
  });

  const { data: cardsData } = useQuery({
    queryKey: ['cards'],
    queryFn: () => cardsAPI.getAll()
  });

  const linkCardMutation = useMutation({
    mutationFn: ({ purchaseId, creditCardId }) => purchasesAPI.linkCard(purchaseId, creditCardId),
    onSuccess: () => {
      toast.success('Card linked! Auto-claim is now enabled for this purchase.');
      queryClient.invalidateQueries(['purchases']);
      setLinkingPurchaseId(null);
    },
    onError: () => toast.error('Failed to link card')
  });

  const purchases = data?.data?.purchases || [];
  const cards = cardsData?.data || [];
  const pagination = data?.data?.pagination;

  const filteredPurchases = search
    ? purchases.filter(p =>
        p.productName.toLowerCase().includes(search.toLowerCase()) ||
        p.retailer.toLowerCase().includes(search.toLowerCase())
      )
    : purchases;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchases</h1>
          <p className="text-gray-600 mt-1">Track and monitor your purchases for price drops.</p>
        </div>
        <Link to="/purchases/new" className="btn-primary">
          <PlusIcon className="h-5 w-5 mr-2" />
          Add Purchase
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search purchases..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <FunnelIcon className="h-5 w-5 text-gray-400" />
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
              className="input w-auto"
            >
              <option value="all">All Status</option>
              <option value="MONITORING">Monitoring</option>
              <option value="PRICE_DROP_DETECTED">Price Drops</option>
              <option value="CLAIM_ELIGIBLE">Claim Eligible</option>
              <option value="CLAIM_FILED">Claims Filed</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
        </div>
      </div>

      {/* Purchases List */}
      {isLoading ? (
        <div className="card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : filteredPurchases.length === 0 ? (
        <div className="card p-8 text-center">
          <ShoppingBagIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No purchases found</h3>
          <p className="text-gray-500 mb-4">
            {filter !== 'all'
              ? 'Try adjusting your filters'
              : 'Start by adding your first purchase to track'}
          </p>
          <Link to="/purchases/new" className="btn-primary">
            Add Purchase
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Alert for purchases without cards */}
          {purchases.some(p => !p.creditCardId && !['EXPIRED', 'CLAIM_FILED', 'CLAIM_APPROVED'].includes(p.status)) && (
            <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                Some purchases don't have a credit card linked. Link a card to enable automatic claim filing when prices drop.
              </p>
            </div>
          )}

          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Card
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Purchase Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Current Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Savings
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Protection Ends
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPurchases.map((purchase) => {
                const savings = purchase.purchasePrice - (purchase.lowestPrice || purchase.purchasePrice);
                const needsCard = !purchase.creditCardId && !['EXPIRED', 'CLAIM_FILED', 'CLAIM_APPROVED'].includes(purchase.status);
                return (
                  <tr key={purchase.id} className={`hover:bg-gray-50 ${needsCard ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link to={`/purchases/${purchase.id}`} className="flex items-center">
                        {purchase.imageUrl ? (
                          <img
                            src={purchase.imageUrl}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                            <ShoppingBagIcon className="h-5 w-5 text-gray-400" />
                          </div>
                        )}
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 hover:text-primary-600 max-w-xs truncate">
                            {purchase.productName}
                          </div>
                          <div className="text-sm text-gray-500">{purchase.retailer}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {purchase.creditCard ? (
                        <div className="flex items-center text-sm text-gray-700">
                          <CreditCardIcon className="h-4 w-4 mr-1 text-gray-400" />
                          <span>{purchase.creditCard.issuer || purchase.creditCard.network} ...{purchase.creditCard.lastFour}</span>
                        </div>
                      ) : linkingPurchaseId === purchase.id ? (
                        <select
                          className="input text-xs py-1 px-2 w-36"
                          autoFocus
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              linkCardMutation.mutate({ purchaseId: purchase.id, creditCardId: e.target.value });
                            }
                          }}
                          onBlur={() => setLinkingPurchaseId(null)}
                        >
                          <option value="">Select card...</option>
                          {cards.map(card => (
                            <option key={card.id} value={card.id}>
                              {card.issuer || card.network} ...{card.lastFour}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => {
                            if (cards.length === 0) {
                              toast('Add a credit card first in Credit Cards page', { icon: 'i' });
                            } else {
                              setLinkingPurchaseId(purchase.id);
                            }
                          }}
                          className="text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1"
                        >
                          <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                          Link Card
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${purchase.purchasePrice.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${(purchase.lowestPrice || purchase.currentPrice || purchase.purchasePrice).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {savings > 0 ? (
                        <span className="text-sm font-medium text-green-600">
                          -${savings.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={statusColors[purchase.status]}>
                        {statusLabels[purchase.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {purchase.protectionEnds
                        ? format(new Date(purchase.protectionEnds), 'MMM d, yyyy')
                        : <span className="text-amber-500 text-xs">Link card first</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total} results
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-secondary disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= pagination.pages}
                  className="btn-secondary disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
