import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup, closeTestPool } from './setup';

jest.mock('@/lib/db/drizzle', () => ({ ...jest.requireActual('@/lib/db/drizzle'), getDb: jest.fn() }));
jest.mock('@/lib/help/service', () => ({ askAi: jest.fn() }));
jest.mock('@/lib/manifest', () => ({ getManifestValue: jest.fn() }));

import { getDb } from '@/lib/db/drizzle';
import { askAi } from '@/lib/help/service';
import { getManifestValue } from '@/lib/manifest';
import { askWithQuota, helpWeek } from '@/lib/help/quota';

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('help AI accounting against PostgreSQL', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const users: string[] = [];
  beforeAll(async () => {
    if (!await integrationSetup()) throw new Error('Integration database unavailable');
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
    (getManifestValue as jest.Mock).mockImplementation(async (key: string) => key.startsWith('help_ai_weekly_limit_') ? '1' : '5');
  });
  afterAll(async () => {
    for (const id of users) await pool.query('DELETE FROM users WHERE id = $1', [id]);
    await pool.end(); await closeTestPool();
  });
  async function user() {
    const client = await pool.connect();
    try { const created = await createUser(client, { coinBalance: 100 }); users.push(created.id); return created.id; }
    finally { client.release(); }
  }
  const question = (userId: string, confirmPaid = false) => ({ userId, confirmPaid, confirmedCost: confirmPaid ? 5 : undefined, requestId: randomUUID(), question: 'How do I use the wallet?' });
  it('starts the week at Monday 00:00 UTC, including Sunday and year boundaries', () => {
    expect(helpWeek(new Date('2027-01-03T23:59:59Z')).startsAt.toISOString()).toBe('2026-12-28T00:00:00.000Z');
    expect(helpWeek(new Date('2027-01-04T00:00:00Z')).resetsAt.toISOString()).toBe('2027-01-11T00:00:00.000Z');
  });
  it('requires explicit payment, charges once on retry, and returns the stored answer', async () => {
    const id = await user(); (askAi as jest.Mock).mockResolvedValue('Read your wallet history.');
    await askWithQuota(question(id));
    await expect(askWithQuota(question(id))).rejects.toMatchObject({ code: 'HELP_AI_WEEKLY_LIMIT' });
    const paid = question(id, true);
    const first = await askWithQuota(paid); const retry = await askWithQuota(paid);
    expect(retry.answer).toBe(first.answer);
    expect((await pool.query('SELECT coin_balance FROM users WHERE id=$1', [id])).rows[0].coin_balance).toBe(95);
    expect((await pool.query("SELECT count(*)::int AS n FROM coin_ledger WHERE user_id=$1 AND reference_id LIKE 'help-ai:%'", [id])).rows[0].n).toBe(1);
  });
  it('refunds failed paid answers and does not consume a free question on failure', async () => {
    const id = await user(); (askAi as jest.Mock).mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(askWithQuota(question(id))).rejects.toThrow('Provider unavailable');
    (askAi as jest.Mock).mockResolvedValueOnce('Included answer.');
    expect((await askWithQuota(question(id))).usage.cost).toBe(0);
    (askAi as jest.Mock).mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(askWithQuota(question(id, true))).rejects.toThrow('Provider unavailable');
    expect((await pool.query('SELECT coin_balance FROM users WHERE id=$1', [id])).rows[0].coin_balance).toBe(100);
  });
  it('serializes simultaneous free questions so only one claims the final allowance', async () => {
    const id = await user(); (askAi as jest.Mock).mockResolvedValue('Answer.');
    const results = await Promise.allSettled([askWithQuota(question(id)), askWithQuota(question(id))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});
