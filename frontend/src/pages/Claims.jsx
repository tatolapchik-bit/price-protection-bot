import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DocumentTextIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';
import { claimsAPI } from '../services/api';
import { format } from 'date-fns';

const statusColors = {
  DRAFT: 'badge-gray',
  READY_TO_FILE: 'badge-blue',
  PENDING: 'badge-yellow',
  EMAIL_SENT: 'badge-blue',
  FILED: 'badge-blue',
  PENDING_REVIEW: 'badge-yellow',
  ADDITIONAL_INFO_NEEDED: 'badge-yellow',
  APPROVED: 'badge-green',
  DENIED: 'badge-red',
  EXPIRED: 'badge-gray',
  MONEY_RECEIVED: 'badge-green'
};

const statusLabels = {
  DRAFT: 'Draft',
  READY_TO_FILE: 'Ready to File',
  PENDING: 'Pending',
  EMAIL_SENT: 'Email Sent',
  FILED: 'Filed',
  PENDING_REVIEW: 'Pending Review',
  ADDITIONAL_INFO_NEEDED: 'Info Needed',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  EXPIRED: 'Expired',
  MONEY_RECEIVED: 'Money Received'
};

export default function Claims() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['claims', filter, page],
    queryFn: () => claimsAPI.getAll({
      status: filter !== 'all' ? filter : undefined,
      page,
      limit: 20
    })
  });

  const claims = data?.data?.claims || [];
  const pagination = data?.data?.pagination;

  // Calculate totals
  const totals = claims.reduce((acc, claim) => {
    if (['APPROVED', 'MONEY_RECEIVED'].includes(claim.status)) {
      acc.approved += claim.approvedAmount || claim.priceDifference;
    } else if (['EMAIL_SENT', 'FILED', 'PENDING_REVIEW'].includes(claim.status)) {
      acc.pending += claim.priceDifference;
    }
    return acc;
  }, { approved: 0, pending: 0 });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Claims</h1>
          <p className="text-gray-600 mt-1">Manage your price protection claims.</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-sm text-gray-600">Total Claims</p>
          <p className="text-2xl font-bold text-gray-900">{pagination?.total || 0}</p>
        </div>
        <div className="card p-4 bg-green-50 border-green-200">
          <p className="text-sm text-green-700">Money Recovered</p>
          <p className="text-2xl font-bold text-green-700">${totals.approved.toFixed(2)}</p>
        </div>
        <div className="card p-4 bg-yellow-50 border-yellow-200">
          <p className="text-sm text-yellow-700">Pending</p>
          <p className="text-2xl font-bold text-yellow-700">${totals.pending.toFixed(2)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
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
            <option value="DRAFT">Draft</option>
            <option value="READY_TO_FILE">Ready to File</option>
            <option value="EMAIL_SENT">Email Sent</option>
            <option value="FILED">Filed</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="APPROVED">Approved</option>
            <option value="DENIED">Denied</option>
          </select>
        </div>
      </div>

      {/* Claims List */}
      {isLoading ? (
        <div className="card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : claims.length === 0 ? (
        <div className="card p-8 text-center">
          <DocumentTextIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No claims yet</h3>
          <p className="text-gray-500 mb-4">
            Claims are created when price drops are detected on your purchases.
          </p>
          <Link to="/purchases" className="btn-primary">
            View Purchases
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
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
                  Original
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  New Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Claim Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {claims.map((claim) => (
                <tr key={claim.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      to={`/claims/${claim.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-primary-600 max-w-xs truncate block"
                    >
                      {claim.purchase?.productName || 'Unknown Product'}
                    </Link>
                    <p className="text-sm text-gray-500">{claim.purchase?.retailer}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {claim.creditCard?.nickname || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${claim.originalPrice.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${claim.newPrice.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-green-600">
                      ${claim.priceDifference.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={statusColors[claim.status]}>
                      {statusLabels[claim.status]}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(claim.createdAt), 'MMM d, yyyy')}
                  </td>
                </tr>
              ))}
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
