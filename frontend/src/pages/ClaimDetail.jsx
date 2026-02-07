import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  DocumentArrowDownIcon,
  CheckCircleIcon,
  RocketLaunchIcon,
  ArrowPathIcon,
  EnvelopeIcon,
  ShieldCheckIcon,
  PhotoIcon,
  DocumentTextIcon,
  ClipboardDocumentCheckIcon
} from '@heroicons/react/24/outline';
import { claimsAPI } from '../services/api';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const statusColors = {
  DRAFT: 'bg-gray-100 text-gray-700',
  READY_TO_FILE: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  EMAIL_SENT: 'bg-indigo-100 text-indigo-700',
  FILED: 'bg-blue-100 text-blue-700',
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-700',
  ADDITIONAL_INFO_NEEDED: 'bg-orange-100 text-orange-700',
  APPROVED: 'bg-green-100 text-green-700',
  DENIED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
  MONEY_RECEIVED: 'bg-emerald-100 text-emerald-700',
};

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

  const { data: proofData } = useQuery({
    queryKey: ['claim-proof', id],
    queryFn: () => claimsAPI.getProof(id),
    enabled: !!data
  });

  const generateDocsMutation = useMutation({
    mutationFn: () => claimsAPI.generateDocs(id),
    onSuccess: () => {
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

  const autoFileMutation = useMutation({
    mutationFn: () => claimsAPI.autoFile(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries(['claim', id]);
      queryClient.invalidateQueries(['claims']);
      queryClient.invalidateQueries(['claim-proof', id]);
      if (result.data.success) {
        toast.success('Claim automatically filed! Check the proof below.', {
          duration: 5000
        });
      } else {
        toast.error(result.data.error || 'Auto-file failed. Please file manually.');
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to auto-file claim');
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
  const proof = proofData?.data;
  const isFiled = ['EMAIL_SENT', 'FILED', 'PENDING_REVIEW', 'APPROVED', 'MONEY_RECEIVED'].includes(claim.status);

  // Build proof file URLs with auth token
  const token = localStorage.getItem('token');
  const baseUrl = import.meta.env.VITE_API_URL || '/api';
  const proofPdfUrl = proof?.hasClaimPdf ? `${baseUrl}/claims/${id}/proof/pdf?token=${token}` : null;
  const proofPriceUrl = proof?.hasPriceScreenshot ? `${baseUrl}/claims/${id}/proof/price-screenshot?token=${token}` : null;
  const proofEmailUrl = proof?.hasEmailProof ? `${baseUrl}/claims/${id}/proof/email-screenshot?token=${token}` : null;

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
              <div className="flex items-center gap-2">
                {claim.autoFiled && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                    <RocketLaunchIcon className="h-3.5 w-3.5 mr-1" />
                    Auto-Filed
                  </span>
                )}
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusColors[claim.status] || 'bg-gray-100 text-gray-700'}`}>
                  {claim.status.replace(/_/g, ' ')}
                </span>
              </div>
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

          {/* ── Proof of Filing Section ── */}
          {isFiled && proof && (
            <div className="card p-6 border-2 border-indigo-100">
              <div className="flex items-center gap-2 mb-5">
                <ShieldCheckIcon className="h-6 w-6 text-indigo-600" />
                <h2 className="text-lg font-semibold text-gray-900">Proof of Filing</h2>
              </div>

              {/* Email Summary */}
              {proof.emailSentTo && (
                <div className="bg-indigo-50 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <EnvelopeIcon className="h-5 w-5 text-indigo-600" />
                    <h3 className="font-medium text-indigo-900">Claim Email Sent</h3>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-indigo-600">Sent To</dt>
                      <dd className="font-medium text-indigo-900">{proof.emailSentTo}</dd>
                    </div>
                    <div>
                      <dt className="text-indigo-600">Date Sent</dt>
                      <dd className="font-medium text-indigo-900">
                        {proof.emailSentAt ? format(new Date(proof.emailSentAt), 'MMM d, yyyy h:mm a') : '—'}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-indigo-600">Subject</dt>
                      <dd className="font-medium text-indigo-900">{proof.emailSubject}</dd>
                    </div>
                    {proof.emailMessageId && (
                      <div className="sm:col-span-2">
                        <dt className="text-indigo-600">Message ID</dt>
                        <dd className="font-mono text-xs text-indigo-700">{proof.emailMessageId}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Proof Documents */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {proof.hasClaimPdf && (
                  <a
                    href={proofPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  >
                    <DocumentTextIcon className="h-8 w-8 text-red-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Claim PDF</p>
                      <p className="text-xs text-gray-500">View document</p>
                    </div>
                  </a>
                )}

                {proof.hasPriceScreenshot && (
                  <a
                    href={proofPriceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  >
                    <PhotoIcon className="h-8 w-8 text-blue-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Price Screenshot</p>
                      <p className="text-xs text-gray-500">View image</p>
                    </div>
                  </a>
                )}

                {proof.hasEmailProof && (
                  <a
                    href={proofEmailUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  >
                    <ClipboardDocumentCheckIcon className="h-8 w-8 text-green-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Email Proof</p>
                      <p className="text-xs text-gray-500">View screenshot</p>
                    </div>
                  </a>
                )}
              </div>

              {/* Email Body (collapsible) */}
              {proof.emailBody && (
                <details className="bg-gray-50 rounded-lg">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 hover:text-gray-900">
                    View full email sent to issuer
                  </summary>
                  <div className="px-4 pb-4">
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono bg-white p-4 rounded border border-gray-200 max-h-80 overflow-y-auto">
                      {proof.emailBody}
                    </pre>
                  </div>
                </details>
              )}

              {/* Status History */}
              {proof.statusHistory && proof.statusHistory.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Timeline</h4>
                  <div className="space-y-2">
                    {proof.statusHistory.map((entry, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-sm">
                        <div className="w-2 h-2 mt-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-gray-900">{entry.status.replace(/_/g, ' ')}</span>
                          <span className="text-gray-500 ml-2">
                            {format(new Date(entry.timestamp), 'MMM d, yyyy h:mm a')}
                          </span>
                          {entry.notes && (
                            <p className="text-gray-500 text-xs mt-0.5">{entry.notes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Filing Instructions (only for unfiled claims) */}
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
                    Online Portal
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
                    {inst.deadlines.daysRemaining} days remaining to file
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
              {/* Primary Action: Auto-File */}
              {['DRAFT', 'READY_TO_FILE'].includes(claim.status) && (
                <button
                  onClick={() => autoFileMutation.mutate()}
                  disabled={autoFileMutation.isPending}
                  className="w-full btn-success flex items-center justify-center text-lg py-3"
                >
                  {autoFileMutation.isPending ? (
                    <>
                      <ArrowPathIcon className="h-6 w-6 mr-2 animate-spin" />
                      Filing Claim...
                    </>
                  ) : (
                    <>
                      <RocketLaunchIcon className="h-6 w-6 mr-2" />
                      Auto-File Claim
                    </>
                  )}
                </button>
              )}

              {['DRAFT', 'READY_TO_FILE'].includes(claim.status) && (
                <p className="text-xs text-gray-500 text-center">
                  We'll email your claim with all documentation to the card issuer
                </p>
              )}

              {claim.status === 'DRAFT' && (
                <button
                  onClick={() => generateDocsMutation.mutate()}
                  disabled={generateDocsMutation.isPending}
                  className="w-full btn-secondary flex items-center justify-center"
                >
                  <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
                  Generate Documentation Only
                </button>
              )}

              {['DRAFT', 'READY_TO_FILE'].includes(claim.status) && (
                <button
                  onClick={() => {
                    const claimNumber = prompt('Enter claim confirmation number (optional):');
                    fileMutation.mutate(claimNumber);
                  }}
                  disabled={fileMutation.isPending}
                  className="w-full btn-secondary"
                >
                  Mark as Filed Manually
                </button>
              )}

              {['EMAIL_SENT', 'FILED'].includes(claim.status) && (
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
                  {claim.creditCard?.nickname} ({claim.creditCard?.issuer} ending {claim.creditCard?.lastFour})
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
