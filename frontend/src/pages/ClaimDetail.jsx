import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  DocumentArrowDownIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { claimsAPI } from '../services/api';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

export default function ClaimDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['claim', id],
    queryFn: () => claimsAPI.getOne(id)
  });

  const { data: instructions } = useQuery({
    queryKey: ['claim-instructions', id],
    queryFn: () => claimsAPI.getInstructions(id),
    enabled: !!data
  });

  const generateDocsMutation = useMutation({
    mutationFn: () => claimsAPI.generateDocs(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries(['claim', id]);
      toast.success('Documentation generated!');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to generate docs');
    }
  });

  const fileMutation = useMutation({
    mutationFn: (claimNumber) => claimsAPI.file(id, claimNumber),
    onSuccess: () => {
      queryClient.invalidateQueries(['claim', id]);
      toast.success('Claim marked as filed!');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update claim');
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: (data) => claimsAPI.updateStatus(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['claim', id]);
      toast.success('Status updated!');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update status');
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const claim = data?.data;
  if (!claim) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Claim not found</p>
        <Link to="/claims" className="text-primary-600 mt-2 inline-block">
          Back to claims
        </Link>
      </div>
    );
  }

  const inst = instructions?.data;

  return (
    <div>
      <Link
        to="/claims"
        className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-2" />
        Back to claims
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  ${claim.priceDifference.toFixed(2)} Claim
                </h1>
                <p className="text-gray-600 mt-1">
                  {claim.purchase?.productName}
                </p>
              </div>
              <span className={`badge ${
                claim.status === 'APPROVED' ? 'badge-green' :
                claim.status === 'DENIED' ? 'badge-red' :
                claim.status === 'FILED' || claim.status === 'PENDING_REVIEW' ? 'badge-blue' :
                'badge-gray'
              }`}>
                {claim.status.replace(/_/g, ' ')}
              </span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Original Price</p>
                <p className="text-xl font-bold">${claim.originalPrice.toFixed(2)}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-green-700">New Price</p>
                <p className="text-xl font-bold text-green-700">${claim.newPrice.toFixed(2)}</p>
              </div>
            </div>

            {claim.claimNumber && (
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-700">Claim Number</p>
                <p className="font-mono font-medium text-blue-900">{claim.claimNumber}</p>
              </div>
            )}
          </div>

          {/* Filing Instructions */}
          {inst && ['DRAFT', 'READY_TO_FILE'].includes(claim.status) && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                How to File Your Claim
              </h2>

              <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Card Issuer</p>
                <p className="font-medium">{inst.issuer}</p>
                {inst.phone && (
                  <p className="text-sm text-gray-600 mt-1">Phone: {inst.phone}</p>
                )}
                {inst.portal && (
                  <a
                    href={inst.portal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary-600 hover:underline mt-1 block"
                  >
                    Online Portal →
                  </a>
                )}
              </div>

              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2">Steps:</h3>
                <ol className="list-decimal list-inside space-y-2 text-gray-700">
                  {inst.instructions?.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>

              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2">Required Documents:</h3>
                <ul className="space-y-1">
                  {inst.requiredDocuments?.map((doc, idx) => (
                    <li key={idx} className="flex items-center text-gray-700">
                      <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                      {doc === 'receipt' && 'Original purchase receipt'}
                      {doc === 'price_screenshot' && 'Screenshot of lower price'}
                      {doc === 'credit_card_statement' && 'Credit card statement'}
                      {doc === 'item_details' && 'Product details/specifications'}
                    </li>
                  ))}
                </ul>
              </div>

              {inst.deadlines?.daysRemaining && (
                <div className={`p-4 rounded-lg ${
                  inst.deadlines.daysRemaining <= 7 ? 'bg-red-50' : 'bg-yellow-50'
                }`}>
                  <p className={`font-medium ${
                    inst.deadlines.daysRemaining <= 7 ? 'text-red-700' : 'text-yellow-700'
                  }`}>
                    ⏰ {inst.deadlines.daysRemaining} days remaining to file
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Approved Result */}
          {claim.status === 'APPROVED' && (
            <div className="card p-6 bg-green-50 border-green-200">
              <div className="flex items-center">
                <CheckCircleIcon className="h-12 w-12 text-green-500 mr-4" />
                <div>
                  <h2 className="text-xl font-bold text-green-900">Claim Approved!</h2>
                  <p className="text-green-700">
                    You received ${(claim.approvedAmount || claim.priceDifference).toFixed(2)} back
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>

            <div className="space-y-3">
              {claim.status === 'DRAFT' && (
                <button
                  onClick={() => generateDocsMutation.mutate()}
                  disabled={generateDocsMutation.isPending}
                  className="w-full btn-primary flex items-center justify-center"
                >
                  <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
                  Generate Documentation
                </button>
              )}

              {['DRAFT', 'READY_TO_FILE'].includes(claim.status) && (
                <button
                  onClick={() => {
                    const claimNumber = prompt('Enter claim confirmation number (optional):');
                    fileMutation.mutate(claimNumber);
                  }}
                  disabled={fileMutation.isPending}
                  className="w-full btn-success"
                >
                  Mark as Filed
                </button>
              )}

              {claim.status === 'FILED' && (
                <>
                  <button
                    onClick={() => {
                      const amount = prompt('Enter approved amount:', claim.priceDifference.toFixed(2));
                      if (amount) {
                        updateStatusMutation.mutate({
                          status: 'APPROVED',
                          approvedAmount: parseFloat(amount)
                        });
                      }
                    }}
                    className="w-full btn-success"
                  >
                    Mark as Approved
                  </button>
                  <button
                    onClick={() => updateStatusMutation.mutate({ status: 'DENIED' })}
                    className="w-full btn-danger"
                  >
                    Mark as Denied
                  </button>
                </>
              )}

              {claim.proofDocumentUrl && (
                <a
                  href={claim.proofDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full btn-secondary flex items-center justify-center"
                >
                  <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
                  Download Documentation
                </a>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Details</h2>

            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">Product</dt>
                <dd className="text-sm font-medium">
                  <Link
                    to={`/purchases/${claim.purchaseId}`}
                    className="text-primary-600 hover:underline"
                  >
                    {claim.purchase?.productName}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Retailer</dt>
                <dd className="text-sm font-medium">{claim.purchase?.retailer}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Credit Card</dt>
                <dd className="text-sm font-medium">
                  {claim.creditCard?.nickname} (•••• {claim.creditCard?.lastFour})
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Created</dt>
                <dd className="text-sm font-medium">
                  {format(new Date(claim.createdAt), 'MMM d, yyyy h:mm a')}
                </dd>
              </div>
              {claim.filedAt && (
                <div>
                  <dt className="text-sm text-gray-500">Filed</dt>
                  <dd className="text-sm font-medium">
                    {format(new Date(claim.filedAt), 'MMM d, yyyy h:mm a')}
                  </dd>
                </div>
              )}
              {claim.resolvedAt && (
                <div>
                  <dt className="text-sm text-gray-500">Resolved</dt>
                  <dd className="text-sm font-medium">
                    {format(new Date(claim.resolvedAt), 'MMM d, yyyy h:mm a')}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
