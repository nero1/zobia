import {createRealtimeEventResolver,type RealtimeEventData} from '@zobia/shared/utils';
import {apiClient} from '@/lib/api/client';
export const resolveRealtimeEvent=createRealtimeEventResolver(async ids=>{
 try{
  const response=await apiClient.get<{events:RealtimeEventData[]}>('/realtime/events',{params:{ids:ids.join(',')},timeout:8000});
  return Array.isArray(response.data.events)?response.data.events:[];
 }catch(error){
  const response=(error as {response?:{status?:number;headers?:Record<string,string>}})?.response;
  if(response?.status===429){const failure=new Error('Realtime rate limited') as Error & {retryAfterMs:number};failure.retryAfterMs=Math.max(1000,Number(response.headers?.['retry-after']??'60')*1000);throw failure;}
  throw new Error('Realtime payload request failed');
 }
});
