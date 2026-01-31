import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PlusIcon,
  CreditCardIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { cardsAPI } from '../services/api';
import toast from 'react-hot-toast';

export default function Cards() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['cards'],
    queryFn: () => cardsAPI.getAll()
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => cardsAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['cards']);
      toast.success('Card deleted');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to delete');
    }
  });

  const cards = data?.data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Credit Cards</h1>
          <p className="text-gray-600 mt-1">Manage your cards for price protection tracking.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary"
        >
          <PlusIcon className="h-5 w-5 mr-2" />
          Add Card
        </button>
      </div>

      {/* Add Card Form */}
      {showForm && (
        <AddCardForm
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries(['cards']);
          }}
        />
      )}

      {/* Cards List */}
      {isLoading ? (
        <div className="card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : cards.length === 0 ? (
        <div className="card p-8 text-center">
          <CreditCardIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No cards added</h3>
          <p className="text-gray-500 mb-4">
            Add your credit cards to track price protection benefits.
          </p>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            Add Your First Card
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <div key={card.id} className="card p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    card.cardType === 'VISA' ? 'bg-blue-100' :
                    card.cardType === 'MASTERCARD' ? 'bg-red-100' :
                    card.cardType === 'AMEX' ? 'bg-blue-100' :
                    'bg-gray-100'
                  }`}>
                    <CreditCardIcon className={`h-6 w-6 ${
                      card.cardType === 'VISA' ? 'text-blue-600' :
                      card.cardType === 'MASTERCARD' ? 'text-red-600' :
                      card.cardType === 'AMEX' ? 'text-blue-600' :
                      'text-gray-600'
                    }`} />
                  </div>
                  <div className="ml-4">
                    <h3 className="font-semibold text-gray-900">{card.nickname}</h3>
                    <p className="text-sm text-gray-500">
                      {card.issuer} •••• {card.lastFour}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm('Delete this card?')) {
                      deleteMutation.mutate(card.id);
                    }
                  }}
                  className="text-gray-400 hover:text-red-500"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Protection</p>
                  <p className="font-medium">{card.protectionDays} days</p>
                </div>
                <div>
                  <p className="text-gray-500">Max Claim</p>
                  <p className="font-medium">${card.maxClaimAmount}</p>
                </div>
                <div>
                  <p className="text-gray-500">Purchases</p>
                  <p className="font-medium">{card._count?.purchases || 0}</p>
                </div>
                <div>
                  <p className="text-gray-500">Claims</p>
                  <p className="font-medium">{card._count?.claims || 0}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddCardForm({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    nickname: '',
    issuer: '',
    lastFour: '',
    cardType: 'VISA',
    protectionDays: 60,
    maxClaimAmount: 500,
    claimMethod: 'ONLINE_PORTAL',
    claimPortalUrl: '',
    claimPhoneNumber: ''
  });

  const createMutation = useMutation({
    mutationFn: (data) => cardsAPI.create(data),
    onSuccess: () => {
      toast.success('Card added!');
      onSuccess();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to add card');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      protectionDays: parseInt(formData.protectionDays),
      maxClaimAmount: parseFloat(formData.maxClaimAmount),
      claimPortalUrl: formData.claimPortalUrl || undefined,
      claimPhoneNumber: formData.claimPhoneNumber || undefined
    });
  };

  const issuers = ['Chase', 'Citi', 'American Express', 'Discover', 'Capital One', 'Bank of America', 'Other'];

  return (
    <div className="card p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Credit Card</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Card Nickname *</label>
            <input
              type="text"
              value={formData.nickname}
              onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
              className="input"
              placeholder="e.g., Chase Sapphire Reserve"
              required
            />
          </div>
          <div>
            <label className="label">Issuer *</label>
            <select
              value={formData.issuer}
              onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
              className="input"
              required
            >
              <option value="">Select issuer</option>
              {issuers.map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Last 4 Digits *</label>
            <input
              type="text"
              value={formData.lastFour}
              onChange={(e) => setFormData({ ...formData, lastFour: e.target.value.slice(0, 4) })}
              className="input"
              placeholder="1234"
              maxLength={4}
              pattern="\d{4}"
              required
            />
          </div>
          <div>
            <label className="label">Card Type *</label>
            <select
              value={formData.cardType}
              onChange={(e) => setFormData({ ...formData, cardType: e.target.value })}
              className="input"
              required
            >
              <option value="VISA">Visa</option>
              <option value="MASTERCARD">Mastercard</option>
              <option value="AMEX">American Express</option>
              <option value="DISCOVER">Discover</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Protection Days</label>
            <input
              type="number"
              value={formData.protectionDays}
              onChange={(e) => setFormData({ ...formData, protectionDays: e.target.value })}
              className="input"
              min={1}
              max={365}
            />
            <p className="text-xs text-gray-500 mt-1">Days after purchase for price protection</p>
          </div>
          <div>
            <label className="label">Max Claim Amount ($)</label>
            <input
              type="number"
              value={formData.maxClaimAmount}
              onChange={(e) => setFormData({ ...formData, maxClaimAmount: e.target.value })}
              className="input"
              min={0}
              step="0.01"
            />
            <p className="text-xs text-gray-500 mt-1">Maximum per-item claim amount</p>
          </div>
        </div>

        <div>
          <label className="label">Claim Method</label>
          <select
            value={formData.claimMethod}
            onChange={(e) => setFormData({ ...formData, claimMethod: e.target.value })}
            className="input"
          >
            <option value="ONLINE_PORTAL">Online Portal</option>
            <option value="PHONE">Phone</option>
            <option value="EMAIL">Email</option>
            <option value="MAIL">Mail</option>
          </select>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Claim Portal URL</label>
            <input
              type="url"
              value={formData.claimPortalUrl}
              onChange={(e) => setFormData({ ...formData, claimPortalUrl: e.target.value })}
              className="input"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="label">Claim Phone Number</label>
            <input
              type="tel"
              value={formData.claimPhoneNumber}
              onChange={(e) => setFormData({ ...formData, claimPhoneNumber: e.target.value })}
              className="input"
              placeholder="1-800-..."
            />
          </div>
        </div>

        <div className="flex justify-end space-x-4 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="btn-primary"
          >
            {createMutation.isPending ? 'Adding...' : 'Add Card'}
          </button>
        </div>
      </form>
    </div>
  );
}
