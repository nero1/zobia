import {QUEST_ACTION_TYPES} from "@zobia/shared/utils";
/** Execute the exact SQL Editor seed against disposable local PostgreSQL databases. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const seed = readFileSync(resolve(root, 'db/seed.sql'), 'utf8');
const baseline = readFileSync(resolve(root, 'db/migrations/0001_consolidated_schema.sql'), 'utf8');
const email = 'starter-fixture@example.invalid';
const configured = seed.replaceAll('REPLACE_WITH_YOUR_ADMIN_EMAIL', email);
const records = [...seed.matchAll(/INSERT INTO public\.(\w+) [\s\S]*?\n  VALUES \('([0-9a-f-]{36})'/g)]
  .map(match => ({ table: match[1], id: match[2] }));
const tables = [...new Set(records.map(row => row.table))];
const url = new URL(process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://zobia@127.0.0.1:5432/postgres');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/postgres') throw Error('Local disposable fixture control database required');
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
async function snapshot(db: Client) {
  const data: Record<string, unknown> = {};
  for (const table of [...tables, 'users']) {
    data[table] = (await db.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) data FROM public.${quote(table)} t`)).rows[0].data;
  }
  return data;
}
async function rejected(db: Client, text: string, message: RegExp) {
  await assert.rejects(db.query(text), error => message.test((error as Error).message));
  await db.query('ROLLBACK');
}
async function provision(db: Client, business = false) {
  const id = (await db.query(`INSERT INTO users(username,display_name,email,is_admin,is_email_verified,coin_balance)
    VALUES('starter_fixture','Fixture owner',$1,true,true,12345) RETURNING id`, [email])).rows[0].id as string;
  if (business) await db.query("INSERT INTO business_accounts(user_id,business_name,status) VALUES($1,'Fixture business','active')", [id]);
  return id;
}
async function main() {
  assert.ok(records.length >= 250 && tables.length >= 50, 'seed inventory must cover the broad content library');
  const control = new Client({ connectionString: url.href }); await control.connect();
  const names: string[] = []; const clients: Client[] = [];
  async function fixture() {
    const name = 'zobia_starter_' + randomUUID().replaceAll('-', '');
    await control.query(`CREATE DATABASE ${quote(name)}`); names.push(name);
    const target = new URL(url); target.pathname = '/' + name;
    const db = new Client({ connectionString: target.href }); await db.connect(); clients.push(db);
    await db.query(baseline); return { db, target };
  }
  try {
    const { db, target } = await fixture();
    const empty = await snapshot(db);
    await rejected(db, seed, /Edit owner_email/);
    await rejected(db, configured, /Exactly one active verified administrator/);
    assert.deepEqual(await snapshot(db), empty, 'failed preflight must not create any content or accounts');
    const owner = await provision(db, true);
    for (const state of ["is_admin=false", "is_email_verified=false", "is_banned=true", "is_suspended=true", "deleted_at=now()"] ) {
      await db.query(`UPDATE users SET ${state} WHERE id=$1`, [owner]);
      const before = await snapshot(db);
      await rejected(db, configured, /Exactly one active verified administrator/);
      assert.deepEqual(await snapshot(db), before);
      await db.query('UPDATE users SET is_admin=true,is_email_verified=true,is_banned=false,is_suspended=false,deleted_at=NULL WHERE id=$1', [owner]);
    }
    // A late unique-name collision must roll back earlier feed and room inserts.
    await db.query("INSERT INTO blogs(owner_id,slug,title) VALUES($1,'starter-journal','Existing real blog')", [owner]);
    const collision = await snapshot(db);
    await rejected(db, configured, /Starter blogs conflicts/);
    assert.deepEqual(await snapshot(db), collision);
    await db.query("DELETE FROM blogs WHERE slug='starter-journal'");
    await db.query(configured);
    for (const table of tables) {
      const ids = records.filter(row => row.table === table).map(row => row.id);
      const count = (await db.query(`SELECT count(*)::int n FROM public.${quote(table)} WHERE id=ANY($1::uuid[])`, [ids])).rows[0].n;
      assert.equal(count, ids.length, `missing seeded content in ${table}`);
    }
    for (const [table, counter, child, foreign, predicate] of [
      ['rooms','member_count','room_members','room_id','left_at IS NULL'],
      ['rooms','total_messages','room_messages','room_id','is_deleted=false'],
      ['group_chats','member_count','group_chat_members','group_chat_id','true'],
      ['guilds','member_count','guild_members','guild_id','left_at IS NULL'],
      ['blogs','post_count','blog_posts','blog_id','deleted_at IS NULL'],
      ['blog_posts','comment_count','blog_post_comments','post_id',"deleted_at IS NULL AND status='visible'"],
      ['forum_questions','answer_count','forum_answers','question_id',"status='visible'"],
      ['classroom_posts','comment_count','classroom_post_comments','post_id','deleted_at IS NULL AND is_hidden=false'],
      ['wikis','page_count','wiki_pages','wiki_id','deleted_at IS NULL'],
    ]) {
      const ids = records.filter(row => row.table === table).map(row => row.id);
      const mismatches = (await db.query(`SELECT count(*)::int n FROM public.${quote(table)} parent WHERE parent.id=ANY($1::uuid[]) AND parent.${counter}<>(SELECT count(*) FROM public.${quote(child)} WHERE ${foreign}=parent.id AND ${predicate})`, [ids])).rows[0].n;
      assert.equal(mismatches, 0, `inconsistent ${table}.${counter}`);
    }
    const baselineQuests = (baseline.match(/INSERT INTO public\.quest_templates /g) ?? []).length;
    const quests = await db.query("SELECT * FROM quest_templates WHERE title LIKE 'Starter: %'");
    assert.equal(quests.rowCount, 80); assert.equal(baselineQuests, 26);
    const actions=[...QUEST_ACTION_TYPES];
    assert.deepEqual([...new Set(quests.rows.map(row => row.action_type))].sort(), [...actions].sort());
    for (const quest of quests.rows) {
      assert.equal(quest.coin_reward, 0);
      assert.equal(quest.is_active, !['game_play', 'challenge_win'].includes(quest.action_type));
      if (quest.action_type === 'xp_meta') assert.equal(quest.xp_reward, 0);
      if (quest.action_type === 'login_streak') assert.equal(quest.target_count, 1);
    }
    for (const table of ['payments','coin_ledger','star_ledger','xp_ledger','subscriptions','merch_orders','referrals','notifications','transactional_tasks','user_quest_decks','user_quest_progress']) {
      assert.equal((await db.query(`SELECT count(*)::int n FROM public.${quote(table)}`)).rows[0].n, 0, `seed manufactured ${table}`);
    }
    const user = (await db.query('SELECT * FROM users WHERE id=$1', [owner])).rows[0];
    assert.equal(user.coin_balance, '12345'); assert.equal(user.plan, 'free');
    assert.equal((await db.query('SELECT count(*)::int n FROM users')).rows[0].n, 1);
    for (const table of ['forum_questions','forum_answers','poll_options','platform_council_ideas']) {
      const column = table === 'poll_options' ? 'vote_count' : table === 'platform_council_ideas' ? 'votes' : 'vote_score';
      assert.equal((await db.query(`SELECT count(*)::int n FROM public.${table} WHERE ${column}<>0`)).rows[0].n, 0);
    }
    assert.equal((await db.query('SELECT count(*)::int n FROM seasons WHERE is_active')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM platform_events WHERE is_active AND name LIKE \'Starter Draft%\'')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_campaigns WHERE status<>\'draft\' OR spent_credits<>0')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM sponsored_quests WHERE is_active OR total_budget_credits<>0 OR is_daily_quest_eligible')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM merch_products WHERE is_active')).rows[0].n, 0);
    // Preserve real edits, disabled content and original schedules on rerun.
    await db.query("UPDATE blog_posts SET title='Owner edited this' WHERE slug='starter-welcome'");
    await db.query("UPDATE announcement_banners SET is_active=false WHERE title='Welcome to Zobia'");
    await db.query("UPDATE moments SET expires_at=now()-interval '1 hour'");
    await db.query("UPDATE forum_questions SET deleted_at=now() WHERE slug='starter-welcome-question'");
    const edited = await snapshot(db);
    await db.query(configured);
    assert.deepEqual(await snapshot(db), edited);
    // Concurrent invocations serialize safely at the database, without duplicates.
    const other = new Client({ connectionString: target.href }); await other.connect(); clients.push(other);
    await Promise.all([db.query(configured), other.query(configured)]);
    assert.deepEqual(await snapshot(db), edited);
    // The optional runner path must execute this same seed, not a second implementation.
    const fixtureEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', DIRECT_URL: target.href, DATABASE_URL: target.href, SEED_OWNER_EMAIL: email };
    execFileSync(process.execPath, [resolve(root, '../../node_modules/tsx/dist/cli.mjs'), resolve(root, 'db/migrate.ts'), '--adopt-baseline', '--seed'], {
      cwd: root, stdio: 'pipe', env: fixtureEnv,
    });
    execFileSync('npm', ['run', 'seed'], { cwd: resolve(root, '../..'), stdio: 'pipe', env: fixtureEnv });
    assert.deepEqual(await snapshot(db), edited);
    const { db: minimal } = await fixture();
    const minimalOwner = await provision(minimal);
    await minimal.query("INSERT INTO guilds(name,captain_id) VALUES('Existing guild',$1)", [minimalOwner]);
    const realGuild = (await minimal.query("SELECT id FROM guilds WHERE name='Existing guild'")).rows[0].id;
    await minimal.query('INSERT INTO guild_members(guild_id,user_id,role) VALUES($1,$2,\'captain\')', [realGuild, minimalOwner]);
    await minimal.query('UPDATE users SET guild_id=$1 WHERE id=$2', [realGuild,minimalOwner]);
    await minimal.query("INSERT INTO merch_stores(creator_id,name,is_active) VALUES($1,'Existing store',true)", [minimalOwner]);
    await minimal.query(configured);
    assert.equal((await minimal.query('SELECT count(*)::int n FROM business_accounts')).rows[0].n, 0);
    assert.equal((await minimal.query('SELECT count(*)::int n FROM business_pages')).rows[0].n, 0);
    assert.equal((await minimal.query('SELECT count(*)::int n FROM guilds')).rows[0].n, 1);
    assert.equal((await minimal.query('SELECT guild_id FROM users WHERE id=$1', [minimalOwner])).rows[0].guild_id, realGuild);
    assert.equal((await minimal.query('SELECT count(*)::int n FROM merch_stores')).rows[0].n, 1);
    assert.equal((await minimal.query('SELECT count(*)::int n FROM merch_products')).rows[0].n, 0);
    console.log(`PASS SQL Editor and runner seeding: ${records.length} rows/${tables.length} tables, 80 wired quests, safe prerequisites/skips, exact edited-data/concurrent reruns, late-error rollback and no manufactured accounts, money or activity`);
  } finally {
    await Promise.allSettled(clients.map(db => db.end()));
    for (const name of names.reverse()) await control.query(`DROP DATABASE ${quote(name)} WITH(FORCE)`);
    await control.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
