/**
 * E2E tests for the Season Reset flow (PRD "Season Reset").
 *
 * Verifies, against a running server, that ending a season:
 *  - resets competitive (season) rankings: the ended season is no longer the
 *    current season and the user's season XP for it is archived;
 *  - preserves the main rank XP and all track XP / levels (never reset);
 *  - preserves coins and stars (top-10 finishers may only gain coins);
 *  - adds an entry to the user's Season History when they took part.
 *
 * The reset is triggered through the real admin "End season early" endpoint
 * (DELETE /api/admin/seasons/:id), which runs the same end-of-season
 * transition as the daily-platform CRON (lib/seasons/seasonEngine.ts
 * endSeason). If no season is active, a short throwaway season is created
 * first so the flow can always be exercised.
 *
 * Required env (the suite skips without them):
 *   E2E_USER_TOKEN  - access token of a regular test user
 *   E2E_ADMIN_TOKEN - access token of an admin user
 *
 * WARNING: this ends the currently active season on the target server. Run
 * it only against a disposable test/staging database.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const USER_TOKEN = process.env.E2E_USER_TOKEN ?? '';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? '';
const TOKENS_SET = !!USER_TOKEN && !!ADMIN_TOKEN;

const userHeaders = () => ({ Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json' });
const adminHeaders = () => ({ Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' });

const TRACKS = ['social', 'creator', 'competitor', 'generosity', 'knowledge', 'explorer', 'gaming'] as const;

interface Me {
  id: string;
  xp_total: number;
  coin_balance: number;
  star_balance: number;
  [key: string]: unknown;
}

interface Snapshot {
  me: Me;
  currentSeasonId: string | null;
  seasonXp: number | null;
  seasonHistoryIds: string[];
}

async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  const meRes = await request.get('/api/users/me', { headers: userHeaders() });
  expect(meRes.status()).toBe(200);
  const me = ((await meRes.json()) as { user: Me }).user;

  const curRes = await request.get('/api/seasons/current', { headers: userHeaders() });
  let currentSeasonId: string | null = null;
  let seasonXp: number | null = null;
  if (curRes.status() === 200) {
    const body = (await curRes.json()) as {
      data: { season: { id: string }; userPass: { season_xp: number } | null };
    };
    currentSeasonId = body.data.season.id;
    seasonXp = body.data.userPass?.season_xp ?? null;
  } else {
    expect(curRes.status()).toBe(404); // no active season
  }

  const profRes = await request.get(`/api/users/${me.id}/profile`, { headers: userHeaders() });
  expect(profRes.status()).toBe(200);
  const profile = ((await profRes.json()) as { profile: { seasonHistory?: Array<{ id: string }> } }).profile;

  return {
    me,
    currentSeasonId,
    seasonXp,
    seasonHistoryIds: (profile.seasonHistory ?? []).map((s) => s.id),
  };
}

/** Returns the active season id, creating a short throwaway season if none is active. */
async function ensureActiveSeason(request: APIRequestContext): Promise<string> {
  const listRes = await request.get('/api/admin/seasons', { headers: adminHeaders() });
  expect(listRes.status()).toBe(200);
  const list = (await listRes.json()) as { data: { seasons: Array<{ id: string; is_active: boolean }> } };
  const active = list.data.seasons.find((s) => s.is_active);
  if (active) return active.id;

  const now = Date.now();
  const createRes = await request.post('/api/admin/seasons', {
    headers: adminHeaders(),
    data: {
      name: `E2E Season ${now}`,
      theme: 'e2e',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 7 * 24 * 3600_000).toISOString(),
      passPriceCoins: 500,
      rewardPoolCoins: 0,
    },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { data: { season: { id: string } } };
  return created.data.season.id;
}

test.describe('Season reset flow', () => {
  test.describe.configure({ mode: 'serial' });

  let before: Snapshot;
  let after: Snapshot;
  let endedSeasonId: string;
  let endStatus: number;

  test.beforeAll(async ({ request }) => {
    if (!TOKENS_SET) return;
    endedSeasonId = await ensureActiveSeason(request);
    before = await snapshot(request);
    const endRes = await request.delete(`/api/admin/seasons/${endedSeasonId}`, { headers: adminHeaders() });
    endStatus = endRes.status();
    after = await snapshot(request);
  });

  test.beforeEach(() => {
    test.skip(!TOKENS_SET, 'E2E_USER_TOKEN and E2E_ADMIN_TOKEN must be set');
  });

  test('admin "End season early" succeeds', () => {
    expect(endStatus).toBe(200);
  });

  test('ending the same season twice is rejected', async ({ request }) => {
    const res = await request.delete(`/api/admin/seasons/${endedSeasonId}`, { headers: adminHeaders() });
    expect(res.status()).toBe(400);
  });

  test('competitive ranking resets: the ended season is no longer current', () => {
    expect(after.currentSeasonId).not.toBe(endedSeasonId);
  });

  test('main rank XP is preserved', () => {
    expect(Number(after.me.xp_total)).toBeGreaterThanOrEqual(Number(before.me.xp_total));
  });

  test('all track XP and levels are preserved', () => {
    for (const track of TRACKS) {
      expect(Number(after.me[`xp_${track}`])).toBeGreaterThanOrEqual(Number(before.me[`xp_${track}`]));
      expect(Number(after.me[`level_${track}`])).toBeGreaterThanOrEqual(Number(before.me[`level_${track}`]));
    }
  });

  test('coins and stars are preserved', () => {
    // A top-10 finisher may receive reward-pool coins, never lose any.
    expect(Number(after.me.coin_balance)).toBeGreaterThanOrEqual(Number(before.me.coin_balance));
    expect(Number(after.me.star_balance)).toBe(Number(before.me.star_balance));
  });

  test('Season History gains the ended season when the user took part', () => {
    test.skip(
      before.currentSeasonId !== endedSeasonId || before.seasonXp === null,
      'Test user had no pass for the ended season'
    );
    expect(after.seasonHistoryIds).toContain(endedSeasonId);
  });
});
