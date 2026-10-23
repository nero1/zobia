const store=new Map<string,string>();
const mockRedis={get:jest.fn(async(key:string)=>store.get(key)??null),set:jest.fn(async(key:string,value:string)=>{if(store.has(key))return null;store.set(key,value);return 'OK';}),del:jest.fn(async(...keys:string[])=>{keys.forEach(k=>store.delete(k));return 1;}),eval:jest.fn(async(_script:string,count:number,...args:string[])=>{if(count===2){const [key,lock,token,,value]=args;if(store.get(lock)!==token)return 0;store.set(key,value);store.delete(lock);return 1;}const[key,token]=args;if(store.get(key)===token)store.delete(key);return 1;})};
jest.mock('@/lib/redis',()=>({redis:mockRedis}));
import {sharedCached,invalidateSharedCache} from '../sharedFill';
describe('Shared cache fill coordination',()=>{
 it('joins a concurrent burst before touching Redis or rebuilding',async()=>{
  const fill=jest.fn(async()=>({value:1}));const results=await Promise.all(Array.from({length:100},()=>sharedCached('burst',60,1000,fill)));
  expect(fill).toHaveBeenCalledTimes(1);expect(results).toHaveLength(100);expect(mockRedis.get).toHaveBeenCalledTimes(1);
 });
 it('does not publish an invalidated, older in-flight result',async()=>{
  let release!:(value:string)=>void;const work=sharedCached('generation',60,1000,()=>new Promise<string>(resolve=>{release=resolve;}));
  while(!release)await Promise.resolve();await invalidateSharedCache('generation');
  await expect(sharedCached('generation',60,1000,async()=>'fresh')).resolves.toBe('fresh');release('stale');
  await expect(work).rejects.toMatchObject({status:503});expect(store.get('generation')).toBe(JSON.stringify('fresh'));
 });
 it('does not run expensive fills when Redis is unavailable',async()=>{
  mockRedis.get.mockRejectedValueOnce(new Error('offline'));const fill=jest.fn(async()=>1);
  await expect(sharedCached('offline',60,1000,fill)).rejects.toMatchObject({status:503});expect(fill).not.toHaveBeenCalled();
 });
});
