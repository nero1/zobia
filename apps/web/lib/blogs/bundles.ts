import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';
import { getManifestValue } from '@/lib/manifest';
import { debitCoins } from '@/lib/economy/coins';
import { debitStars } from '@/lib/economy/stars';
import { badRequest, conflict, forbidden } from '@/lib/api/errors';
const sizes = [100,200,300,500,1000];
const defaults = [1000,1900,2700,4250,8000];
export async function postBundleCatalog() {
  return Promise.all(sizes.map(async(slots,index)=>{
    const [credits,stars] = await Promise.all(['credits','stars'].map(async(currency)=>{
      const raw = await getManifestValue(`blog_post_bundle_${slots}_${currency}`);
      const value = raw == null ? defaults[index] / (currency==='stars'?10:1) : Number(raw);
      return Number.isSafeInteger(value) && value>0 && value<=100000000 ? value : null;
    }));
    return {slots,credits,stars};
  }));
}
/** Request ID, confirmed current price, wallet debit, and permanent quota are one transaction. */
export async function buyPostBundle(userId:string,blogId:string,input:{requestId:string;slots:number;currency:'credits'|'stars';confirmedCost:number}) {
  const catalog = await postBundleCatalog();
  const orm = await getDb();
  return orm.transaction(async(tx)=>{
    // Shared user-first order with other wallet purchases avoids wallet/blog deadlocks.
    await tx.execute(sql`SELECT id FROM users WHERE id=${userId} AND deleted_at IS NULL FOR UPDATE`);
    const [prior] = await tx.select().from(schema.blogPostBundlePurchases).where(eq(schema.blogPostBundlePurchases.id,input.requestId));
    if(prior) {
      if(prior.userId!==userId || prior.blogId!==blogId || prior.slots!==input.slots || prior.currency!==input.currency || prior.cost!==input.confirmedCost) throw conflict('Purchase request does not match the previous purchase.');
      return { slots:prior.slots, cost:prior.cost, currency:prior.currency, alreadyPurchased:true };
    }
    const [blog] = await tx.select({id:schema.blogs.id}).from(schema.blogs).where(and(eq(schema.blogs.id,blogId),eq(schema.blogs.ownerId,userId),eq(schema.blogs.status,'active'),isNull(schema.blogs.deletedAt))).for('update');
    if(!blog) throw forbidden('Only the owner of an active blog can buy post bundles.');
    const cost = catalog.find((item)=>item.slots===input.slots)?.[input.currency];
    if(!cost || input.confirmedCost!==cost) throw badRequest('Confirm the current bundle price before purchasing.','PRICE_CONFIRMATION_REQUIRED');
    if(input.currency==='credits') await debitCoins(userId,cost,'blog_post_bundle',`blog-post-bundle:${input.requestId}`,`${input.slots} extra blog posts`,{blogId},tx);
    else await debitStars(userId,cost,'blog_post_bundle',`blog-post-bundle:${input.requestId}`,`${input.slots} extra blog posts`,tx);
    await tx.insert(schema.blogPostBundlePurchases).values({id:input.requestId,userId,blogId,slots:input.slots,currency:input.currency,cost});
    await tx.update(schema.blogs).set({extraPostSlots:sql`${schema.blogs.extraPostSlots}+${input.slots}`}).where(eq(schema.blogs.id,blogId));
    return {slots:input.slots,cost,currency:input.currency,alreadyPurchased:false};
  });
}
