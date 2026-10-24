import {createHmac,randomUUID,timingSafeEqual,verify as verifySignature} from 'node:crypto';
import {redis} from '@/lib/redis';
import {readBoundedBytes} from '@/lib/security/requestBody';
const LIFETIME=24*60*60_000;
type Challenge={id:string;userId:string;expires:number};
function mac(payload:string){const key=process.env.JWT_REFRESH_SECRET;if(!key||key.length<32)throw Error('Reward signing key unavailable');return createHmac('sha256',key).update('zobia:admob-completion:v1:').update(payload).digest();}
export function issueRewardChallenge(userId:string){const payload=Buffer.from(JSON.stringify({id:randomUUID(),userId,expires:Date.now()+LIFETIME} satisfies Challenge)).toString('base64url');return `${payload}.${mac(payload).toString('base64url')}`;}
export function verifyRewardChallenge(token:string):Challenge|null{
 try{if(token.length>1024)return null;const parts=token.split('.');if(parts.length!==2)return null;const signature=Buffer.from(parts[1],'base64url'),expected=mac(parts[0]);if(signature.length!==expected.length||!timingSafeEqual(signature,expected))return null;const value=JSON.parse(Buffer.from(parts[0],'base64url').toString()) as Challenge;return typeof value.id==='string'&&/^[a-f0-9-]{36}$/.test(value.id)&&typeof value.userId==='string'&&/^[a-f0-9-]{36}$/.test(value.userId)&&Number.isSafeInteger(value.expires)&&value.expires>Date.now()&&value.expires<=Date.now()+LIFETIME?value:null;}catch{return null;}
}
let keys:{at:number;values:Array<{keyId:number;pem:string}>}|null=null;
let lastMissingKeyRefresh=0;
let pendingKeys:Promise<Array<{keyId:number;pem:string}>>|null=null;
async function verifierKeys(){
 if(keys&&Date.now()-keys.at<3600000)return keys.values;
 if(pendingKeys)return pendingKeys;
 pendingKeys=(async()=>{const response=await fetch('https://www.gstatic.com/admob/reward/verifier-keys.json',{signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw Error('AdMob verifier unavailable');const parsed=JSON.parse(new TextDecoder().decode(await readBoundedBytes(response,65536))) as {keys?:Array<{keyId:number;pem:string}>};if(!Array.isArray(parsed.keys)||parsed.keys.length>20||!parsed.keys.every(k=>Number.isSafeInteger(k.keyId)&&typeof k.pem==='string'&&k.pem.length<4096))throw Error('Invalid AdMob verifier keys');keys={at:Date.now(),values:parsed.keys};return keys.values;})();
 try{return await pendingKeys;}finally{pendingKeys=null;}
}
export async function verifyAdmobCompletion(url:URL,adUnit:string):Promise<Challenge|null>{
 const params=url.searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))return null;
 const challenge=verifyRewardChallenge(params.get('custom_data')??'');
 const timestamp=Number(params.get('timestamp'));
 if(!challenge || params.get('user_id')!==challenge.userId || params.get('ad_unit')!==adUnit || !/^\S{1,200}$/.test(params.get('transaction_id')??'') || !Number.isSafeInteger(timestamp)||timestamp>Date.now()+300000 || Date.now()-timestamp>LIFETIME)return null;
 const query=url.search.slice(1),signatureIndex=query.indexOf('&signature=');
 if(signatureIndex<0 || !params.get('signature') || !/^\d+$/.test(params.get('key_id')??''))return null;
 let key=(await verifierKeys()).find(k=>String(k.keyId)===params.get('key_id'));
 if(!key && Date.now()-lastMissingKeyRefresh>60000){lastMissingKeyRefresh=Date.now();keys=null;key=(await verifierKeys()).find(k=>String(k.keyId)===params.get('key_id'));}
 if(!key)return null;
 try{if(!verifySignature('sha256',Buffer.from(query.slice(0,signatureIndex)),key.pem,Buffer.from(params.get('signature')!,'base64url')))return null;}catch{return null;}
 // A signed provider transaction can establish only one completion identity.
 const transaction=params.get('transaction_id')!;
 const prior=await redis.set(`admob:transaction:${transaction}`,challenge.id,'EX',86400,'NX');
 if(prior!=='OK' && await redis.get(`admob:transaction:${transaction}`)!==challenge.id)return null;
 await redis.setex(`admob:complete:${challenge.id}`,86400,challenge.userId);
 return challenge;
}
export async function hasAdmobCompletion(challenge:Challenge){return await redis.get(`admob:complete:${challenge.id}`)===challenge.userId;}
