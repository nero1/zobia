import {randomUUID} from 'crypto';
import {fixtures,request,userId,otherId,fundWallet} from './fixture';
beforeAll(async()=>{await fixtures();const pin=process.env.SECURITY_TEST_PIN;if(!pin)throw new Error('Missing fixture PIN');expect((await request('/api/auth/pin/verify',undefined,{method:'POST',body:JSON.stringify({pin})})).status).toBe(200);});
const transfer=(amount:unknown)=>request('/api/economy/coins/transfer',undefined,{method:'POST',body:JSON.stringify({recipientId:otherId,amount,idempotencyKey:randomUUID()})});
it.each([-100,0,9,99.5,'100coins',Number.MAX_SAFE_INTEGER+1,100001])('rejects invalid amount %s after PIN authentication',async amount=>expect((await transfer(amount)).status).toBe(400));
it('serializes competing spends against a known balance',async()=>{
 await fundWallet(userId,20);await fundWallet(otherId,0);
 const responses=await Promise.all(Array.from({length:5},()=>transfer(10)));
 expect(responses.filter(r=>r.status===200)).toHaveLength(2);expect(responses.filter(r=>r.status===400)).toHaveLength(3);
 const own=await request('/api/users/me');expect(Number((await own.json()).user.coin_balance)).toBe(0);
});
it('deduplicates a retried debit after the sender has spent the original balance',async()=>{
 await fundWallet(userId,10);const idempotencyKey=randomUUID();const body=JSON.stringify({recipientId:otherId,amount:10,idempotencyKey});
 const a=await request('/api/economy/coins/transfer',undefined,{method:'POST',body});expect(a.status).toBe(200);
 const b=await request('/api/economy/coins/transfer',undefined,{method:'POST',body});expect(b.status).toBe(200);
 expect(Number((await (await request('/api/users/me')).json()).user.coin_balance)).toBe(0);
});
