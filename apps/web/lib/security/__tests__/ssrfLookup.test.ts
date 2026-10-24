import {createPinnedLookup,isPublicAddress} from '../ssrf';
import type {LookupFunction} from 'node:net';
const invoke=(lookup:LookupFunction,all:boolean)=>{
 const callback=jest.fn();lookup('oauth2.googleapis.com',{all,family:0},callback);return callback.mock.calls[0];
};
it.each(['8.8.8.8','2001:4860:4860::8888'])('returns an address array for Node auto family selection: %s',ip=>{
 expect(invoke(createPinnedLookup(ip),true)).toEqual([null,[{address:ip,family:ip.includes(':')?6:4}]]);
});
it.each(['8.8.8.8','2001:4860:4860::8888'])('preserves the scalar callback for single-address lookups: %s',ip=>{
 expect(invoke(createPinnedLookup(ip),false)).toEqual([null,ip,ip.includes(':')?6:4]);
});
it('never performs a second hostname resolution and rejects missing pins',()=>{
 const first=invoke(createPinnedLookup('8.8.8.8'),true),second=invoke(createPinnedLookup('8.8.8.8'),false);expect(first[1][0].address).toBe(second[1]);expect(()=>createPinnedLookup('undefined')).toThrow('Invalid pinned address');
});
it.each(['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1'])('retains private/metadata destination rejection: %s',ip=>expect(isPublicAddress(ip)).toBe(false));
