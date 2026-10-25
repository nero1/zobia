const mockDetach=jest.fn();
const mockAuthorize=jest.fn();
const mockClient={auth:{authorize:mockAuthorize},connection:{state:'connected'},channels:{get:()=>({detach:mockDetach})},close:jest.fn()};
jest.mock('ably',()=>({Realtime:jest.fn().mockImplementation(()=>mockClient)}));
jest.mock('@/lib/api/authFetch',()=>({authFetch:jest.fn(async()=>({ok:true,json:async()=>({capability:JSON.stringify({'user:test':['subscribe']})})}))}));
import {acquireAblyChannel,closeAbly} from '../ablyShared';
it('keeps a shared channel attached until its final subscriber releases it',async()=>{
 jest.useFakeTimers();
 mockAuthorize.mockImplementation(async()=>{
  // The SDK runs its configured auth callback during authorization.
  const Ably=await import('ably');
  const options=(Ably.Realtime as unknown as jest.Mock).mock.calls[0][0];
  await new Promise<void>((resolve,reject)=>options.authCallback({},(error:unknown)=>error?reject(error):resolve()));
 });
 try{
  const first=await acquireAblyChannel('user:test');
  const second=await acquireAblyChannel('user:test');
  first.release();expect(mockDetach).not.toHaveBeenCalled();
  first.release();expect(mockDetach).not.toHaveBeenCalled();
  second.release();expect(mockDetach).toHaveBeenCalledTimes(1);
 }finally{closeAbly();jest.useRealTimers();}
});
