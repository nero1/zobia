import {z} from 'zod';
import {and,eq,isNull,sql} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {env} from '@/lib/env';
import {sendEmail} from '@/lib/notifications/email';
import {decryptTaskPayload,type EncryptedTaskPayload} from '@/lib/tasks/payloadEncryption';
import type {DurableTask} from '@/lib/tasks/outbox';
import {PermanentTaskError} from '@/lib/tasks/outbox';
export async function deliverPasswordResetTask(task:DurableTask):Promise<void>{
 const details=z.object({email:z.string().email(),name:z.string().max(1000),token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(decryptTaskPayload(task.payload.encrypted as unknown as EncryptedTaskPayload));
 const db=await getDb();
 const [token]=await db.select({id:schema.passwordResetTokens.id,expiresAt:schema.passwordResetTokens.expiresAt,usedAt:schema.passwordResetTokens.usedAt}).from(schema.passwordResetTokens).innerJoin(schema.users,eq(schema.users.id,schema.passwordResetTokens.userId)).where(and(eq(schema.passwordResetTokens.id,String(task.payload.tokenId)),eq(schema.users.id,task.user_id!),eq(schema.users.email,details.email),isNull(schema.users.deletedAt)));
 if(!token || token.usedAt)return; // Consumed, superseded, or no longer owned by this email.
 if(token.expiresAt.getTime()<=Date.now())throw new PermanentTaskError('PASSWORD_RESET_EXPIRED');
 const name=details.name.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const url=`${env.NEXT_PUBLIC_APP_URL}/auth/reset-password?token=${encodeURIComponent(details.token)}`;
 await sendEmail(details.email,'Reset your Zobia password',`Hi ${details.name}, reset your password: ${url} (expires in 1 hour)`,`<p>Hi ${name},</p><p><a href="${url}">Reset your password</a></p><p>This link expires in one hour. Ignore it if you did not request it.</p>`,'security');
}
