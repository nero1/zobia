import {createHash} from 'node:crypto';
import {z} from 'zod';
import {and,eq,inArray,ne,sql} from 'drizzle-orm';
import {getDb,schema,type DbOrTx} from '@/lib/db/drizzle';
import {badRequest,conflict,forbidden,notFound} from '@/lib/api/errors';
import {debitCoins} from '@/lib/economy/coins';
import {insertNotification} from '@/lib/notifications/insert';
import {enqueueTask} from '@/lib/tasks/outbox';
import {getManifestValue} from '@/lib/manifest';
import {awardMerchDigitalReferralCommission} from '@/lib/referrals/commissions';
import {creditCryptoBalance} from '@/lib/payments/crypto/payouts';
import type {CryptoCurrency} from '@zobia/types';

export const merchPurchaseInput=z.object({
 idempotencyKey:z.string().uuid(),expectedBuyerId:z.string().uuid(),
 shippingName:z.string().trim().max(200).optional(),shippingAddress:z.string().trim().max(500).optional(),
 shippingCity:z.string().trim().max(100).optional(),shippingCountry:z.string().trim().max(100).optional(),
 fulfillmentMethod:z.enum(['manual','partner']).optional(),
});
type Input=z.infer<typeof merchPurchaseInput>;
/** Stable private operation identity, scoped to the authenticated buyer. */
export function merchOrderIdentity(buyerId:string,key:string){
 const bytes=createHash('sha256').update(`merch-order:v1:${buyerId}:${key}`).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export async function settleMerchEarnings(tx:DbOrTx,order:typeof schema.merchOrders.$inferSelect){
 if(!order.creatorId)throw Error('Merch order is missing its seller');
 const gross=order.amountKobo??order.priceKobo??0n,net=order.creatorShareKobo??order.creatorNetKobo??0n;
 if(gross===0n&&net===0n)return;
 if(gross<0n||net<0n||net>gross||gross-net!==order.platformFeeKobo)throw Error('Invalid merch settlement quote');
 let native=false;
 if(order.paymentMethod==='crypto'){
  const [payment]=await tx.select().from(schema.payments).where(eq(schema.payments.providerReference,order.providerReference??''));
  if(!payment||payment.userId!==order.buyerId||payment.status!=='completed'||(payment.metadata as Record<string,unknown>|null)?.orderId!==order.id||!['JAGA','BNB','SOL'].includes(payment.tokenSymbol??'')||!payment.expectedTokenAmount||!/^\d+$/.test(payment.expectedTokenAmount))throw Error('Native merch payment proof is unavailable');
  native=(payment.metadata as Record<string,unknown>).nativeMerchSettlement===true;
  if(native)await creditCryptoBalance(tx,order.creatorId,payment.tokenSymbol as CryptoCurrency,BigInt(payment.expectedTokenAmount)*net/gross,'merch',`merch:${order.id}`,{orderId:order.id,paymentId:payment.id});
 }
 const [earning]=await tx.insert(schema.creatorEarnings).values({creatorId:order.creatorId,sourceType:'merch',grossAmountKobo:gross,netAmountKobo:net,platformFeeKobo:order.platformFeeKobo,referenceId:order.id}).onConflictDoNothing().returning({id:schema.creatorEarnings.id});
 if(earning&&!native)await tx.update(schema.users).set({availableEarningsKobo:sql`COALESCE(${schema.users.availableEarningsKobo},0)+${net}`,updatedAt:new Date()}).where(eq(schema.users.id,order.creatorId));
}
export async function purchaseMerchWithCredits(buyerId:string,productId:string,input:Input,expected:{creatorId?:string;storeId?:string}={},free=false){
 if(input.expectedBuyerId!==buyerId)throw forbidden('The signed-in account changed. Reopen checkout.','ACCOUNT_CHANGED');
 if(input.fulfillmentMethod==='partner')throw badRequest('Partner fulfillment is not available. Choose manual fulfillment.');
 const db=await getDb(),orderId=merchOrderIdentity(buyerId,input.idempotencyKey);
 return db.transaction(async tx=>{
  // Serialize a retry before any stock or wallet mutation, even after a lost response.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${orderId},46))`);
  const [seller]=await tx.select({creatorId:schema.merchStores.creatorId}).from(schema.merchProducts).innerJoin(schema.merchStores,eq(schema.merchStores.id,schema.merchProducts.storeId)).where(eq(schema.merchProducts.id,productId));
  if(!seller)throw notFound('Product not found');
  if(seller.creatorId===buyerId)throw forbidden('You cannot purchase your own merch');
  const accounts=await tx.select({id:schema.users.id,tier:schema.users.creatorTier,deletedAt:schema.users.deletedAt,isBanned:schema.users.isBanned,isSuspended:schema.users.isSuspended,suspendedUntil:schema.users.suspendedUntil,coinBalance:schema.users.coinBalance}).from(schema.users).where(inArray(schema.users.id,[buyerId,seller.creatorId])).orderBy(schema.users.id).for('update');
  const creator=accounts.find(row=>row.id===seller.creatorId),buyer=accounts.find(row=>row.id===buyerId);
  const [prior]=await tx.select().from(schema.merchOrders).where(eq(schema.merchOrders.id,orderId));
  if(prior){
   if(prior.buyerId!==buyerId||prior.productId!==productId||(expected.creatorId&&prior.creatorId!==expected.creatorId)||(expected.storeId&&prior.storeId!==expected.storeId)||prior.paymentMethod!==(free?'free':'coins')||['shippingName','shippingAddress','shippingCity','shippingCountry'].some(key=>(prior[key as keyof typeof prior]??null)!==(input[key as keyof Input]??null)))throw conflict('This checkout key belongs to a different purchase.');
   return receipt(prior,buyer?.coinBalance??0n,true);
  }
  if(!buyer||!creator||accounts.some(row=>row.deletedAt||row.isBanned||(row.isSuspended&&(!row.suspendedUntil||row.suspendedUntil.getTime()>Date.now()))))throw forbidden('The buyer or seller is unavailable');
  const [product]=await tx.select().from(schema.merchProducts).where(eq(schema.merchProducts.id,productId)).for('update');
  const [store]=product?await tx.select().from(schema.merchStores).where(eq(schema.merchStores.id,product.storeId)).for('share'):[];
  if(!product||!store||!product.isActive||!store.isActive||store.creatorId!==creator.id||(expected.creatorId&&store.creatorId!==expected.creatorId)||(expected.storeId&&store.id!==expected.storeId))throw notFound('Product is no longer available');
  const physical=product.productType==='physical';
  if(physical&&(!input.shippingName||!input.shippingAddress||!input.shippingCity||!input.shippingCountry))throw badRequest('Shipping name, address, city and country are required');
  if(product.stock!==null&&product.stock<=0)throw conflict('Product is out of stock');
  if(product.priceKobo<0n||product.priceKobo>BigInt(Number.MAX_SAFE_INTEGER))throw badRequest('Product has an unsupported price');
  if(!physical){const [owned]=await tx.select({id:schema.merchOrders.id}).from(schema.merchOrders).where(and(eq(schema.merchOrders.buyerId,buyerId),eq(schema.merchOrders.productId,productId),ne(schema.merchOrders.status,'refunded'),ne(schema.merchOrders.status,'awaiting_payment'))).limit(1);if(owned)throw conflict('You already own this digital product');}
  const gross=free?0n:product.priceKobo,net=gross*BigInt(creator.tier==='icon'?85:80)/100n,coins=(gross+99n)/100n;
  const [order]=await tx.insert(schema.merchOrders).values({id:orderId,productId,buyerId,creatorId:creator.id,storeId:store.id,amountKobo:gross,priceKobo:gross,creatorShareKobo:net,creatorNetKobo:net,platformFeeKobo:gross-net,paymentMethod:free?'free':'coins',status:physical?'pending':'completed',fulfillmentMethod:physical?'manual':null,shippingName:input.shippingName??null,shippingAddress:input.shippingAddress??null,shippingCity:input.shippingCity??null,shippingCountry:input.shippingCountry??null}).returning();
  if(coins>0n)await debitCoins(buyerId,Number(coins),'merch_purchase',order.id,`Merch purchase: ${product.name}`,{productId,storeId:store.id},tx);
  if(product.stock!==null)await tx.update(schema.merchProducts).set({stock:sql`${schema.merchProducts.stock}-1`,updatedAt:new Date()}).where(eq(schema.merchProducts.id,productId));
  if(!physical){
   await settleMerchEarnings(tx,order);
   if(gross>0n&&product.referralEnabled&&(await getManifestValue('market_referral_digital_enabled',tx))==='true')await awardMerchDigitalReferralCommission(tx,buyerId,Number(gross),order.id);
  }
  if(coins>0n)await enqueueTask(tx,'xp_award',`merch:${order.id}`,buyerId,{amount:50,track:'social',source:'merch_purchase',referenceId:order.id});
  await insertNotification(tx,creator.id,'new_merch_order','New merch order',`You have a new order for “${product.name}”.`,{orderId,productId,buyerId},orderId);
  return {...receipt(order,buyer.coinBalance-coins,false),productName:product.name,productType:product.productType};
 });
}
function receipt(order:typeof schema.merchOrders.$inferSelect,balance:bigint,reused:boolean){return {orderId:order.id,productId:order.productId,orderStatus:order.status,status:order.status,fulfillmentMethod:order.fulfillmentMethod,priceCoins:Number(((order.amountKobo??0n)+99n)/100n),priceKobo:Number(order.amountKobo??0n),creatorShareKobo:order.status==='completed'?Number(order.creatorShareKobo??0n):0,platformFeeKobo:order.status==='completed'?Number(order.platformFeeKobo):0,newCoinBalance:Number(balance),reused};}
