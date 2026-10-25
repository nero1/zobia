import {and,eq,sql} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {badRequest} from '@/lib/api/errors';
import {storage} from './index';
import {storageKey} from './privacy';
import type {StorageAdapter,UploadOptions} from './interface';
export const PUBLIC_MEDIA_MAX_BYTES=200*1024*1024;
export const PUBLIC_MEDIA_MAX_OBJECTS=500;
export const PUBLIC_MEDIA_MAX_DRAFTS=30;
/** Reserve normalized bytes before any external write. Aborted invocations
 * leave a durable, bounded reservation that the existing daily sweep recovers. */
export async function uploadPublicMedia(userId:string,key:string,buffer:Buffer,options:UploadOptions,adapter:StorageAdapter=storage){
 storageKey(key,true);
 if(!key.split('/').includes(userId))throw new Error('Upload key is not owned by its principal');
 const db=await getDb(),url=adapter.getPublicUrl(key);
 const asset=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId},38))`);
  const [user]=await tx.select({id:schema.users.id}).from(schema.users).where(and(eq(schema.users.id,userId),sql`${schema.users.deletedAt} IS NULL`));
  if(!user)throw badRequest('Upload account is unavailable');
  const usage=await tx.execute<{bytes:string;objects:string;drafts:string}>(sql`SELECT COALESCE(SUM(size_bytes),0)::text bytes,COUNT(*)::text objects,COUNT(*) FILTER(WHERE unreferenced_at IS NOT NULL)::text drafts FROM public_media_assets WHERE user_id=${userId}`);
  const used=usage.rows[0];
  if(BigInt(used.bytes)+BigInt(buffer.byteLength)>BigInt(PUBLIC_MEDIA_MAX_BYTES) || Number(used.objects)>=PUBLIC_MEDIA_MAX_OBJECTS || Number(used.drafts)>=PUBLIC_MEDIA_MAX_DRAFTS)throw badRequest('Your media storage limit is reached. Publish pending images or remove unused content and allow cleanup to finish.','MEDIA_QUOTA_REACHED');
  const [row]=await tx.insert(schema.publicMediaAssets).values({userId,storageKey:key,publicUrl:url,sizeBytes:BigInt(buffer.byteLength),contentType:options.contentType??'application/octet-stream'}).returning({id:schema.publicMediaAssets.id});
  return row;
 });
 const result=await adapter.upload(key,buffer,{...options,isPublic:true});
 // Failure here intentionally keeps the pending reservation: the object may
 // exist even when its provider acknowledgement or this SQL write was lost.
 if(result.publicUrl!==url)throw new Error('Storage returned an unexpected public media location');
 const ready=await db.update(schema.publicMediaAssets).set({state:'ready'}).where(and(eq(schema.publicMediaAssets.id,asset.id),eq(schema.publicMediaAssets.state,'pending'))).returning({id:schema.publicMediaAssets.id});
 if(!ready.length)throw new Error('Upload reservation expired');
 return result;
}
/** Bound every sweep; attachment uses the same asset row lock. Deleting assets
 * cannot gain new references while external deletion is in flight. */
export async function queueExpiredPublicMedia(limit=100){
 const db=await getDb();
 return db.transaction(async tx=>{
  const candidates=await tx.execute<{id:string;storage_key:string;state:string;unreferenced_at:Date|null}>(sql`SELECT a.id,a.storage_key,a.state,a.unreferenced_at FROM public_media_assets a
   WHERE a.state<>'deleting' AND ((a.unreferenced_at IS NOT NULL AND a.unreferenced_at<NOW()-INTERVAL '24 hours') OR EXISTS(SELECT 1 FROM public_media_references r WHERE r.asset_id=a.id AND r.expires_at<=NOW()))
   ORDER BY a.created_at,a.id LIMIT ${Math.min(100,Math.max(1,limit))} FOR UPDATE OF a SKIP LOCKED`);
  let queued=0;
  for(const asset of candidates.rows){
   await tx.execute(sql`DELETE FROM public_media_references WHERE asset_id=${asset.id} AND expires_at<=NOW()`);
   const live=await tx.select({id:schema.publicMediaReferences.assetId}).from(schema.publicMediaReferences).where(eq(schema.publicMediaReferences.assetId,asset.id)).limit(1);
   if(live.length)continue;
   if(!asset.unreferenced_at){await tx.update(schema.publicMediaAssets).set({unreferencedAt:new Date()}).where(eq(schema.publicMediaAssets.id,asset.id));continue;}
   if(new Date(asset.unreferenced_at).getTime()>Date.now()-86400000)continue;
   await tx.update(schema.publicMediaAssets).set({state:'deleting'}).where(eq(schema.publicMediaAssets.id,asset.id));
   await tx.execute(sql`INSERT INTO object_deletion_tasks(storage_key) VALUES(${asset.storage_key}) ON CONFLICT(storage_key) DO NOTHING`);queued++;
  }
  return queued;
 });
}
