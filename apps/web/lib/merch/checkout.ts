import {and,eq,inArray,ne,sql} from 'drizzle-orm';
import {getDb,schema,type DbOrTx} from '@/lib/db/drizzle';
import {badRequest,conflict,forbidden,notFound} from '@/lib/api/errors';
import {initializePayment} from '@/lib/payments';
import {storedCryptoQuote} from '@/lib/payments/crypto/storedQuote';
import {applyCryptoComputedAmount} from '@/lib/payments/crypto';
import {merchOrderIdentity,merchPurchaseInput,settleMerchEarnings} from './purchase';
import {enqueueTask} from '@/lib/tasks/outbox';
import {insertNotification} from '@/lib/notifications/insert';
import {getManifestValue} from '@/lib/manifest';
import {awardMerchDigitalReferralCommission} from '@/lib/referrals/commissions';
import type {z} from 'zod';
type Input=z.infer<typeof merchPurchaseInput>;
/** Inventory is consumed only by verified settlement, never abandoned checkouts. */
export async function initializeMerchCheckout(buyerId:string,productId:string,storeId:string,input:Input,provider:'paystack'|'crypto',cryptoCurrency?:'JAGA'|'BNB'|'SOL'){
 if(input.expectedBuyerId!==buyerId)throw forbidden('The signed-in account changed. Reopen checkout.','ACCOUNT_CHANGED');
 if(input.fulfillmentMethod==='partner')throw badRequest('Partner fulfillment is not available. Choose manual fulfillment.');
 const db=await getDb(),orderId=merchOrderIdentity(buyerId,input.idempotencyKey),reference=`merch-${orderId}`;
 const payment=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${orderId},46))`);
  const [prior]=await tx.select().from(schema.merchOrders).where(eq(schema.merchOrders.id,orderId));
  const [existing]=await tx.select().from(schema.payments).where(eq(schema.payments.idempotencyKey,reference));
  if(prior){
   if(!existing||prior.productId!==productId||prior.storeId!==storeId||prior.buyerId!==buyerId||prior.paymentMethod!==provider||(existing.metadata as Record<string,unknown>)?.cryptoCurrency!==cryptoCurrency||['shippingName','shippingAddress','shippingCity','shippingCountry'].some(key=>(prior[key as keyof typeof prior]??null)!==(input[key as keyof Input]??null)))throw conflict('This checkout key belongs to a different purchase.');
   return existing;
  }
  const [initialStore]=await tx.select().from(schema.merchStores).where(eq(schema.merchStores.id,storeId));
  if(!initialStore)throw notFound('Store not found');
  if(initialStore.creatorId===buyerId)throw forbidden('You cannot purchase your own merch');
  const accounts=await tx.select().from(schema.users).where(inArray(schema.users.id,[buyerId,initialStore.creatorId])).orderBy(schema.users.id).for('update');
  const creator=accounts.find(row=>row.id===initialStore.creatorId),buyer=accounts.find(row=>row.id===buyerId);
  if(!creator||!buyer||accounts.some(row=>row.deletedAt||row.isBanned||(row.isSuspended&&(!row.suspendedUntil||row.suspendedUntil.getTime()>Date.now()))))throw forbidden('The buyer or seller is unavailable');
  const [product]=await tx.select().from(schema.merchProducts).where(and(eq(schema.merchProducts.id,productId),eq(schema.merchProducts.storeId,storeId))).for('update');
  const [store]=await tx.select().from(schema.merchStores).where(eq(schema.merchStores.id,storeId)).for('share');
  if(!product?.isActive||!store?.isActive||store.creatorId!==creator.id)throw notFound('Product is no longer available');
  if(product.stock!==null&&product.stock<=0)throw conflict('Product is out of stock');
  if(product.priceKobo<=0n||product.priceKobo>BigInt(Number.MAX_SAFE_INTEGER))throw badRequest('Product has an unsupported checkout price');
  const physical=product.productType==='physical';
  if(physical&&(!input.shippingName||!input.shippingAddress||!input.shippingCity||!input.shippingCountry))throw badRequest('Shipping name, address, city and country are required');
  const [owned]=!physical?await tx.select({id:schema.merchOrders.id}).from(schema.merchOrders).where(and(eq(schema.merchOrders.buyerId,buyerId),eq(schema.merchOrders.productId,productId),ne(schema.merchOrders.status,'refunded'),ne(schema.merchOrders.status,'awaiting_payment'))).limit(1):[];
  if(owned)throw conflict('You already own this digital product');
  const gross=product.priceKobo,net=gross*BigInt(creator.creatorTier==='icon'?85:80)/100n;
  await tx.insert(schema.merchOrders).values({id:orderId,productId,storeId,buyerId,creatorId:creator.id,amountKobo:gross,priceKobo:gross,creatorShareKobo:net,creatorNetKobo:net,platformFeeKobo:gross-net,status:'awaiting_payment',paymentMethod:provider,providerReference:reference,fulfillmentMethod:physical?'manual':null,shippingName:input.shippingName??null,shippingAddress:input.shippingAddress??null,shippingCity:input.shippingCity??null,shippingCountry:input.shippingCountry??null});
  const nativeMerchSettlement=provider==='crypto'&&['true','1'].includes((await getManifestValue('crypto_payouts_enabled',tx))??'')&&(await getManifestValue('crypto_payout_mode',tx))==='crypto';
  const [intent]=await tx.insert(schema.payments).values({userId:buyerId,paymentType:'merch_purchase',provider,amountKobo:gross,currency:'NGN',status:'pending',idempotencyKey:reference,providerReference:reference,metadata:{userId:buyerId,itemType:'merch_purchase',orderId,productId,storeId,packId:productId,packName:product.name,physical,cryptoCurrency,nativeMerchSettlement,email:buyer.email??`${buyer.username}@zobia.app`}}).returning();
  return intent;
 });
 const result=async()=>{
  const [current]=await db.select().from(schema.payments).where(eq(schema.payments.id,payment.id));
  const [order]=await db.select({status:schema.merchOrders.status}).from(schema.merchOrders).where(eq(schema.merchOrders.id,orderId));
  const metadata=current.metadata as Record<string,unknown>;
  return {orderId,status:order.status,paymentUrl:metadata.payment_url??null,providerReference:reference,paymentReference:reference,crypto:provider==='crypto'?storedCryptoQuote(current):undefined};
 };
 const metadata=payment.metadata as Record<string,unknown>;
 if(metadata.payment_url||(provider==='crypto'&&storedCryptoQuote(payment))||payment.status==='completed')return result();
 const claim=await db.update(schema.payments).set({status:'processing',updatedAt:new Date()}).where(and(eq(schema.payments.id,payment.id),sql`(${schema.payments.status}='pending' OR (${schema.payments.status}='processing' AND ${schema.payments.updatedAt}<NOW()-INTERVAL '30 seconds'))`)).returning({id:schema.payments.id});
 if(!claim.length)throw conflict('Checkout is initializing. Retry with the same purchase key.','CHECKOUT_INITIALIZING');
 try{
  const initialized=await initializePayment(Number(payment.amountKobo),'NGN',String(metadata.email),reference,metadata,`${process.env.NEXT_PUBLIC_APP_URL??'https://zobia.app'}/economy/purchase/callback`,provider);
  if(initialized.providerReference!==reference)throw Error('Payment provider changed the checkout reference');
  if(provider==='crypto')await applyCryptoComputedAmount(payment.id,initialized.raw);
  await db.update(schema.payments).set({status:sql`CASE WHEN ${schema.payments.status}='processing' THEN 'pending' ELSE ${schema.payments.status} END`,metadata:sql`COALESCE(${schema.payments.metadata},'{}'::jsonb)||${JSON.stringify({payment_url:initialized.paymentUrl})}::jsonb`,updatedAt:new Date()}).where(eq(schema.payments.id,payment.id));
  return result();
 }catch(error){await db.update(schema.payments).set({status:'pending',updatedAt:new Date()}).where(and(eq(schema.payments.id,payment.id),eq(schema.payments.status,'processing')));throw error;}
}

/** Called inside the verified payment transaction; failures retain the durable inbox event. */
export async function fulfillMerchPayment(tx:DbOrTx,paymentId:string,orderId:string,buyerId:string){
 const [candidate]=await tx.select().from(schema.merchOrders).where(eq(schema.merchOrders.id,orderId));
 if(!candidate?.creatorId||candidate.buyerId!==buyerId)throw Error('Merch payment order does not match buyer');
 await tx.select({id:schema.users.id}).from(schema.users).where(inArray(schema.users.id,[buyerId,candidate.creatorId])).orderBy(schema.users.id).for('update');
 const [order]=await tx.select().from(schema.merchOrders).where(eq(schema.merchOrders.id,orderId)).for('update');
 if(!order||order.buyerId!==buyerId||!order.creatorId)throw Error('Merch payment order does not match buyer');
 if(order.status!=='awaiting_payment')throw Error('Merch order is not awaiting payment');
 const [payment]=await tx.select().from(schema.payments).where(eq(schema.payments.id,paymentId));
 if(!payment||payment.providerReference!==order.providerReference)throw Error('Merch payment reference does not match order');
 const metadata=payment.metadata as Record<string,unknown>;
 const [product]=await tx.select().from(schema.merchProducts).where(eq(schema.merchProducts.id,order.productId)).for('update');
 if(!product||product.stock!==null&&product.stock<=0)throw Error('Paid merch order needs stock or refund review');
 if(metadata.physical!==true){
  const [owned]=await tx.select({id:schema.merchOrders.id}).from(schema.merchOrders).where(and(eq(schema.merchOrders.buyerId,buyerId),eq(schema.merchOrders.productId,order.productId),inArray(schema.merchOrders.status,['pending','shipped','in_transit','delivered','completed']))).limit(1);
  if(owned)throw Error('Duplicate paid digital order needs refund review');
 }
 if(product.stock!==null)await tx.update(schema.merchProducts).set({stock:sql`${schema.merchProducts.stock}-1`,updatedAt:new Date()}).where(eq(schema.merchProducts.id,product.id));
 await tx.update(schema.merchOrders).set({status:metadata.physical===true?'pending':'completed',updatedAt:new Date()}).where(eq(schema.merchOrders.id,order.id));
 if(metadata.physical!==true){
  await settleMerchEarnings(tx,order);
  if(product.referralEnabled&&(await getManifestValue('market_referral_digital_enabled',tx))==='true')await awardMerchDigitalReferralCommission(tx,buyerId,Number(order.amountKobo??0n),order.id);
 }
 await enqueueTask(tx,'xp_award',`merch:${order.id}`,buyerId,{amount:50,track:'social',source:'merch_purchase',referenceId:order.id});
 await insertNotification(tx,order.creatorId,'new_merch_order','New paid merch order',`A payment for “${String(metadata.packName)}” was verified.`,{orderId:order.id,productId:order.productId,buyerId},order.id);
}
