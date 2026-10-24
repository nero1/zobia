import assert from 'node:assert/strict';
import {Client} from 'pg';
import {upsertGoogleUser} from '../lib/auth/googleAccount';
async function main(){
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL??'postgresql://invalid/').pathname))throw Error('Disposable remediation database required');
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  let sequence=0;const prefix='oauth_'+crypto.randomUUID().replaceAll('-','').slice(0,12);
  const seed=async(verified:boolean,google=true)=>{const username=prefix+'_'+sequence++,email=username+'@security.invalid',googleId=google?username:null;const row=(await db.query('INSERT INTO users(username,email,display_name,is_email_verified,google_id) VALUES($1,$2,$1,$3,$4) RETURNING id',[username,email,verified,googleId])).rows[0];return {id:row.id,email,googleId:googleId??username,name:username,picture:'https://fixture.invalid/avatar.png'};};
  const old=await seed(true);await db.query("UPDATE users SET deleted_at=NOW()-INTERVAL '31 days' WHERE id=$1",[old.id]);await assert.rejects(upsertGoogleUser(old),/restoration period has ended/);
  assert.ok((await db.query('SELECT deleted_at FROM users WHERE id=$1',[old.id])).rows[0].deleted_at);
  const recent=await seed(true);await db.query("UPDATE users SET deleted_at=NOW()-INTERVAL '1 day' WHERE id=$1",[recent.id]);assert.equal((await upsertGoogleUser(recent)).id,recent.id);assert.equal((await db.query('SELECT deleted_at FROM users WHERE id=$1',[recent.id])).rows[0].deleted_at,null);
  const expired=await seed(true);await db.query("UPDATE users SET is_suspended=true,suspended_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[expired.id]);assert.equal((await upsertGoogleUser(expired)).id,expired.id);
  const active=await seed(true);await db.query("UPDATE users SET is_suspended=true,suspended_until=NOW()+INTERVAL '1 day' WHERE id=$1",[active.id]);await assert.rejects(upsertGoogleUser(active),error=>(error as {code:string}).code==='ACCOUNT_SUSPENDED');
  console.log('PASS Google login enforces restoration deadline, restores eligible accounts and distinguishes expired from active suspensions');
  const unverified=await seed(false,false);await assert.rejects(upsertGoogleUser(unverified),error=>(error as {code:string}).code==='ACCOUNT_LINK_REQUIRED');assert.equal((await db.query('SELECT google_id FROM users WHERE id=$1',[unverified.id])).rows[0].google_id,null);
  const linked=await seed(true);await assert.rejects(upsertGoogleUser({...linked,googleId:linked.googleId+'_different'}),error=>(error as {code:string}).code==='ACCOUNT_LINK_REQUIRED');
  const attach=await seed(true,false);
  const attempts=await Promise.allSettled([upsertGoogleUser(attach),upsertGoogleUser({...attach,googleId:attach.googleId+'_different'})]);
  assert.equal(attempts.filter(row=>row.status==='fulfilled').length,1);
  const newProfile={googleId:prefix+'_brandnew',email:prefix+'_new@security.invalid',name:'New fixture',picture:'https://fixture.invalid/avatar.png'};
  const created=await Promise.all([upsertGoogleUser(newProfile),upsertGoogleUser(newProfile)]);assert.equal(created[0].id,created[1].id);
  console.log('PASS Google account ownership rejects unverified/different identities, serializes linking and safely recovers same-subject signup races');
 }finally{await db.end();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.cause?.message??error.message);process.exit(1);});
