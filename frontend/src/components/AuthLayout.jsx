import React from 'react';
import { Outlet, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AuthLayout() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" />;
  }

  return (
    <div className="min-h-screen flex">
      {/* Left side - form */}
      <div className="flex-1 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/" className="flex items-center space-x-2 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-purple-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold">PP</span>
            </div>
            <span className="text-xl font-bold text-gray-900">PriceProtectionBot</span>
          </Link>
          <Outlet />
        </div>
      </div>

      {/* Right side - illustration */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col lg:justify-center lg:items-center bg-gradient-to-br from-primary-500 to-purple-600 p-12">
        <div className="max-w-md text-center text-white">
          <div className="text-6xl mb-6">💰</div>
          <h2 className="text-3xl font-bold mb-4">
            Stop Leaving Money on the Table
          </h2>
          <p className="text-lg opacity-90">
            Your credit cards have price protection benefits that can save you hundreds.
            We monitor your purchases and file claims automatically when prices drop.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-2xl font-bold">$500</div>
              <div className="text-sm opacity-75">Avg. Annual Savings</div>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-2xl font-bold">90%</div>
              <div className="text-sm opacity-75">Claim Success Rate</div>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-2xl font-bold">1%</div>
              <div className="text-sm opacity-75">Current Utilization</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
