const mockStore=new Map<string,string>();
const mockSetex=jest.fn(async(key:string,_ttl:number,value:string)=>{mockStore.set(key,value);return 'OK';});
jest.mock('@/lib/redis',()=>({redis:{setex:(...args:unknown[])=>mockSetex(...args as [string,number,string]),mget:async(...keys:string[])=>keys.map(key=>mockStore.get(key)??null)}}));
jest.mock('@/lib/env',()=>({env:{ABLY_API_KEY:'fixture.key:fixture-secret',PUSHER_APP_ID:'1',PUSHER_KEY:'fixture-key',PUSHER_SECRET:'fixture-secret',PUSHER_CLUSTER:'eu'}}));
import {prepareRealtimeEvent,readProtectedEvents,PROTECTED_EVENT_TTL} from '../protectedEvents';
import {AblyProvider} from '../providers/ably';
import {PusherProvider} from '../providers/pusher';
beforeEach(()=>{mockStore.clear();mockSetex.mockClear();});
it('keeps the body server-side and bounds retention',async()=>{
 const result=await prepareRealtimeEvent('room:private:messages','new_message',{secret:'buyer-only-content'});
 expect(result.event).toBe('sync');expect(JSON.stringify(result)).not.toContain('buyer-only-content');
 expect(mockSetex.mock.calls[0][1]).toBe(PROTECTED_EVENT_TTL);
 const id=(result.data as {eventId:string}).eventId;
 expect(await readProtectedEvents([id])).toEqual([{id,channel:'room:private:messages',event:'new_message',data:{secret:'buyer-only-content'}}]);
});
it.each([new AblyProvider(),new PusherProvider()])('never serializes protected bodies to a broker',async provider=>{
 const request=jest.spyOn(global,'fetch').mockResolvedValue(new Response('{}',{status:201}));
 try{
  await provider.publish('user:00000000-0000-4000-8000-000000000001','reward_earned',{secret:'private-ledger-marker'});
  const body=String(request.mock.calls[0][1]?.body);
  expect(body).not.toContain('private-ledger-marker');expect(body).toContain('sync');expect(body).toContain('eventId');
 }finally{request.mockRestore();}
});
it('rejects oversized private bodies before storage and preserves public payloads',async()=>{
 await expect(prepareRealtimeEvent('user:private','new_message',{content:'🔥'.repeat(20000)})).rejects.toThrow('limit');
 expect(mockSetex).not.toHaveBeenCalled();
 expect(await prepareRealtimeEvent('platform:news','news',{content:'public'})).toEqual({event:'news',data:{content:'public'}});
 expect(mockSetex).not.toHaveBeenCalled();
});
