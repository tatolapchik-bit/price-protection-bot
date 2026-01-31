import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  TrashIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { purchasesAPI, claimsAPI } from '../services/api';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function PurchaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasSubscription } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['purchase', id],
    queryFn: () => purchasesAPI.getOne(id)
  });

  const checkPriceMutation = useMutation({
    mutationFn: () => purchasesAPI.checkPrice(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries(['purchase', id]);
      if (result.data.priceDrop > 0) {
        toast.success(`Price dropped by $${result.data.priceDrop.toFixed(2)}!`);
      } else {
        toast.success('Price checked - no changes');
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to check price');
    }
  });

  const createClaimMutation = useMutation({
    mutationFn: () => claimsAPI.create(id),
    onSuccess: (result) => {
      toast.success('Claim created!');
      navigate(`/claims/${result.data.id}`);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to create claim');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => purchasesAPI.delete(id),
    onSuccess: () => {
      toast.success('Purchase deleted');
      navigate('/purchases');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to delete');
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const purchase = data?.data;
  if (!purchase) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Purchase not found</p>
        <Link to="/purchases" className="text-primary-600 mt-2 inline-block">
          Back to purchases
        </Link>
      </div>
    );
  }

  const savings = purchase.purchasePrice - (purchase.lowestPrice || purchase.purchasePrice);
  const isEligible = ['PRICE_DROP_DETECTED', 'CLAIM_ELIGIBLE'].includes(purchase.status);
  const protectionActive = purchase.protectionEnds && new Date(purchase.protectionEnds) > new Date();

  const priceHistoryData = purchase.priceHistory?.map(p => ({
    date: format(new Date(p.checkedAt), 'MM/dd'),
    price: p.price
  })) || [];

  return (
    <div>
      <Link
        to="/purchases"
        className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-2" />
        Back to purchases
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <div className="flex items-start">
              {purchase.imageUrl ? (
                <img
                  src={purchase.imageUrl}
                  alt={purchase.productName}
                  className="w-24 h-24 rounded-lg object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-lg bg-gray-100 flex items-center justify-center">
                  <span className="text-gray-400 text-xs">No image</span>
                </div>
              )}
              <div className="ml-6 flex-1">
                <h1 className="text-2xl font-bold text-gray-900">{purchase.productName}</h1>
                <p className="text-gray-600 mt-1">{purchase.retailer}</p>
                {purchase.productUrl && (
                  <a
                    href={purchase.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary-600 text-sm mt-2 hover:underline"
                  >
                    View on {purchase.retailer}
                    <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-1" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Price History Chart */}
          {priceHistoryData.length > 1 && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Price History</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={priceHistoryData}>
                  <XAxis dataKey="date" />
                  <YAxis domain={['auto', 'auto']} />
                  <Tooltip
                    formatter={(value) => [`$${value.toFixed(2)}`, 'Price']}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#667eea"
                    strokeWidth={2}
                    dot={{ fill: '#667eea' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Details */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Details</h2>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-500">Purchase Date</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {format(new Date(purchase.purchaseDate), 'MMMM d, yyyy')}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Order ID</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {purchase.retailerOrderId || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Category</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {purchase.category || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Source</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {purchase.sourceType === 'EMAIL' ? 'Email Import' : 'Manual Entry'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Claims */}
          {purchase.claims?.length > 0 && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Claims</h2>
              <div className="space-y-3">
                {purchase.claims.map((claim) => (
                  <Link
                    key={claim.id}
                    to={`/claims/${claim.id}`}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        ${claim.priceDifference.toFixed(2)} claim
                      </p>
                      <p className="text-sm text-gray-500">
                        {format(new Date(claim.createdAt), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <span className={`badge ${
                      claim.status === 'APPROVED' ? 'badge-green' :
                      claim.status === 'DENIED' ? 'badge-red' :
                      'badge-blue'
                    }`}>
                      {claim.status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Pricing */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Pricing</h2>

            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Purchase Price</span>
                <span className="font-medium">${purchase.purchasePrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Current Price</span>
                <span className="font-medium">
                  ${(purchase.currentPrice || purchase.purchasePrice).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Lowest Price</span>
                <span className="font-medium text-green-600">
                  ${(purchase.lowestPrice || purchase.purchasePrice).toFixed(2)}
                </span>
              </div>
              {savings > 0 && (
                <div className="pt-3 border-t">
                  <div className="flex justify-between">
                    <span className="text-gray-900 font-medium">Potential Savings</span>
                    <span className="font-bold text-green-600">${savings.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t space-y-3">
              <button
                onClick={() => checkPriceMutation.mutate()}
                disabled={checkPriceMutation.isPending || !purchase.productUrl}
                className="w-full btn-secondary flex items-center justify-center"
              >
                <ArrowPathIcon className={`h-4 w-4 mr-2 ${checkPriceMutation.isPending ? 'animate-spin' : ''}`} />
                Check Price Now
              </button>

              {isEligible && protectionActive && (
                <button
                  onClick={() => createClaimMutation.mutate()}
                  disabled={createClaimMutation.isPending || !hasSubscription}
                  className="w-full btn-success"
                >
                  {hasSubscription ? 'Create Claim' : 'Upgrade to Create Claim'}
                </button>
              )}
            </div>
          </div>

          {/* Protection Status */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Protection Status</h2>

            {purchase.creditCard ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Card</span>
                  <span className="font-medium">
                    {purchase.creditCard.nickname}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Protection Ends</span>
                  <span className={`font-medium ${protectionActive ? 'text-green-600' : 'text-red-600'}`}>
                    {purchase.protectionEnds
                      ? format(new Date(purchase.protectionEnds), 'MMM d, yyyy')
                      : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Status</span>
                  <span className={`badge ${protectionActive ? 'badge-green' : 'badge-red'}`}>
                    {protectionActive ? 'Active' : 'Expired'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-gray-500 text-sm mb-3">
                  Link a credit card to enable price protection
                </p>
                <Link to="/cards" className="text-primary-600 text-sm hover:underline">
                  Manage Cards →
                </Link>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete this purchase?')) {
                  deleteMutation.mutate();
                }
              }}
              className="w-full btn-danger flex items-center justify-center"
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              Delete Purchase
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
