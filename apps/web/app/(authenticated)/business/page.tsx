/**
 * app/(authenticated)/business/page.tsx
 *
 * Business Account dashboard showing account details, tier, analytics, and management options.
 */

'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/hooks';
import Link from 'next/link';

interface BusinessAccount {
  id: string;
  user_id: string;
  display_name: string;
  description: string | null;
  tier: 'starter' | 'growth' | 'enterprise';
  is_active: boolean;
  created_at: string;
  analytics: {
    total_reach: number;
    total_impressions: number;
    total_engagement: number;
    follower_count: number;
  };
}

export default function BusinessDashboard() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const { data: account, isLoading: accountLoading } = useQuery({
    queryKey: ['business-account', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await apiClient.get('/api/business');
      return data.account as BusinessAccount | null;
    },
    enabled: !!user,
  });

  if (!user) {
    return <div className="p-6 text-center">Please sign in</div>;
  }

  if (accountLoading) {
    return <div className="p-6 text-center">Loading...</div>;
  }

  if (!account) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Business Account</h1>
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Get Started with a Business Account</h2>
          <p className="text-gray-600 mb-6">
            Unlock professional tools to manage your audience, track analytics, and grow your reach.
          </p>
          <Link href="/business/create">
            <Button className="bg-blue-600 text-white">Create Business Account</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const getTierLabel = (tier: string) => {
    const labels: Record<string, string> = {
      starter: 'Starter',
      growth: 'Growth',
      enterprise: 'Enterprise',
    };
    return labels[tier] || tier;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{account.display_name}</h1>
        <p className="text-gray-600">{account.description}</p>
      </div>

      {/* Account Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="p-6">
          <div className="text-sm font-semibold text-gray-600 mb-2">Current Tier</div>
          <div className="text-2xl font-bold">{getTierLabel(account.tier)}</div>
        </Card>
        <Card className="p-6">
          <div className="text-sm font-semibold text-gray-600 mb-2">Account Status</div>
          <div className={`text-lg font-semibold ${account.is_active ? 'text-green-600' : 'text-red-600'}`}>
            {account.is_active ? 'Active' : 'Inactive'}
          </div>
        </Card>
        <Card className="p-6">
          <div className="text-sm font-semibold text-gray-600 mb-2">Member Since</div>
          <div className="text-lg font-semibold">
            {new Date(account.created_at).toLocaleDateString()}
          </div>
        </Card>
      </div>

      {/* Analytics */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Analytics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-6">
            <div className="text-sm font-semibold text-gray-600 mb-2">Total Reach</div>
            <div className="text-3xl font-bold">{account.analytics.total_reach.toLocaleString()}</div>
          </Card>
          <Card className="p-6">
            <div className="text-sm font-semibold text-gray-600 mb-2">Impressions</div>
            <div className="text-3xl font-bold">{account.analytics.total_impressions.toLocaleString()}</div>
          </Card>
          <Card className="p-6">
            <div className="text-sm font-semibold text-gray-600 mb-2">Engagement</div>
            <div className="text-3xl font-bold">{account.analytics.total_engagement.toLocaleString()}</div>
          </Card>
          <Card className="p-6">
            <div className="text-sm font-semibold text-gray-600 mb-2">Followers</div>
            <div className="text-3xl font-bold">{account.analytics.follower_count.toLocaleString()}</div>
          </Card>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        <Button variant="secondary">Edit Account</Button>
        <Button variant="secondary">View Settings</Button>
        <Button variant="secondary">Manage Tier</Button>
      </div>
    </div>
  );
}
