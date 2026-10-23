import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup,closeTestPool } from './setup';
import { removeReportedContent } from '@/lib/moderation/removeReportedContent';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('moderation report content removal',()=>{
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});let user:string;
 beforeAll(async()=>{if(!await integrationSetup())throw new Error('Integration database unavailable');const client=await pool.connect();try{user=(await createUser(client)).id;}finally{client.release();}});
 afterAll(async()=>{if(user)await pool.query('DELETE FROM users WHERE id=$1',[user]);await pool.end();await closeTestPool();});
 it('removes a reported answer and rejects a reported story rather than merely resolving the report',async()=>{
  const question=(await pool.query("INSERT INTO forum_questions(author_id,title,body) VALUES($1,'Question','Body') RETURNING id",[user])).rows[0].id;const answer=(await pool.query("INSERT INTO forum_answers(author_id,question_id,body) VALUES($1,$2,'Answer') RETURNING id",[user,question])).rows[0].id;const tale=(await pool.query("INSERT INTO tales(author_id,title,slug,status,moderation) VALUES($1,'Story',$2,'published','approved') RETURNING id",[user,randomUUID()])).rows[0].id;
  const db=drizzle(pool,{schema});await db.transaction(tx=>removeReportedContent(tx,{reported_forum_answer_id:answer},user));await db.transaction(tx=>removeReportedContent(tx,{reported_tale_id:tale},user,'Content removed after report review.'));
  expect((await pool.query('SELECT deleted_at FROM forum_answers WHERE id=$1',[answer])).rows[0].deleted_at).not.toBeNull();expect((await pool.query('SELECT moderation FROM tales WHERE id=$1',[tale])).rows[0].moderation).toBe('rejected');
 });
 it('refuses content removal when a report has no content target',async()=>{const db=drizzle(pool,{schema});await expect(db.transaction(tx=>removeReportedContent(tx,{},user))).rejects.toMatchObject({code:'BAD_REQUEST'});});
});
