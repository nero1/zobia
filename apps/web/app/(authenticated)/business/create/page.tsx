/**
 * app/(authenticated)/business/create/page.tsx
 *
 * Business Account signup form with tier selection.
 */

'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api/client';
import { useRouter } from 'next/navigation';

type Tier = 'starter' | 'growth' | 'enterprise';

interface TierOption {
  id: Tier;
  name: string;
  price: number;
  description: string;
  features: string[];
}

const TIERS: TierOption[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    description: 'Perfect for getting started',
    features: [
      'Basic analytics dashboard',
      'Up to 5 pinned posts',
      'Monthly performance report',
      'Email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 99,
    description: 'For growing creators',
    features: [
      'Advanced analytics',
      'Up to 50 pinned posts',
      'Weekly performance reports',
      'Priority email support',
      'Custom branded dashboard',
      'Team member access (up to 3)',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 299,
    description: 'For established brands',
    features: [
      'Full analytics suite',
      'Unlimited pinned posts',
      'Real-time dashboards',
      '24/7 priority support',
      'Dedicated account manager',
      'Unlimited team members',
      'API access',
      'Custom integrations',
    ],
  },
];

export default function CreateBusinessAccount() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    displayName: '',
    description: '',
    selectedTier: 'starter' as Tier,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: response } = await apiClient.post('/api/business', {
        display_name: data.displayName,
        description: data.description,
        tier: data.selectedTier,
      });
      return response;
    },
    onSuccess: () => {
      router.push('/business');
    },
    onError: (error: any) => {
      alert('Failed to create business account: ' + (error.message || 'Unknown error'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.displayName.trim()) {
      alert('Please enter a display name');
      return;
    }
    createMutation.mutate(formData);
  };

  const selectedTierOption = TIERS.find((t) => t.id === formData.selectedTier)!;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Create Business Account</h1>
      <p className="text-gray-600 mb-8">Set up your business account and choose a tier to get started.</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Tier Selection */}
        <div className="lg:col-span-2">
          <h2 className="text-2xl font-bold mb-6">Select Your Tier</h2>
          <div className="grid gap-4">
            {TIERS.map((tier) => (
              <Card
                key={tier.id}
                className={`p-6 cursor-pointer transition ${
                  formData.selectedTier === tier.id
                    ? 'border-blue-500 border-2 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
                onClick={() => setFormData({ ...formData, selectedTier: tier.id })}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold">{tier.name}</h3>
                    <p className="text-sm text-gray-600">{tier.description}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">${tier.price}</div>
                    <div className="text-sm text-gray-600">/month</div>
                  </div>
                </div>
                <ul className="mt-4 space-y-2">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-center text-sm">
                      <span className="text-green-600 mr-2">✓</span> {feature}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>

          {/* Account Details Form */}
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-6">Account Details</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold mb-2">Business Display Name</label>
                <input
                  type="text"
                  required
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., My Creative Brand"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Description (Optional)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Tell your audience about your business..."
                  rows={4}
                />
              </div>

              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full bg-blue-600 text-white hover:bg-blue-700"
              >
                {createMutation.isPending ? 'Creating Account...' : `Create Account (${selectedTierOption.name})`}
              </Button>
            </form>
          </div>
        </div>

        {/* Summary */}
        <div>
          <Card className="p-6 sticky top-6">
            <h3 className="text-lg font-bold mb-4">Order Summary</h3>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-600">Selected Tier</span>
                <span className="font-semibold">{selectedTierOption.name}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-3">
                <span>Monthly Cost</span>
                <span>${selectedTierOption.price}</span>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              You will be charged monthly. Cancel anytime. By proceeding, you agree to our Terms of Service.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
