import {randomUUID} from 'node:crypto';
import {isProtectedRealtimeChannel} from '@zobia/shared/utils';
import {redis} from '@/lib/redis';
export const PROTECTED_EVENT_TTL = 60;
export interface ProtectedEvent {id:string;channel:string;event:string;data:unknown}
/** Providers carry opaque wake-ups, never private message/account bodies.
 * Even an already-authorized socket must use the live HTTP boundary to read. */
export async function prepareRealtimeEvent(channel:string,event:string,data:unknown) {
 if(!isProtectedRealtimeChannel(channel))return {event,data};
 const id=randomUUID();
 const text=JSON.stringify({id,channel,event,data});
 if(Buffer.byteLength(text,'utf8')>65536)throw new Error('Realtime payload exceeds the private event limit');
 await redis.setex(`realtime_event:${id}`,PROTECTED_EVENT_TTL,text);
 return {event:'sync',data:{eventId:id}};
}
export async function readProtectedEvents(ids:string[]):Promise<ProtectedEvent[]> {
 const raws=await redis.mget(...ids.map(id=>`realtime_event:${id}`));
 return raws.flatMap((raw,index)=>{
  try{
   const item=JSON.parse(raw??'null') as ProtectedEvent;
   if(!item || item.id!==ids[index] || typeof item.channel!=='string' || !isProtectedRealtimeChannel(item.channel) || typeof item.event!=='string')return [];
   return [item];
  }catch{return [];}
 });
}
