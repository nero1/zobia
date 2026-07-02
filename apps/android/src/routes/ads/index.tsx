/**
 * apps/android/src/routes/ads/index.tsx
 *
 * Ads hub — mirrors apps/web/app/(app)/ads/page.tsx. Eligible advertisers
 * (verified Business Account, KYC Tier 1+) are sent to the full
 * Advertising Panel at /business/ads; everyone else sees the explainer.
 */

import { useEffect } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

interface Eligibility {
  eligible: boolean;
  reason?: string;
}

async function fetchEligibility(): Promise<Eligibility> {
  const { data } = await apiClient.get<Eligibility>('/business/ads/eligibility');
  return data;
}

const FEATURES = [
  { emoji: '🖼️', title: 'Ad formats', body: '300×250, 320×50, interstitial, rewarded video, and in-stream native placements.' },
  { emoji: '💰', title: 'CPM billing', body: 'Pay per 1,000 impressions with Zobia Credits — top up with cash or Credits directly.' },
  { emoji: '🤖', title: 'Fast, safe review', body: 'AI-assisted moderation with manual escalation.' },
  { emoji: '📈', title: 'Boost your content', body: 'Promote a Blog post or Room alongside standalone campaigns.' },
];

function AdsHubPage() {
  const router = useRouter();
  const { data, status } = useQuery({ queryKey: ['ads', 'eligibility'], queryFn: fetchEligibility });

  useEffect(() => {
    if (data?.eligible) router.navigate({ to: '/business/ads' });
  }, [data, router]);

  if (status === 'pending' || data?.eligible) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="h-40 animate-pulse rounded-2xl bg-neutral-200" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-1">Advertise on Zobia</h1>
      <p className="text-sm text-neutral-500 mb-4">Reach the Zobia community with banners, native placements, interstitials, and rewarded video.</p>

      <div className="bg-white rounded-xl p-4 shadow-card mb-4">
        <p className="text-sm text-neutral-600">{data?.reason ?? 'You need a verified Business Account with identity verification to place ads.'}</p>
        <div className="mt-3 flex gap-2">
          <Link to="/business" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">Create Business Account</Link>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">Identity verification (KYC) is completed on web or PWA.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="bg-white rounded-xl p-3 shadow-card">
            <span className="text-xl">{f.emoji}</span>
            <p className="mt-1 text-xs font-semibold text-neutral-900">{f.title}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/ads/')({
  component: AdsHubPage,
});
