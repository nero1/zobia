import {createRealtimeEventResolver,realtimeEventId} from '@zobia/shared/utils';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const channel='room:'+id(1)+':messages';
const record=(n:number)=>({id:id(n),channel,event:'new_message',data:{content:'private'}});
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>jest.useRealTimers());
it('coalesces subscribers and batches bounded requests without retaining payloads',async()=>{
 const load=jest.fn(async(ids:string[])=>ids.map(key=>({...record(1),id:key})));
 const resolve=createRealtimeEventResolver(load);
 const first=resolve(id(1),channel),duplicate=resolve(id(1),channel),second=resolve(id(2),channel);
 await jest.runAllTimersAsync();
 expect(await Promise.all([first,duplicate,second])).toHaveLength(3);
 expect(load).toHaveBeenCalledTimes(1);expect(load.mock.calls[0][0]).toEqual([id(1),id(2)]);
 const fresh=resolve(id(1),channel);await jest.runAllTimersAsync();await fresh;
 expect(load).toHaveBeenCalledTimes(2);
});
it('splits bursts at twenty and never delivers another channel',async()=>{
 const load=jest.fn(async(ids:string[])=>ids.map(key=>({...record(1),id:key})));
 const resolve=createRealtimeEventResolver(load);
 const results=Promise.all(Array.from({length:25},(_,n)=>resolve(id(n+1),channel)));
 await jest.runAllTimersAsync();expect(await results).toHaveLength(25);
 expect(load.mock.calls.map(([ids])=>ids.length)).toEqual([20,5]);
 const wrong=expect(resolve(id(1),'user:'+id(1))).rejects.toThrow('channel mismatch');await jest.runAllTimersAsync();await wrong;
});
it('backs off on failures and limits queued work',async()=>{
 const failure=Object.assign(new Error('busy'),{retryAfterMs:60000});
 const load=jest.fn().mockRejectedValueOnce(failure).mockImplementation(async(ids:string[])=>ids.map(key=>({...record(1),id:key})));
 const resolve=createRealtimeEventResolver(load);
 const first=expect(resolve(id(1),channel)).rejects.toThrow('temporarily unavailable');await jest.runAllTimersAsync();await first;
 await expect(resolve(id(2),channel)).rejects.toThrow('temporarily unavailable');expect(load).toHaveBeenCalledTimes(1);
 await jest.advanceTimersByTimeAsync(61000*1.2);
 const pending=Promise.all(Array.from({length:200},(_,n)=>resolve(id(n+1),channel)));
 await expect(resolve(id(201),channel)).rejects.toThrow('queue full');await jest.runAllTimersAsync();await pending;
});
it('ignores malformed wake-ups and rejects missing events',async()=>{
 expect(realtimeEventId({eventId:'not-a-uuid'})).toBeNull();expect(realtimeEventId(record(1))).toBeNull();
 expect(realtimeEventId({eventId:id(1)})).toBe(id(1));
 const resolve=createRealtimeEventResolver(async()=>[]);
 const absent=expect(resolve(id(1),channel)).rejects.toThrow('unavailable');await jest.runAllTimersAsync();await absent;
});
