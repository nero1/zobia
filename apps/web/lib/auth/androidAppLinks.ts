/** Signing fingerprints are public certificate identifiers, never private keys. */
export function androidAppLinks(raw:string|undefined){
 const entries=(raw??'').split(/[,;\n]/).map(value=>value.trim()).filter(Boolean);
 if(entries.length>20)throw Error('Too many Android signing fingerprints');
 const fingerprints=entries.map(value=>{
  const hex=value.replaceAll(':','').toUpperCase();
  if(!/^[A-F0-9]{64}$/.test(hex))throw Error('Invalid Android SHA-256 signing fingerprint');
  return hex.match(/.{2}/g)!.join(':');
 });
 return fingerprints.length?[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'com.zobiasocial.app',sha256_cert_fingerprints:[...new Set(fingerprints)]}}]:[];
}
