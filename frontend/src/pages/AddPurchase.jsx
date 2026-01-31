import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { purchasesAPI, cardsAPI } from '../services/api';
import toast from 'react-hot-toast';

export default function AddPurchase() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    productName: '',
    retailer: '',
    purchasePrice: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    productUrl: '',
    creditCardId: '',
    retailerOrderId: '',
    category: '',
    imageUrl: ''
  });

  const { data: cards } = useQuery({
    queryKey: ['cards'],
    queryFn: () => cardsAPI.getAll()
  });

  const createMutation = useMutation({
    mutationFn: (data) => purchasesAPI.create(data),
    onSuccess: (result) => {
      toast.success('Purchase added!');
      navigate(`/purchases/${result.data.id}`);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to add purchase');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    const data = {
      ...formData,
      purchasePrice: parseFloat(formData.purchasePrice),
      creditCardId: formData.creditCardId || undefined,
      productUrl: formData.productUrl || undefined,
      retailerOrderId: formData.retailerOrderId || undefined,
      category: formData.category || undefined,
      imageUrl: formData.imageUrl || undefined
    };

    createMutation.mutate(data);
  };

  const retailers = [
    'Amazon', 'Best Buy', 'Walmart', 'Target', 'Costco',
    'Home Depot', 'Lowes', 'Newegg', 'Apple', 'Other'
  ];

  const categories = [
    'Electronics', 'Home & Garden', 'Clothing', 'Appliances',
    'Toys & Games', 'Sports & Outdoors', 'Office', 'Other'
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/purchases"
        className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-2" />
        Back to purchases
      </Link>

      <div className="card p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Purchase</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="label">Product Name *</label>
            <input
              type="text"
              value={formData.productName}
              onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
              className="input"
              placeholder="e.g., Sony WH-1000XM4 Headphones"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Retailer *</label>
              <select
                value={formData.retailer}
                onChange={(e) => setFormData({ ...formData, retailer: e.target.value })}
                className="input"
                required
              >
                <option value="">Select retailer</option>
                {retailers.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="input"
              >
                <option value="">Select category</option>
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Purchase Price ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={formData.purchasePrice}
                onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                className="input"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="label">Purchase Date *</label>
              <input
                type="date"
                value={formData.purchaseDate}
                onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                className="input"
                required
              />
            </div>
          </div>

          <div>
            <label className="label">Credit Card</label>
            <select
              value={formData.creditCardId}
              onChange={(e) => setFormData({ ...formData, creditCardId: e.target.value })}
              className="input"
            >
              <option value="">Select a card (optional)</option>
              {cards?.data?.map(card => (
                <option key={card.id} value={card.id}>
                  {card.nickname} ({card.issuer} •••• {card.lastFour})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Link a card to enable price protection tracking.{' '}
              <Link to="/cards" className="text-primary-600 hover:underline">Add a card</Link>
            </p>
          </div>

          <div>
            <label className="label">Product URL</label>
            <input
              type="url"
              value={formData.productUrl}
              onChange={(e) => setFormData({ ...formData, productUrl: e.target.value })}
              className="input"
              placeholder="https://www.amazon.com/dp/..."
            />
            <p className="text-xs text-gray-500 mt-1">
              Add the product URL to enable automatic price monitoring
            </p>
          </div>

          <div>
            <label className="label">Order ID</label>
            <input
              type="text"
              value={formData.retailerOrderId}
              onChange={(e) => setFormData({ ...formData, retailerOrderId: e.target.value })}
              className="input"
              placeholder="e.g., 123-4567890-1234567"
            />
          </div>

          <div>
            <label className="label">Image URL</label>
            <input
              type="url"
              value={formData.imageUrl}
              onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
              className="input"
              placeholder="https://..."
            />
          </div>

          <div className="flex justify-end space-x-4 pt-4 border-t">
            <Link to="/purchases" className="btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending ? 'Adding...' : 'Add Purchase'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
