const mockExecute=jest.fn();
jest.mock('@/lib/payments/circuit',()=>({paystackBreaker:{execute:(fn:unknown)=>mockExecute(fn)}}));
jest.mock('@/lib/env',()=>({env:{PAYSTACK_SECRET_KEY:'fixture-only-key'}}));
import {verifyPayment} from '../paystack';
it('propagates breaker cancellation to the live provider request',async()=>{
 const original=global.fetch,controller=new AbortController();
 mockExecute.mockImplementation((fn:(signal:AbortSignal)=>unknown)=>fn(controller.signal));
 global.fetch=jest.fn((_input,_options)=>new Promise<Response>((_resolve,reject)=>{const signal=_options?.signal;expect(signal).toBeDefined();signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true});}));
 try{
  const pending=verifyPayment('fixture-reference');controller.abort(new Error('Breaker deadline'));await expect(pending).rejects.toThrow('Breaker deadline');expect(global.fetch).toHaveBeenCalledTimes(1);
 }finally{global.fetch=original;}
});
