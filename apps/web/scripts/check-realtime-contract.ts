import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {NextRequest} from 'next/server';
import {GET as ably} from '../app/api/realtime/ably-token/route';
import {POST as pusher} from '../app/api/realtime/pusher-auth/route';
import {GET as events} from '../app/api/realtime/events/route';
import {prepareRealtimeEvent} from '../lib/realtime/protectedEvents';
import {createSession,invalidateAllSessions,invalidateSession} from '../lib/auth/session';
import {signAccessToken,verifyAccessToken} from '../lib/auth/jwt';
import {redis} from '../lib/redis';
async function main(){
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL??'postgresql://invalid/').pathname))throw Error('Disposable remediation database required');
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const tag=randomUUID().replaceAll('-','').slice(0,14),users:string[]=[],rooms:string[]=[],groups:string[]=[],eventIds:string[]=[];
 try{
  const accounts=(await db.query("INSERT INTO users(username,display_name) VALUES($1,'Owner'),($2,'Member') RETURNING id,username,email,is_admin",['rt_owner_'+tag,'rt_member_'+tag])).rows;
  users.push(...accounts.map(row=>row.id));const [owner,member]=accounts;
  const ownerSession=await createSession(owner),memberSession=await createSession(member);
  let sequence=0;
  const req=(path:string,token:string,init:NonNullable<ConstructorParameters<typeof NextRequest>[1]>={})=>{const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+token);headers.set('x-real-ip',`198.22.${parseInt(tag.slice(0,2),16)}.${++sequence}`);return new NextRequest('http://localhost:3000'+path,{...init,headers});};
  const signAbly=(token:string,channel:string)=>ably(req('/api/realtime/ably-token?'+new URLSearchParams({channels:channel}),token));
  const signPusher=(token:string,channel:string)=>pusher(req('/api/realtime/pusher-auth',token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({socket_id:'123.456',channel_name:channel.replace(/^dm:conversation:/,'private-dm-conversation-').replace(/^room:/,'private-room-').replace(/^group:/,'private-group-').replace(/^user:/,'private-user-').replace(/:messages$/,'-messages')})}));
  const prepare=async(channel:string)=>{
   const prepared=await prepareRealtimeEvent(channel,'new_message',{content:'PRIVATE_REALTIME_MARKER',userId:owner.id});
   assert.equal(prepared.event,'sync');assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE_REALTIME_MARKER/);
   const id=(prepared.data as {eventId:string}).eventId;eventIds.push(id);return id;
  };
  const read=(token:string,id:string)=>events(req('/api/realtime/events?'+new URLSearchParams({ids:id}),token));
  const ownChannel='user:'+owner.id,ownEvent=await prepare(ownChannel);
  const signed=await signAbly(ownerSession.accessToken,ownChannel);assert.equal(signed.status,200);
  const tokenRequest=await signed.json();assert.ok(tokenRequest.ttl>0 && tokenRequest.ttl<=300000);assert.match(tokenRequest.nonce,/^[a-f0-9]{32}$/);
  assert.deepEqual(JSON.parse(tokenRequest.capability),{[ownChannel]:['subscribe']});
  assert.equal((await signPusher(ownerSession.accessToken,ownChannel)).status,200);
  const fetched=await read(ownerSession.accessToken,ownEvent);assert.equal(fetched.status,200);assert.equal(fetched.headers.get('cache-control'),'no-store');
  assert.equal((await fetched.json()).data.events[0].data.content,'PRIVATE_REALTIME_MARKER');
  assert.deepEqual((await (await read(memberSession.accessToken,ownEvent)).json()).data.events,[]);
  const preAuth=await signAccessToken({sub:owner.id,is_admin:false,sid:'pre_auth',type:'pre_auth'});
  for(const token of [preAuth,'invalid-token']){assert.equal((await signAbly(token,ownChannel)).status,401);assert.equal((await signPusher(token,ownChannel)).status,401);assert.equal((await read(token,ownEvent)).status,401);}
  for(const state of ["is_banned=true","is_suspended=true,suspended_until=NOW()+INTERVAL '1 hour'","session_valid_after=NOW()+INTERVAL '1 second'"]){
   await db.query(`UPDATE users SET ${state} WHERE id=$1`,[owner.id]);
   assert.equal((await signAbly(ownerSession.accessToken,ownChannel)).status,401);
   assert.equal((await signPusher(ownerSession.accessToken,ownChannel)).status,401);
   assert.equal((await read(ownerSession.accessToken,ownEvent)).status,401);
   await db.query("UPDATE users SET is_banned=false,is_suspended=false,suspended_until=NULL,session_valid_after='1970-01-01' WHERE id=$1",[owner.id]);
  }
  const source=await verifyAccessToken(ownerSession.accessToken);await invalidateSession(source.sid!,owner.id);
  assert.equal((await signAbly(ownerSession.accessToken,ownChannel)).status,401);assert.equal((await signPusher(ownerSession.accessToken,ownChannel)).status,401);
  assert.equal((await read(ownerSession.accessToken,ownEvent)).status,401);
  console.log('PASS Ably/Pusher and event reads reject invalid/pre-auth/revoked/blocked/old-epoch sessions; brokers receive only opaque references and active users retrieve private bodies');
  const makeRoom=async(type='free_open')=>{
   const room=(await db.query("INSERT INTO rooms(creator_id,name,type,is_public) VALUES($1,'Realtime fixture',$2,false) RETURNING id",[owner.id,type])).rows[0].id as string;rooms.push(room);
   await db.query("INSERT INTO room_members(room_id,user_id) VALUES($1,$2)",[room,member.id]);return room;
  };
  const room=await makeRoom(),channel='room:'+room+':messages',event=await prepare(channel);
  assert.equal((await signAbly(memberSession.accessToken,channel)).status,200);assert.equal((await signPusher(memberSession.accessToken,channel)).status,200);
  assert.equal((await (await read(memberSession.accessToken,event)).json()).data.events.length,1);
  for(const state of ["is_banned=true","is_suspended=true","deleted_at=NOW()"]){
   await db.query(`UPDATE rooms SET ${state} WHERE id=$1`,[room]);
   assert.equal((await signAbly(memberSession.accessToken,channel)).status,403);assert.equal((await signPusher(memberSession.accessToken,channel)).status,403);
   assert.deepEqual((await (await read(memberSession.accessToken,event)).json()).data.events,[]);
   await db.query('UPDATE rooms SET is_banned=false,is_suspended=false,deleted_at=NULL WHERE id=$1',[room]);
  }
  await db.query('UPDATE room_members SET left_at=NOW() WHERE room_id=$1 AND user_id=$2',[room,member.id]);
  assert.deepEqual((await (await read(memberSession.accessToken,event)).json()).data.events,[]);
  for(const type of ['drop','limited','vip']){
   const id=await makeRoom(type),topic='room:'+id+':messages';
   if(type==='drop')await db.query("UPDATE rooms SET drop_ends_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[id]);
   if(type==='limited')await db.query("UPDATE rooms SET created_at=NOW()-INTERVAL '1 hour',duration_minutes=1 WHERE id=$1",[id]);
   if(type==='vip')await db.query("INSERT INTO room_subscriptions(room_id,user_id,expires_at,status) VALUES($1,$2,NOW()-INTERVAL '1 minute','active')",[id,member.id]);
   assert.equal((await signAbly(memberSession.accessToken,topic)).status,403);assert.equal((await signPusher(memberSession.accessToken,topic)).status,403);
   assert.deepEqual((await (await read(memberSession.accessToken,await prepare(topic))).json()).data.events,[]);
  }
  const group=(await db.query("INSERT INTO group_chats(creator_id,name) VALUES($1,'Realtime group') RETURNING id",[owner.id])).rows[0].id as string;groups.push(group);
  await db.query('INSERT INTO group_chat_members(group_chat_id,user_id) VALUES($1,$2)',[group,member.id]);
  const topic='group:'+group+':messages',groupEvent=await prepare(topic);
  assert.equal((await signPusher(memberSession.accessToken,topic)).status,200);
  await db.query('INSERT INTO group_chat_blocks(group_chat_id,user_id) VALUES($1,$2)',[group,member.id]);
  assert.equal((await signAbly(memberSession.accessToken,topic)).status,403);assert.equal((await signPusher(memberSession.accessToken,topic)).status,403);
  assert.deepEqual((await (await read(memberSession.accessToken,groupEvent)).json()).data.events,[]);
  console.log('PASS retained socket references cannot bypass left memberships, group blocks, moderation, VIP subscriptions or timed-room expiry');
 }finally{
  for(const id of eventIds)await redis.del('realtime_event:'+id);
  for(const id of groups)await db.query('DELETE FROM group_chats WHERE id=$1',[id]);
  for(const id of rooms)await db.query('DELETE FROM rooms WHERE id=$1',[id]);
  for(const id of users){await invalidateAllSessions(id);await db.query('DELETE FROM users WHERE id=$1',[id]);}
  await db.end();
 }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.cause?.message??error.message);process.exit(1);});
