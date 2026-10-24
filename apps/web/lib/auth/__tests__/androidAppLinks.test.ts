import {androidAppLinks} from '../androidAppLinks';
it('publishes no placeholder association when fingerprints are not set',()=>expect(androidAppLinks(undefined)).toEqual([]));
it('normalizes, deduplicates and publishes public signing certificates for the installed app',()=>{
 const hex='ab'.repeat(32),colon=hex.match(/.{2}/g)!.join(':');
 expect(androidAppLinks(hex+'\n'+colon)).toEqual([{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'com.zobiasocial.app',sha256_cert_fingerprints:[colon.toUpperCase()]}}]);
});
it.each(['REPLACE_WITH_YOUR_APP_SIGNING_CERT_SHA256','ab'.repeat(31),'invalid'])('rejects malformed fingerprints: %s',value=>expect(()=>androidAppLinks(value)).toThrow('Invalid Android SHA-256'));
