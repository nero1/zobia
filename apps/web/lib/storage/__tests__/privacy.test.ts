import {storageKey,isPrivateStorageKey} from '../privacy';
it.each(['kyc/user/doc','exports/user/data','private/file'])('routes private key %s',key=>expect(isPrivateStorageKey(key)).toBe(true));
it('namespaces private uploads without changing public keys',()=>{
  expect(storageKey('avatar/u.png',false)).toBe('private/avatar/u.png');
  expect(storageKey('avatar/u.png')).toBe('avatar/u.png');
});
it.each(['/absolute','../x','a/../x','a/./x','a\\b','a\u0000b'])('rejects unsafe key %s',key=>expect(()=>storageKey(key)).toThrow());
