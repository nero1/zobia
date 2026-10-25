'use client';
import {authFetch} from '@/lib/api/authFetch';
/** Keep reconnect authorization on the same silent-refresh boundary as HTTP. */
export async function authorizePusherChannel(params:{socketId:string;channelName:string}):Promise<{auth:string}> {
 const response=await authFetch('/api/realtime/pusher-auth',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({socket_id:params.socketId,channel_name:params.channelName}),signal:AbortSignal.timeout(8000),
 });
 if(!response.ok)throw new Error('Pusher authorization failed');
 const result=await response.json() as {auth?:unknown};
 if(typeof result.auth!=='string' || result.auth.length>200)throw new Error('Invalid Pusher authorization response');
 return {auth:result.auth};
}
