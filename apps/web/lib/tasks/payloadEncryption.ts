import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {env} from '@/lib/env';
import {getCurrentKeyId} from '@/lib/auth/jwt';
export interface EncryptedTaskPayload{kid:string;iv:string;tag:string;ciphertext:string}
function key(kid:string):Buffer{
 if(!/^[a-zA-Z0-9_-]{1,32}$/.test(kid))throw new Error('Invalid task encryption key ID');
 const secret=kid===getCurrentKeyId()?env.JWT_REFRESH_SECRET:process.env[`JWT_REFRESH_SECRET_${kid}`];
 if(!secret)throw new Error('Task encryption key unavailable');
 return createHmac('sha256',secret).update('zobia:private-task-payload:v1').digest();
}
export function encryptTaskPayload(value:unknown):EncryptedTaskPayload{
 const kid=getCurrentKeyId(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(kid),iv);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return {kid,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),ciphertext:ciphertext.toString('base64url')};
}
export function decryptTaskPayload(payload:EncryptedTaskPayload):unknown{
 if(!payload || typeof payload.ciphertext!=='string' || payload.ciphertext.length>32768)throw new Error('Invalid encrypted task payload');
 const iv=Buffer.from(payload.iv,'base64url'),tag=Buffer.from(payload.tag,'base64url');
 if(iv.length!==12 || tag.length!==16)throw new Error('Invalid encrypted task envelope');
 const cipher=createDecipheriv('aes-256-gcm',key(payload.kid),iv);cipher.setAuthTag(tag);
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload.ciphertext,'base64url')),cipher.final()]).toString('utf8'));
}
