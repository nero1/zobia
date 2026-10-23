import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup, closeTestPool } from './setup';
jest.mock('@/lib/db/drizzle', () => ({ ...jest.requireActual('@/lib/db/drizzle'), getDb: jest.fn() }));
jest.mock('@/lib/games/config', () => ({ getGamesConfig: jest.fn().mockResolvedValue({ challengeExpiryHours: 48, maxWagerCredits: 1000, wagerRakePct: 0 }) }));
jest.mock('@/lib/manifest', () => ({ getManifestValue: jest.fn().mockResolvedValue('10') }));
jest.mock('@/lib/quests/questEngine', () => ({ triggerActivityQuestProgress: jest.fn().mockResolvedValue(undefined) }));
import { getDb } from '@/lib/db/drizzle';
import { acceptChallenge, cancelChallenge, expireChallenges, getChallengeDetail, archiveChallenge, listUserChallenges } from '@/lib/games/challenges';
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('challenge escrow atomicity', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); const users: string[] = []; let gameId: string;
  beforeAll(async () => {
    if (!await integrationSetup()) throw new Error('Integration database unavailable');
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
    gameId = (await pool.query('SELECT id FROM games LIMIT 1')).rows[0].id;
    process.env.GAME_RESULT_WEBHOOK_SECRET='trusted-result-provider-fixture-secret-long-enough';
    await pool.query("UPDATE games SET score_verification='server' WHERE id=$1",[gameId]);
  });
  afterAll(async () => { await pool.query("UPDATE games SET score_verification='practice' WHERE id=$1",[gameId]);delete process.env.GAME_RESULT_WEBHOOK_SECRET;for (const id of users) await pool.query('DELETE FROM users WHERE id=$1', [id]); await pool.end(); await closeTestPool(); });
  async function account(balance: number) { const client = await pool.connect(); try { const u = await createUser(client, { coinBalance: balance }); users.push(u.id); return u.id; } finally { client.release(); } }
  async function invite(challenger: string, opponent: string, expired = false) {
    const { rows } = await pool.query("INSERT INTO game_challenges(game_id,challenger_id,opponent_id,wager_credits,expires_at) VALUES($1,$2,$3,10,now()+($4 * interval '1 hour')) RETURNING id", [gameId, challenger, opponent, expired ? -1 : 48]); return rows[0].id;
  }
  async function balances(a: string, b: string) { return (await pool.query('SELECT id,coin_balance FROM users WHERE id=ANY($1::uuid[])', [[a,b]])).rows.map((row) => Number(row.coin_balance)).sort((x,y) => x-y); }
  it('rolls back the first debit if the second participant cannot afford the stake', async () => {
    const a = await account(100); const b = await account(0); const id = await invite(a,b);
    await expect(acceptChallenge(id,b)).rejects.toThrow();
    expect(await balances(a,b)).toEqual([0,100]);
    expect((await pool.query('SELECT status,escrow_credits FROM game_challenges WHERE id=$1', [id])).rows[0]).toMatchObject({ status: 'pending', escrow_credits: 0 });
    expect((await pool.query('SELECT count(*)::int AS n FROM coin_ledger WHERE user_id=ANY($1::uuid[])', [[a,b]])).rows[0].n).toBe(0);
  });
  it('accepts only once concurrently and refunds both players atomically when cancelled', async () => {
    const a = await account(100); const b = await account(100); const id = await invite(a,b);
    const results = await Promise.allSettled([acceptChallenge(id,b), acceptChallenge(id,b)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await balances(a,b)).toEqual([90,90]);
    await cancelChallenge(id,a);
    expect(await balances(a,b)).toEqual([100,100]);
    expect((await pool.query('SELECT escrow_credits FROM game_challenges WHERE id=$1', [id])).rows[0].escrow_credits).toBe(0);
  });
  it('rejects and labels expired invitations without waiting for the cron', async () => {
    const a = await account(100); const b = await account(100); const id = await invite(a,b,true);
    await expect(acceptChallenge(id,b)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await getChallengeDetail(id,a)).status).toBe('expired');
    expect(await balances(a,b)).toEqual([100,100]);
  });
  it('repeated expiry sweeps never refund escrow twice', async () => {
    const a = await account(100); const b = await account(100); const id = await invite(a,b);
    await acceptChallenge(id,b); await pool.query("UPDATE game_challenges SET expires_at=now()-interval '1 hour' WHERE id=$1", [id]);
    await expireChallenges(); await expireChallenges();
    expect(await balances(a,b)).toEqual([100,100]);
    expect((await pool.query('SELECT status,escrow_credits FROM game_challenges WHERE id=$1', [id])).rows[0]).toMatchObject({ status: 'expired', escrow_credits: 0 });
  });
  it('archives only the requesting participant’s copy', async()=>{
    const a=await account(100);const b=await account(100);const id=await invite(a,b);
    await pool.query("UPDATE game_challenges SET status='completed' WHERE id=$1",[id]);
    await archiveChallenge(id,a);
    expect((await listUserChallenges(a,null,20,false,'completed')).challenges).toHaveLength(0);
    expect((await listUserChallenges(a,null,20,false,'archived')).challenges.map((c)=>c.id)).toContain(id);
    expect((await listUserChallenges(b,null,20,false,'completed')).challenges.map((c)=>c.id)).toContain(id);
    expect((await getChallengeDetail(id,b)).archivedAt).toBeNull();
  });
  it('keeps microsecond precision between pages',async()=>{
    const a=await account(100);const b=await account(100);
    for(let n=0;n<5;n++){const id=await invite(a,b);await pool.query("UPDATE game_challenges SET created_at='2026-01-01T00:00:00.123000Z'::timestamptz+($2*interval '1 microsecond') WHERE id=$1",[id,n]);}
    const ids:string[]=[];let cursor:string|null=null;
    do {const page=await listUserChallenges(a,cursor,2);ids.push(...page.challenges.map((c)=>c.id));cursor=page.nextCursor;}while(cursor);
    expect(ids).toHaveLength(5);expect(new Set(ids).size).toBe(5);
  });

});
