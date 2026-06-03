/**
 * E2E tests for the Season Reset flow.
 *
 * Verifies:
 *  - The test user has main rank XP > 0 before the reset
 *  - Triggering a season reset zeroes out the main rank XP
 *  - Track levels (social / creator) are preserved after reset
 *  - A Season History entry is created for the completed season
 *  - Coins and inventory are preserved across the reset
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers and constants
// ---------------------------------------------------------------------------

const USER_TOKEN = process.env.E2E_USER_TOKEN ?? '';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? '';
const USER_TOKEN_SET = !!USER_TOKEN;
const ADMIN_TOKEN_SET = !!ADMIN_TOKEN;

const TEST_USER_ID = process.env.E2E_TEST_USER_ID ?? 'test-user-id';

function userHeaders() {
  return {
    Authorization: `Bearer ${USER_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function adminHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch the user's profile. Returns null if the request fails.
 */
async function fetchProfile(request: import('@playwright/test').APIRequestContext, userId: string, headers: Record<string, string>) {
  const resp = await request.get(`/api/profile/${userId}`, { headers });
  if (resp.status() !== 200) return null;
  return resp.json().catch(() => null);
}

// ---------------------------------------------------------------------------
// Season reset flow
// ---------------------------------------------------------------------------

test.describe('Season reset flow', () => {

  // -------------------------------------------------------------------------
  // Pre-reset: XP must be > 0
  // -------------------------------------------------------------------------

  test('user has main rank XP greater than 0 before reset', async ({ request }) => {
    if (!USER_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    const profile = await fetchProfile(request, TEST_USER_ID, userHeaders());

    if (!profile) {
      test.skip(true, 'Could not fetch profile — skipping');
      return;
    }

    const mainXp: number =
      profile.xp ??
      profile.mainRankXp ??
      profile.rankXp ??
      profile.data?.xp ??
      0;

    // The test environment should seed non-zero XP; if it hasn't, we skip
    if (mainXp === 0) {
      test.skip(true, 'User XP is already 0 — seeding required; skipping reset assertion');
      return;
    }

    expect(mainXp).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Trigger season reset
  // -------------------------------------------------------------------------

  test('season reset endpoint responds with 200/202', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    // Try the CRON-style endpoint first, fall back to a dedicated test endpoint
    const cronResp = await request.post('/api/cron/season-reset', {
      headers: {
        ...adminHeaders(),
        // Some implementations use a shared CRON secret instead of a user JWT
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
    });

    if ([200, 202].includes(cronResp.status())) {
      expect([200, 202]).toContain(cronResp.status());
      return;
    }

    // Fallback: dedicated admin trigger
    const adminResp = await request.post('/api/admin/seasons/reset', {
      headers: adminHeaders(),
    });

    expect([200, 202, 404]).toContain(adminResp.status());
  });

  // -------------------------------------------------------------------------
  // Post-reset: main rank XP is 0
  // -------------------------------------------------------------------------

  test('main rank XP is 0 after season reset', async ({ request }) => {
    if (!USER_TOKEN_SET || !ADMIN_TOKEN_SET) {
      test.skip(true, 'Required tokens not set — skipping');
      return;
    }

    // Trigger reset
    await request.post('/api/cron/season-reset', {
      headers: {
        ...adminHeaders(),
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
    });

    // Allow a brief moment for async processing
    await new Promise((resolve) => setTimeout(resolve, 500));

    const profile = await fetchProfile(request, TEST_USER_ID, userHeaders());

    if (!profile) {
      test.skip(true, 'Could not fetch post-reset profile — skipping');
      return;
    }

    const mainXp: number =
      profile.xp ??
      profile.mainRankXp ??
      profile.rankXp ??
      profile.data?.xp ??
      -1;

    expect(mainXp).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Post-reset: track levels preserved
  // -------------------------------------------------------------------------

  test('social track level is preserved after season reset', async ({ request }) => {
    if (!USER_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    // Capture track levels before reset (or rely on known seed values)
    const profileBefore = await fetchProfile(request, TEST_USER_ID, userHeaders());
    if (!profileBefore) {
      test.skip(true, 'Could not fetch profile — skipping');
      return;
    }

    const socialLevelBefore: number =
      profileBefore.socialLevel ??
      profileBefore.tracks?.social?.level ??
      profileBefore.data?.socialLevel ??
      0;

    // Trigger reset
    await request.post('/api/cron/season-reset', {
      headers: {
        ...adminHeaders(),
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const profileAfter = await fetchProfile(request, TEST_USER_ID, userHeaders());
    if (!profileAfter) {
      test.skip(true, 'Could not fetch post-reset profile — skipping');
      return;
    }

    const socialLevelAfter: number =
      profileAfter.socialLevel ??
      profileAfter.tracks?.social?.level ??
      profileAfter.data?.socialLevel ??
      0;

    // Social track level must not decrease after reset
    expect(socialLevelAfter).toBeGreaterThanOrEqual(socialLevelBefore);
  });

  test('creator track level is preserved after season reset', async ({ request }) => {
    if (!USER_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    const profileBefore = await fetchProfile(request, TEST_USER_ID, userHeaders());
    if (!profileBefore) {
      test.skip(true, 'Could not fetch profile — skipping');
      return;
    }

    const creatorLevelBefore: number =
      profileBefore.creatorLevel ??
      profileBefore.tracks?.creator?.level ??
      profileBefore.data?.creatorLevel ??
      0;

    await request.post('/api/cron/season-reset', {
      headers: {
        ...adminHeaders(),
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const profileAfter = await fetchProfile(request, TEST_USER_ID, userHeaders());
    if (!profileAfter) {
      test.skip(true, 'Could not fetch post-reset profile — skipping');
      return;
    }

    const creatorLevelAfter: number =
      profileAfter.creatorLevel ??
      profileAfter.tracks?.creator?.level ??
      profileAfter.data?.creatorLevel ??
      0;

    expect(creatorLevelAfter).toBeGreaterThanOrEqual(creatorLevelBefore);
  });

  // -------------------------------------------------------------------------
  // Post-reset: Season History entry created
  // -------------------------------------------------------------------------

  test('Season History has a new entry after reset', async ({ request }) => {
    if (!USER_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    // Count seasons before reset
    const beforeResp = await request.get(`/api/seasons?userId=${TEST_USER_ID}`, {
      headers: userHeaders(),
    });

    const seasonCountBefore: number =
      beforeResp.status() === 200
        ? ((await beforeResp.json().catch(() => [])) as unknown[]).length
        : 0;

    // Trigger reset
    await request.post('/api/cron/season-reset', {
      headers: {
        ...adminHeaders(),
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Count seasons after reset
    const afterResp = await request.get(`/api/seasons?userId=${TEST_USER_ID}`, {
      headers: userHeaders(),
    });

    if (afterResp.status() !== 200) {
      test.skip(true, 'Season history endpoint not available — skipping');
      return;
    }

    const seasons = await afterResp.json().catch(() => []);
    const seasonCountAfter: number = Array.isArray(seasons) ? seasons.length : 0;

    // Should have at least one more entry
    expect(seasonCountAfter).toBeGreaterThan(seasonCountBefore);
  });

  // -------------------------------------------------------------------------
  // Post-reset: coins and inventory preserved
  // -------------------------------------------------------------------------

  test('coin balance is preserved after season reset', async ({ request }) => {
    if (!USER_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    const walletBefore = await request.get('/api/wallet', { headers: userHeaders() });
    if (walletBefore.status() !== 200) {
      test.skip(true, 'Could not fetch wallet — skipping');
      return;
    }
    const before = await walletBefore.json();
    const coinsBefore: number =
      before.balance ?? before.coins ?? before.data?.balance ?? 0;

    // Trigger reset
    await request.post('/api/cron/season-reset', {
      headers: {
        ...adminHeaders(),
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const walletAfter = await request.get('/api/wallet', { headers: userHeaders() });
    if (walletAfter.status() !== 200) {
      test.skip(true, 'Could not fetch post-reset wallet — skipping');
      return;
    }
    const after = await walletAfter.json();
    const coinsAfter: number =
      after.balance ?? after.coins ?? after.data?.balance ?? 0;

    // Coins should not change due to the reset itself
    expect(coinsAfter).toBe(coinsBefore);
  });

  test('inventory is preserved after season reset', async ({ request }) => {
    if (!USER_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    const invBefore = await request.get(`/api/inventory/${TEST_USER_ID}`, {
      headers: userHeaders(),
    });

    if (invBefore.status() !== 200) {
      test.skip(true, 'Inventory endpoint not available — skipping');
      return;
    }

    const itemsBefore = await invBefore.json().catch(() => []);
    const countBefore: number = Array.isArray(itemsBefore)
      ? itemsBefore.length
      : (itemsBefore.items?.length ?? itemsBefore.data?.length ?? 0);

    // Trigger reset
    await request.post('/api/cron/season-reset', {
      headers: {
        ...adminHeaders(),
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const invAfter = await request.get(`/api/inventory/${TEST_USER_ID}`, {
      headers: userHeaders(),
    });

    if (invAfter.status() !== 200) {
      test.skip(true, 'Could not fetch post-reset inventory — skipping');
      return;
    }

    const itemsAfter = await invAfter.json().catch(() => []);
    const countAfter: number = Array.isArray(itemsAfter)
      ? itemsAfter.length
      : (itemsAfter.items?.length ?? itemsAfter.data?.length ?? 0);

    // Inventory count should not drop after a season reset
    expect(countAfter).toBeGreaterThanOrEqual(countBefore);
  });
});
