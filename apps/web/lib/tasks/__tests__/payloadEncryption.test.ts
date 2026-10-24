jest.mock('@/lib/env',()=>({env:{JWT_REFRESH_SECRET:'fixture-only-task-encryption-key-0000000000000000'}}));
jest.mock('@/lib/auth/jwt',()=>({getCurrentKeyId:()=> 'v1'}));
import {encryptTaskPayload,decryptTaskPayload} from '../payloadEncryption';
describe('private task payloads',()=>{
 it('round-trips without storing the reset secret in plaintext',()=>{
  const payload=encryptTaskPayload({token:'sensitive-reset-marker',email:'fixture@security.invalid'});
  expect(JSON.stringify(payload)).not.toContain('sensitive-reset-marker');
  expect(decryptTaskPayload(payload)).toEqual({token:'sensitive-reset-marker',email:'fixture@security.invalid'});
 });
 it('rejects a tampered envelope',()=>{
  const payload=encryptTaskPayload({token:'fixture'});
  payload.tag=Buffer.alloc(16).toString('base64url');
  expect(()=>decryptTaskPayload(payload)).toThrow();
 });
 it('uses a fresh nonce for each task',()=>{
  expect(encryptTaskPayload({token:'same'}).ciphertext).not.toBe(encryptTaskPayload({token:'same'}).ciphertext);
 });
});
