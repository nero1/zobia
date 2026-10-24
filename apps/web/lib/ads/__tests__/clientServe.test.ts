jest.mock('@/lib/cache/readCache',()=>({onReadCacheInvalidate:jest.fn()}));
import {requestAd,invalidateAdCache} from '../clientServe';
describe('batched ad views',()=>{
 afterEach(()=>{invalidateAdCache();jest.restoreAllMocks();});
 it('shares a creative fetch but consumes unique receipts for simultaneous and cached views',async()=>{
  const fetcher=jest.spyOn(global,'fetch').mockResolvedValue(new Response(JSON.stringify({data:{ads:{feed:{receipt:'view-one',viewReceipts:['view-two','view-three'],title:'Creative'}}}})));
  const [one,two]=await Promise.all([requestAd('feed'),requestAd('feed')]);
  expect(one?.receipt).toBe('view-one');expect(two?.receipt).toBe('view-two');
  expect((await requestAd('feed'))?.receipt).toBe('view-three');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('settles network failure without an unbounded internal request loop',async()=>{
  const fetcher=jest.spyOn(global,'fetch').mockRejectedValue(new Error('Offline'));
  expect(await requestAd('feed')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('discards a response after account cache invalidation',async()=>{
  let release!:(response:Response)=>void;
  const fetcher=jest.spyOn(global,'fetch').mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  const pending=requestAd('feed');
  while(!fetcher.mock.calls.length)await new Promise(resolve=>setTimeout(resolve,0));
  invalidateAdCache();release(new Response(JSON.stringify({data:{ads:{feed:{receipt:'old-user-view'}}}})));
  expect(await pending).toBeNull();
 });
});
