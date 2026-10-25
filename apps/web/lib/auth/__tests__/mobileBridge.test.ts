const mockGet = jest.fn();
const mockGetdel = jest.fn();
const mockSetex = jest.fn();
jest.mock('@/lib/redis', () => ({redis:{get:mockGet,getdel:mockGetdel,setex:mockSetex}}));
import { consumeBridgeIntent, createBridgeIntent, readBridgeGrant, readBridgeIntent, isAllowedBridgePath } from '../mobileBridge';
const grant = {userId:'00000000-0000-4000-8000-000000000001',sourceSid:'00000000-0000-4000-8000-000000000002',path:'/kyc'};
const code = 'ab'.repeat(32);
let stored: Map<string,string>;
beforeEach(() => {
  jest.clearAllMocks(); stored = new Map();
  mockSetex.mockImplementation(async (key:string,_ttl:number,value:string) => {stored.set(key,value);return 'OK';});
  mockGet.mockImplementation(async (key:string) => stored.get(key) ?? null);
  mockGetdel.mockImplementation(async (key:string) => {const value=stored.get(key) ?? null;stored.delete(key);return value;});
  stored.set(`mobile_bridge:${code}`,JSON.stringify(grant));
});
it('GET-style intent creation does not consume the grant or create credentials', async () => {
  const intent = await createBridgeIntent(code,grant,'example',false);
  expect(await readBridgeIntent(intent.id,intent.secret)).toMatchObject({grant});
  expect(stored.has(`mobile_bridge:${code}`)).toBe(true);
  expect(mockGetdel).not.toHaveBeenCalled();
});
it('requires the originating browser cookie before consuming either credential', async () => {
  const intent=await createBridgeIntent(code,grant,'example',false);
  expect(await consumeBridgeIntent(intent.id,undefined)).toBeNull();
  expect(await consumeBridgeIntent(intent.id,'cd'.repeat(32))).toBeNull();
  expect(mockGetdel).not.toHaveBeenCalled();
  expect(await consumeBridgeIntent(intent.id,intent.secret)).toEqual(grant);
  expect(await consumeBridgeIntent(intent.id,intent.secret)).toBeNull();
});
it('allows only one successful concurrent confirmation', async () => {
  const intent=await createBridgeIntent(code,grant,'example',false);
  const results=await Promise.all([consumeBridgeIntent(intent.id,intent.secret),consumeBridgeIntent(intent.id,intent.secret)]);
  expect(results.filter(Boolean)).toHaveLength(1);
});
it('rejects expired browser intents without burning the grant', async () => {
  const intent=await createBridgeIntent(code,grant,'example',false);
  const key=`mobile_bridge_intent:${intent.id}`;
  stored.set(key,JSON.stringify({...JSON.parse(stored.get(key)!),expiresAt:Date.now()-1}));
  expect(await consumeBridgeIntent(intent.id,intent.secret)).toBeNull();
  expect(stored.has(`mobile_bridge:${code}`)).toBe(true);
});
it('requires the unchanged source, account and destination at final consume', async () => {
  const intent=await createBridgeIntent(code,grant,'example',false);
  stored.set(`mobile_bridge:${code}`,JSON.stringify({...grant,path:'/creator/wallet'}));
  expect(await consumeBridgeIntent(intent.id,intent.secret)).toBeNull();
});
it('rejects malformed grants, codes and unapproved destinations', async () => {
  expect(await readBridgeGrant('bad')).toBeNull();
  stored.set(`mobile_bridge:${code}`,JSON.stringify({...grant,sourceSid:'invalid'}));
  expect(await readBridgeGrant(code)).toBeNull();
  for(const path of ['//evil.invalid','/creator/wallet?next=//evil.invalid','/kyc/../gate44','https://evil.invalid'])expect(isAllowedBridgePath(path)).toBe(false);
});
