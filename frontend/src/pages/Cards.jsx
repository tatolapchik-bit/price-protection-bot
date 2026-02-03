import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PlusIcon,
  CreditCardIcon,
  TrashIcon,
  BoltIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { cardsAPI } from '../services/api';
import toast from 'react-hot-toast';

export default function Cards() {
  const [showForm, setShowForm] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowQuickAdd(true)}
            className="btn-primary"
          >
            <BoltIcon className="h-5 w-5 mr-2" />
            Quick Add
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="btn-secondary"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Manual Add
          </button>
        </div>
      </div>

      {/* Quick Add Card Form */}
      {showQuickAdd && (
        <QuickAddCardForm
          onClose={() => setShowQuickAdd(false)}
          onSuccess={() => {
            setShowQuickAdd(false);
            queryClient.invalidateQueries(['cards']);
          }}
        />
      )}

      {/* Manual Add Card Form */}
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
                      {card.issuer} â¢â¢â¢â¢ {card.lastFour}
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

              {/* Auto-claim indicator */}
              <div className="mt-4 pt-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">Auto-Claim</span>
                <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                  card.autoClaimEnabled
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {card.autoClaimEnabled ? (
                    <>
                      <CheckCircleIcon className="h-3 w-3 mr-1" />
                      Enabled
                    </>
                  ) : 'Disabled'}
                </span>
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

function QuickAddCardForm({ onClose, onSuccess }) {
  const [cardNumber, setCardNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [detected, setDetected] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);

  const quickAddMutation = useMutation({
    mutationFn: ({ cardNumber, nickname }) => cardsAPI.quickAdd(cardNumber, nickname || undefined),
    onSuccess: (response) => {
      toast.success(`${response.data.detected?.issuer || 'Card'} added successfully!`);
      onSuccess();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to add card');
    }
  });

  // Auto-detect card when number is entered
  const handleCardNumberChange = async (value) => {
    // Only allow numbers and format with spaces
    const cleaned = value.replace(/\D/g, '');
    const formatted = cleaned.replace(/(\d{4})(?=\d)/g, '$1 ');
    setCardNumber(formatted);

    // Detect card when we have enough digits
    if (cleaned.length >= 13) {
      setIsDetecting(true);
      try {
        const response = await cardsAPI.detectCard(cleaned);
        setDetected(response.data);
        // Auto-set nickname suggestion
        if (!nickname && response.data.issuer) {
          setNickname(`${response.data.issuer} ****${response.data.lastFour}`);
        }
      } catch (error) {
        setDetected({ error: error.response?.data?.error || 'Could not detect card' });
      }
      setIsDetecting(false);
    } else {
      setDetected(null);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanNumber = cardNumber.replace(/\s/g, '');
    quickAddMutation.mutate({ cardNumber: cleanNumber, nickname });
  };

  return (
    <div className="card p-6 mb-6 border-2 border-primary-200 bg-primary-50/30">
      <div className="flex items-center gap-2 mb-4">
        <BoltIcon className="h-6 w-6 text-primary-600" />
        <h2 className="text-lg font-semibold text-gray-900">Quick Add Card</h2>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Enter your card number and we'll automatically detect the issuer and price protection details.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Card Number *</label>
          <input
            type="text"
            value={cardNumber}
            onChange={(e) => handleCardNumberChange(e.target.value)}
            className="input text-lg tracking-wider font-mono"
            placeholder="4111 1111 1111 1111"
            maxLength={23}
            required
            autoComplete="cc-number"
          />
          <p className="text-xs text-gray-500 mt-1">
            Your card number is encrypted and stored securely. We use it to auto-detect the issuer and file claims.
          </p>
        </div>

        {/* Detection Result */}
        {isDetecting && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
            Detecting card...
          </div>
        )}

        {detected && !detected.error && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircleIcon className="h-5 w-5 text-green-600" />
              <span className="font-medium text-green-800">Card Detected!</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Issuer:</span>
                <span className="ml-2 font-medium">{detected.fullName || detected.issuer}</span>
              </div>
              <div>
                <span className="text-gray-600">Type:</span>
                <span className="ml-2 font-medium">{detected.cardType}</span>
              </div>
              <div>
                <span className="text-gray-600">Protection:</span>
                <span className="ml-2 font-medium">{detected.priceProtection?.protectionDays || 60} days</span>
              </div>
              <div>
                <span className="text-gray-600">Max Claim:</span>
                <span className="ml-2 font-medium">${detected.priceProtection?.maxClaimAmount || 500}</span>
              </div>
            </div>
          </div>
        )}

        {detected?.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {detected.error}
          </div>
        )}

        <div>
          <label className="label">Card Nickname (optional)</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="input"
            placeholder="e.g., My Amex Gold"
          />
        </div>

        <div className="flex justify-end space-x-4 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={quickAddMutation.isPending || !detected || detected.error}
            className="btn-primary"
          >
            {quickAddMutation.isPending ? 'Adding...' : 'Add Card'}
          </button>
        </div>
      </form>
    </div>
  );
}
