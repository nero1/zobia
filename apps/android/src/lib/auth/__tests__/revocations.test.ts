import {beforeEach,describe,expect,it,vi} from 'vitest';
const {data}=vi.hoisted(()=>({data:new Map<string,string>()}));
vi.mock('../secureTokenStore',()=>({secureGet:vi.fn(async(key:string)=>data.get(key)??null),secureSet:vi.fn(async(key:string,value:string)=>{data.set(key,value);})}));
vi.mock('@/lib/env',()=>({env:{VITE_API_BASE_URL:'https://fixture.invalid'}}));
import {enqueueSessionRevocation,flushSessionRevocations} from '../revocations';
describe('offline logout revocations',()=>{
 beforeEach(()=>{data.clear();vi.unstubAllGlobals();});
 it('retains revocation credentials after network failure and retries using the refresh proof',async()=>{
  const request=vi.fn().mockRejectedValueOnce(Error('Offline')).mockResolvedValueOnce(new Response('{}',{status:200}));vi.stubGlobal('fetch',request);
  await enqueueSessionRevocation('expired-access','signed-refresh');await flushSessionRevocations();
  expect(JSON.parse(data.values().next().value!)).toHaveLength(1);
  await flushSessionRevocations();expect(JSON.parse(data.values().next().value!)).toEqual([]);
  expect(request).toHaveBeenLastCalledWith('https://fixture.invalid/api/auth/logout',expect.objectContaining({method:'POST',headers:{Authorization:'Bearer expired-access','X-Refresh-Token':'signed-refresh'}}));
 });
 it('does not lose a second logout enqueued while a previous request is in flight',async()=>{
  let complete!:(response:Response)=>void;const request=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{complete=resolve;})).mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',request);
  await enqueueSessionRevocation('a','ra');const running=flushSessionRevocations();
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));await enqueueSessionRevocation('b','rb');complete(new Response('{}'));await running;
  expect(JSON.parse(data.values().next().value!)).toEqual([expect.objectContaining({accessToken:'b',refreshToken:'rb'})]);
  await flushSessionRevocations();expect(JSON.parse(data.values().next().value!)).toEqual([]);
 });
 it('retains pending work when the server cannot revoke the session',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:503})));await enqueueSessionRevocation('a','ra');await flushSessionRevocations();expect(JSON.parse(data.values().next().value!)).toHaveLength(1);
 });
});
