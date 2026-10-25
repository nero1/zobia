'use client';
import {createRealtimeEventResolver,type RealtimeEventData} from '@zobia/shared/utils';
import {authFetch} from '@/lib/api/authFetch';
export const resolveRealtimeEvent=createRealtimeEventResolver(async ids=>{
 const response=await authFetch('/api/realtime/events?'+new URLSearchParams({ids:ids.join(',')}),{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok){
  const error=new Error('Realtime payload request failed') as Error & {retryAfterMs?:number};
  if(response.status===429)error.retryAfterMs=Math.max(1000,Number(response.headers.get('Retry-After')??'60')*1000);
  throw error;
 }
 const body=await response.json() as {data?:{events?:RealtimeEventData[]}};
 return Array.isArray(body.data?.events)?body.data.events:[];
});
