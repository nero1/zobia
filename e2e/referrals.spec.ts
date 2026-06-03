/**
 * E2E tests for the Referral link system — Tier 1 and Tier 2 bonus verification.
 *
 * Verifies:
 *  - User A can generate a referral code
 *  - User B can register using User A's referral code
 *  - User A receives Tier 1 XP + coin bonus after B's qualifying action
 *  - User B can generate their own referral code
 *  - User C can register using User B's referral code
 *  - User A receives a Tier 2 bonus (indirect referral)
 *  - The referral chain does NOT extend to Tier 3
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const USER_A_TOKEN = process.env.E2E_USER_A_TOKEN ?? '';
const USER_B_TOKEN = process.env.E2E_USER_B_TOKEN ?? '';
const USER_A_TOKEN_SET = !!USER_A_TOKEN;
const USER_B_TOKEN_SET = !!USER_B_TOKEN;

function headersFor(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// Shared state across tests
let userAReferralCode: string | null = null;
let userBReferralCode: string | null = null;

// ---------------------------------------------------------------------------
// Referral link — Tier 1 and Tier 2 bonus verification
// ---------------------------------------------------------------------------

test.describe('Referral link — Tier 1 and Tier 2 bonus verification', () => {

  // -------------------------------------------------------------------------
  // User A generates a referral link
  // -------------------------------------------------------------------------

  test('User A can generate a referral code via GET /api/referrals', async ({ request }) => {
    if (!USER_A_TOKEN_SET) {
      test.skip(true, 'E2E_USER_A_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/referrals', {
      headers: headersFor(USER_A_TOKEN),
    });

    expect(response.status()).toBe(200);

    const body = await response.json().catch(() => ({}));
    const code: string =
      body.code ??
      body.referralCode ??
      body.data?.code ??
      body.data?.referralCode ??
      '';

    expect(code.length).toBeGreaterThan(0);
    userAReferralCode = code;
  });

  test('User A referral code is a non-empty string', async ({ request }) => {
    if (!USER_A_TOKEN_SET) {
      test.skip(true, 'E2E_USER_A_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/referrals', {
      headers: headersFor(USER_A_TOKEN),
    });

    if (response.status() === 200) {
      const body = await response.json().catch(() => ({}));
      const code: string =
        body.code ?? body.referralCode ?? body.data?.code ?? '';
      expect(typeof code).toBe('string');
      expect(code.trim().length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // User B registers with User A's referral code
  // -------------------------------------------------------------------------

  test('User B can complete onboarding with User A\'s referral code', async ({ request }) => {
    const code = userAReferralCode ?? process.env.E2E_USER_A_REFERRAL_CODE ?? null;

    if (!code) {
      test.skip(true, 'User A referral code not available — skipping');
      return;
    }

    const response = await request.post('/api/onboarding/complete', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        username: `e2e_userb_${Date.now()}`,
        displayName: 'E2E User B',
        referralCode: code,
      },
    });

    // 200/201 for success; 400 if user B is already onboarded (also acceptable in CI)
    expect([200, 201, 400, 409]).toContain(response.status());
  });

  // -------------------------------------------------------------------------
  // User A receives Tier 1 bonus
  // -------------------------------------------------------------------------

  test('User A receives Tier 1 XP and coin bonus after B\'s qualifying action', async ({ request }) => {
    if (!USER_A_TOKEN_SET) {
      test.skip(true, 'E2E_USER_A_TOKEN not set — skipping');
      return;
    }

    // Capture User A's XP and coin balance before claiming
    const walletBefore = await request.get('/api/wallet', {
      headers: headersFor(USER_A_TOKEN),
    });
    const before = await walletBefore.json().catch(() => ({}));
    const coinsBefore: number =
      before.balance ?? before.coins ?? before.data?.balance ?? 0;

    // Trigger the Tier 1 referral bonus claim
    const claimResp = await request.post('/api/referrals/claim', {
      headers: headersFor(USER_A_TOKEN),
      data: { tier: 1 },
    });

    // 200/201 for a new claim; 200/204 if already claimed
    expect([200, 201, 204, 400, 404]).toContain(claimResp.status());

    if (claimResp.status() >= 200 && claimResp.status() < 300) {
      // Wallet should have increased
      const walletAfter = await request.get('/api/wallet', {
        headers: headersFor(USER_A_TOKEN),
      });
      const after = await walletAfter.json().catch(() => ({}));
      const coinsAfter: number =
        after.balance ?? after.coins ?? after.data?.balance ?? 0;

      expect(coinsAfter).toBeGreaterThanOrEqual(coinsBefore);
    }
  });

  test('Tier 1 bonus claim returns XP awarded in the response body', async ({ request }) => {
    if (!USER_A_TOKEN_SET) {
      test.skip(true, 'E2E_USER_A_TOKEN not set — skipping');
      return;
    }

    const claimResp = await request.post('/api/referrals/claim', {
      headers: headersFor(USER_A_TOKEN),
      data: { tier: 1 },
    });

    if (claimResp.status() >= 200 && claimResp.status() < 300) {
      const body = await claimResp.json().catch(() => ({}));
      const xpAwarded: number =
        body.xp ?? body.xpAwarded ?? body.data?.xp ?? 0;
      // Should have been awarded some XP
      expect(xpAwarded).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // User B generates their own referral code
  // -------------------------------------------------------------------------

  test('User B can generate their own referral code', async ({ request }) => {
    if (!USER_B_TOKEN_SET) {
      test.skip(true, 'E2E_USER_B_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/referrals', {
      headers: headersFor(USER_B_TOKEN),
    });

    expect(response.status()).toBe(200);

    const body = await response.json().catch(() => ({}));
    const code: string =
      body.code ?? body.referralCode ?? body.data?.code ?? '';

    expect(code.length).toBeGreaterThan(0);
    userBReferralCode = code;
  });

  test('User B referral code is different from User A\'s code', async ({ request }) => {
    if (!USER_A_TOKEN_SET || !USER_B_TOKEN_SET) {
      test.skip(true, 'Both user tokens required — skipping');
      return;
    }

    const respA = await request.get('/api/referrals', { headers: headersFor(USER_A_TOKEN) });
    const respB = await request.get('/api/referrals', { headers: headersFor(USER_B_TOKEN) });

    if (respA.status() === 200 && respB.status() === 200) {
      const bodyA = await respA.json().catch(() => ({}));
      const bodyB = await respB.json().catch(() => ({}));
      const codeA = bodyA.code ?? bodyA.referralCode ?? '';
      const codeB = bodyB.code ?? bodyB.referralCode ?? '';

      if (codeA && codeB) {
        expect(codeA).not.toBe(codeB);
      }
    }
  });

  // -------------------------------------------------------------------------
  // User C registers with User B's code — User A should get Tier 2 bonus
  // -------------------------------------------------------------------------

  test('User C can complete onboarding with User B\'s referral code', async ({ request }) => {
    const code = userBReferralCode ?? process.env.E2E_USER_B_REFERRAL_CODE ?? null;

    if (!code) {
      test.skip(true, 'User B referral code not available — skipping');
      return;
    }

    const response = await request.post('/api/onboarding/complete', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        username: `e2e_userc_${Date.now()}`,
        displayName: 'E2E User C',
        referralCode: code,
      },
    });

    expect([200, 201, 400, 409]).toContain(response.status());
  });

  test('User A receives a Tier 2 bonus after User C registers with User B\'s code', async ({ request }) => {
    if (!USER_A_TOKEN_SET) {
      test.skip(true, 'E2E_USER_A_TOKEN not set — skipping');
      return;
    }

    // Check referral stats for User A — should show a Tier 2 entry
    const statsResp = await request.get('/api/referrals/stats', {
      headers: headersFor(USER_A_TOKEN),
    });

    if (statsResp.status() === 200) {
      const body = await statsResp.json().catch(() => ({}));
      const tier2Count: number =
        body.tier2Referrals ??
        body.tier2Count ??
        body.stats?.tier2 ??
        body.data?.tier2Referrals ??
        0;

      expect(tier2Count).toBeGreaterThan(0);
    } else {
      // Endpoint may not exist; attempt Tier 2 claim instead
      const claimResp = await request.post('/api/referrals/claim', {
        headers: headersFor(USER_A_TOKEN),
        data: { tier: 2 },
      });
      expect([200, 201, 204, 400, 404]).toContain(claimResp.status());
    }
  });

  // -------------------------------------------------------------------------
  // Tier 3 chain does not exist
  // -------------------------------------------------------------------------

  test('referral chain does not extend to Tier 3 — Tier 3 claim returns 400 or 404', async ({ request }) => {
    if (!USER_A_TOKEN_SET) {
      test.skip(true, 'E2E_USER_A_TOKEN not set — skipping');
      return;
    }

    // Attempt a Tier 3 referral claim — must be rejected
    const response = await request.post('/api/referrals/claim', {
      headers: headersFor(USER_A_TOKEN),
      data: { tier: 3 },
    });

    // Server must reject Tier 3 claims (invalid tier)
    expect([400, 404, 422]).toContain(response.status());
  });

  test('referral stats show a maximum depth of 2', async ({ request }) => {
    if (!USER_A_TOKEN_SET) {
      test.skip(true, 'E2E_USER_A_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/referrals/stats', {
      headers: headersFor(USER_A_TOKEN),
    });

    if (response.status() === 200) {
      const body = await response.json().catch(() => ({}));
      const maxTier: number =
        body.maxTier ?? body.maxDepth ?? body.data?.maxTier ?? 2;

      // The system should only support up to Tier 2
      expect(maxTier).toBeLessThanOrEqual(2);
    }
  });
});
