import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

type Receipt = {id:string;userId:string;creativeId:string;placementKey:string;expires:number};
function signature(payload:string):Buffer {
  const key=process.env.JWT_SECRET;
  if(!key || key.length<32) throw new Error('Ad receipt signing key unavailable');
  return createHmac('sha256',key).update('zobia:ad-receipt:v1:').update(payload).digest();
}
export function issueAdReceipt(userId:string,creativeId:string,placementKey:string):string {
  const payload=Buffer.from(JSON.stringify({id:randomUUID(),userId,creativeId,placementKey,expires:Date.now()+24*60*60_000} satisfies Receipt)).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}
export function verifyAdReceipt(receipt:string,userId:string,creativeId:string,placementKey:string):Receipt|null {
  try {
    if(receipt.length>1024) return null;
    const parts=receipt.split('.'); if(parts.length!==2) return null;
    const [payload,mac]=parts;const supplied=Buffer.from(mac,'base64url'),expected=signature(payload);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return null;
    const value=JSON.parse(Buffer.from(payload,'base64url').toString()) as Receipt;
    return value.userId===userId && value.creativeId===creativeId && value.placementKey===placementKey && Number.isSafeInteger(value.expires) && value.expires>Date.now() && typeof value.id==='string' ? value:null;
  } catch {return null;}
}
