import {generateKeyPairSync,sign} from 'node:crypto';
const values=new Map<string,string>();
jest.mock('@/lib/redis',()=>({redis:{set:jest.fn(async(key:string,value:string)=>{if(values.has(key))return null;values.set(key,value);return 'OK';}),get:jest.fn(async(key:string)=>values.get(key)??null),setex:jest.fn(async(key:string,_seconds:number,value:string)=>{values.set(key,value);return 'OK';})}}));
import {issueRewardChallenge,verifyRewardChallenge,verifyAdmobCompletion,hasAdmobCompletion} from '../rewardProof';
const account='12345678-1234-1234-1234-123456789abc',unit='ca-app-pub-fixture/reward';
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
function callback(challenge:string,transaction='transaction-1'){
 const parameters=new URLSearchParams({ad_unit:unit,custom_data:challenge,user_id:account,timestamp:String(Date.now()),transaction_id:transaction,reward_amount:'1',reward_item:'fixture'});
 const message=parameters.toString();
 const signature=sign('sha256',Buffer.from(message),pair.privateKey).toString('base64url');
 return new URL('https://example.invalid/ssv?'+message+'&signature='+signature+'&key_id=1');
}
describe('AdMob trusted completion evidence',()=>{
 beforeAll(()=>{process.env.JWT_REFRESH_SECRET='fixture-refresh-signing-key-at-least-32-characters';jest.spyOn(global,'fetch').mockResolvedValue(new Response(JSON.stringify({keys:[{keyId:1,pem:pair.publicKey.export({format:'pem',type:'spki'}).toString()}]})));});
 afterAll(()=>jest.restoreAllMocks());
 beforeEach(()=>values.clear());
 it('binds and expires its signed account challenge',()=>{
  const challenge=issueRewardChallenge(account);expect(verifyRewardChallenge(challenge)?.userId).toBe(account);
  expect(verifyRewardChallenge(challenge+'x')).toBeNull();
  const now=Date.now();const clock=jest.spyOn(Date,'now').mockReturnValue(now+86400001);
  expect(verifyRewardChallenge(challenge)).toBeNull();clock.mockRestore();
 });
 it('requires provider signature before accepting the completion',async()=>{
  const challenge=issueRewardChallenge(account),url=callback(challenge);url.searchParams.set('reward_amount','999');
  expect(await verifyAdmobCompletion(url,unit)).toBeNull();expect(await hasAdmobCompletion(verifyRewardChallenge(challenge)!)).toBe(false);
 });
 it('accepts signed completion once and rejects reusing a transaction for another challenge',async()=>{
  const token=issueRewardChallenge(account),url=callback(token);
  const accepted=await verifyAdmobCompletion(url,unit);expect(accepted).not.toBeNull();expect(await hasAdmobCompletion(accepted!)).toBe(true);
  expect(await verifyAdmobCompletion(url,unit)).not.toBeNull();
  expect(await verifyAdmobCompletion(callback(issueRewardChallenge(account)),unit)).toBeNull();
 });
 it('rejects wrong units, duplicate parameters and stale provider timestamps',async()=>{
  const url=callback(issueRewardChallenge(account));expect(await verifyAdmobCompletion(url,'other-unit')).toBeNull();
  url.searchParams.append('user_id',account);expect(await verifyAdmobCompletion(url,unit)).toBeNull();
 });
});
