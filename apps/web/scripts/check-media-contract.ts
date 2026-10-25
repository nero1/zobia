import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {uploadPublicMedia,queueExpiredPublicMedia,PUBLIC_MEDIA_MAX_BYTES,PUBLIC_MEDIA_MAX_OBJECTS,PUBLIC_MEDIA_MAX_DRAFTS} from '../lib/storage/publicMedia';
import {drainObjectDeletions} from '../lib/storage/deletionQueue';
import type {StorageAdapter} from '../lib/storage/interface';
async function main(){
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname))throw Error('Isolated fixture only');
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const objects=new Set<string>(),deleted:string[]=[];
 let failUpload=false,failDelete=false;
 const adapter:StorageAdapter={getPublicUrl:key=>'https://media.fixture.invalid/'+key,upload:async(key,buffer,options)=>{objects.add(key);if(failUpload)throw Error('Lost acknowledgement');return {key,publicUrl:adapter.getPublicUrl(key),size:buffer.length,contentType:options?.contentType!};},delete:async key=>{if(failDelete)throw Error('Temporary storage failure');objects.delete(key);deleted.push(key);},deleteMany:async()=>{},getSignedUrl:async()=>'',exists:async key=>objects.has(key)};
 const name='media_'+randomUUID().replaceAll('-','');const user=(await db.query('INSERT INTO users(username,display_name) VALUES($1,$1) RETURNING id',[name])).rows[0].id;
 const upload=()=>{const key=`tweets/${user}/${randomUUID()}.webp`;return uploadPublicMedia(user,key,Buffer.from('normalized image fixture'),{contentType:'image/webp'},adapter);};
 const count=async()=>Number((await db.query('SELECT COUNT(*)::int n FROM public_media_references')).rows[0].n);
 try{
  const first=await upload();const tweet=(await db.query('INSERT INTO tweets(user_id,image_url) VALUES($1,$2) RETURNING id',[user,first.publicUrl])).rows[0].id;assert.equal(await count(),1);
  await db.query("UPDATE public_media_assets SET created_at=NOW()-INTERVAL '3 days' WHERE user_id=$1",[user]);assert.equal(await queueExpiredPublicMedia(),0);assert.equal(deleted.length,0);
  const copy=(await db.query('INSERT INTO tweets(user_id,image_url) VALUES($1,$2) RETURNING id',[user,first.publicUrl])).rows[0].id;await db.query('UPDATE tweets SET image_url=NULL,content=$2 WHERE id=$1',[tweet,'image replaced']);assert.equal(await count(),1);
  await db.query('UPDATE tweets SET deleted_at=NOW() WHERE id=$1',[copy]);assert.equal(await count(),0);assert((await db.query('SELECT unreferenced_at FROM public_media_assets WHERE storage_key=$1',[first.key])).rows[0].unreferenced_at);
  await db.query("UPDATE public_media_assets SET unreferenced_at=NOW()-INTERVAL '25 hours' WHERE storage_key=$1",[first.key]);assert.equal(await queueExpiredPublicMedia(),1);
  await assert.rejects(db.query('INSERT INTO tweets(user_id,image_url) VALUES($1,$2)',[user,first.publicUrl]),error=>(error as {code?:string}).code==='23514');
  failDelete=true;await drainObjectDeletions(adapter);assert(objects.has(first.key));assert.equal((await db.query('SELECT state FROM public_media_assets WHERE storage_key=$1',[first.key])).rows[0].state,'deleting');
  failDelete=false;await db.query('UPDATE object_deletion_tasks SET available_at=NOW() WHERE storage_key=$1',[first.key]);await drainObjectDeletions(adapter);assert(!objects.has(first.key));assert.equal((await db.query('SELECT COUNT(*)::int n FROM public_media_assets WHERE storage_key=$1',[first.key])).rows[0].n,0);await drainObjectDeletions(adapter);assert.equal(deleted.filter(key=>key===first.key).length,1);
  console.log('PASS durable media references survive replacements/copies, soft deletion releases the last reference, claimed deletion rejects reattachment and storage failure retries safely');
  failUpload=true;await assert.rejects(upload());failUpload=false;const pending=(await db.query("SELECT storage_key FROM public_media_assets WHERE user_id=$1 AND state='pending'",[user])).rows[0].storage_key;assert(objects.has(pending));await db.query("UPDATE public_media_assets SET unreferenced_at=NOW()-INTERVAL '25 hours' WHERE storage_key=$1",[pending]);await drainObjectDeletions(adapter);assert(!objects.has(pending));
  const image=await upload();const moment=(await db.query("INSERT INTO moments(user_id,content,content_type,media_url,expires_at) VALUES($1,'Moment','image',$2,NOW()-INTERVAL '1 minute') RETURNING id",[user,image.publicUrl])).rows[0].id;
  await queueExpiredPublicMedia();assert.equal(await count(),0);assert.equal(deleted.includes(image.key),false);await db.query("UPDATE public_media_assets SET unreferenced_at=NOW()-INTERVAL '25 hours' WHERE storage_key=$1",[image.key]);await drainObjectDeletions(adapter);assert(!objects.has(image.key));await db.query('DELETE FROM moments WHERE id=$1',[moment]);
  const avatar=await upload();await db.query('UPDATE users SET avatar_url=$2 WHERE id=$1',[user,avatar.publicUrl]);assert.equal(await count(),1);await db.query('UPDATE users SET coin_balance=coin_balance+1 WHERE id=$1',[user]);assert.equal(await count(),1);await db.query('UPDATE users SET avatar_url=NULL WHERE id=$1',[user]);assert.equal(await count(),0);
  const embedded=await upload();
  const tale=(await db.query("INSERT INTO tales(author_id,slug,title,cover_url) VALUES($1,$2,'Media fixture',$3) RETURNING id",[user,'tale-'+randomUUID(),embedded.publicUrl])).rows[0].id;
  const blog=(await db.query("INSERT INTO blogs(owner_id,slug,title) VALUES($1,$2,'Media fixture') RETURNING id",[user,'blog-'+randomUUID()])).rows[0].id;
  const post=(await db.query("INSERT INTO blog_posts(blog_id,author_id,title,slug,body_markdown,body_html) VALUES($1,$2,'Media fixture',$3,$4,$5) RETURNING id",[blog,user,'post-'+randomUUID(),`![image](${embedded.publicUrl})`,`<img src="${embedded.publicUrl}">`])).rows[0].id;
  const board=(await db.query('SELECT id FROM bb_boards LIMIT 1')).rows[0].id;
  const thread=(await db.query("INSERT INTO bb_threads(board_id,author_id,title,slug,image_url) VALUES($1,$2,'Media fixture',$3,$4) RETURNING id",[board,user,'thread-'+randomUUID(),embedded.publicUrl])).rows[0].id;
  await db.query("INSERT INTO bb_posts(thread_id,author_id,body,image_url) VALUES($1,$2,'Media fixture',$3)",[thread,user,embedded.publicUrl]);assert.equal(await count(),4);
  await db.query('DELETE FROM tales WHERE id=$1',[tale]);await db.query('UPDATE blog_posts SET deleted_at=NOW() WHERE id=$1',[post]);await db.query('DELETE FROM bb_threads WHERE id=$1',[thread]);assert.equal(await count(),0);
  console.log('PASS lost upload acknowledgements retain cleanup reservations; Moment expiry and avatar replacements release references with a 24-hour grace period');
  await db.query('DELETE FROM public_media_assets WHERE user_id=$1',[user]);
  const quota=async(n:number,bytes:number,pending:boolean)=>{await db.query('DELETE FROM public_media_assets WHERE user_id=$1',[user]);await db.query("INSERT INTO public_media_assets(user_id,storage_key,public_url,size_bytes,content_type,state,unreferenced_at) SELECT $1::uuid,'quota/'||$1::text||'/'||g,'https://media.fixture.invalid/quota/'||$1::text||'/'||g,$2,'image/webp','ready',CASE WHEN $3 THEN NOW() ELSE NULL END FROM generate_series(1,$4::int) g",[user,bytes,pending,n]);};
  await quota(1,PUBLIC_MEDIA_MAX_BYTES,false);await assert.rejects(upload(),error=>(error as {code?:string}).code==='MEDIA_QUOTA_REACHED');
  await quota(PUBLIC_MEDIA_MAX_OBJECTS,1,false);await assert.rejects(upload(),error=>(error as {code?:string}).code==='MEDIA_QUOTA_REACHED');
  await quota(PUBLIC_MEDIA_MAX_DRAFTS-1,1,true);const race=await Promise.allSettled([upload(),upload()]);assert.equal(race.filter(item=>item.status==='fulfilled').length,1);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM public_media_assets WHERE user_id=$1',[user])).rows[0].n,PUBLIC_MEDIA_MAX_DRAFTS);
  console.log('PASS durable byte/object/draft quotas reject overflow and concurrent uploads cannot overrun the final reservation');
  await db.query('DELETE FROM public_media_assets WHERE user_id=$1',[user]);
  await db.query("INSERT INTO public_media_assets(user_id,storage_key,public_url,size_bytes,content_type,state,unreferenced_at) SELECT $1::uuid,'backlog/'||$1::text||'/'||g,'https://media.fixture.invalid/backlog/'||$1::text||'/'||g,1,'image/webp','pending',NOW()-INTERVAL '25 hours' FROM generate_series(1,80) g",[user]);
  const continued=await drainObjectDeletions(adapter,'fixture-backlog');assert.equal(continued.continued,true);assert.equal((await db.query("SELECT COUNT(*)::int n FROM transactional_tasks WHERE kind='storage_maintenance' AND operation_key='storage-maintenance:fixture-backlog'")).rows[0].n,1);
  await drainObjectDeletions(adapter,'fixture-backlog');assert.equal((await db.query('SELECT COUNT(*)::int n FROM public_media_assets WHERE user_id=$1',[user])).rows[0].n,0);
  console.log('PASS more than one deletion batch records a durable continuation and successive bounded passes drain the backlog');

 }finally{await db.end();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack);process.exit(1);});
