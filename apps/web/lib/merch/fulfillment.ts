import {eq} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {badRequest,conflict,forbidden,notFound} from '@/lib/api/errors';
import {insertNotification} from '@/lib/notifications/insert';
export async function updateMerchFulfillment(sellerId:string,orderId:string,operation:'ship'|'deliver'|'tracking',body:{note?:string;useStepTracking?:boolean;idempotencyKey?:string}={}){
 if((body.note?.length??0)>500)throw badRequest('Tracking notes cannot exceed 500 characters');
 const db=await getDb();
 return db.transaction(async tx=>{
  const [order]=await tx.select().from(schema.merchOrders).where(eq(schema.merchOrders.id,orderId)).for('update');
  if(!order)throw notFound('Order not found');
  if(order.creatorId!==sellerId)throw forbidden('Only the seller can update this order');
  if(order.fulfillmentMethod===null)throw conflict('This digital order does not need shipping');
  const history=Array.isArray(order.trackingUpdates)?order.trackingUpdates as {id?:string;status:string;note:string;timestamp:string}[]:[];
  if(body.idempotencyKey&&history.some(entry=>entry.id===body.idempotencyKey))return {orderId,status:order.status,reused:true};
  let status=order.status,title:string,type:string,note:string;
  const update:Partial<typeof schema.merchOrders.$inferInsert>={updatedAt:new Date()};
  if(operation==='ship'){
   if(['shipped','in_transit','delivered','completed'].includes(order.status))return {orderId,status:order.status,reused:true};
   if(order.status!=='pending')throw conflict('Only a funded pending order can be shipped');
   status=body.useStepTracking?'shipped':'in_transit';note=body.note?.trim()||'Order shipped';title='Your order is on the way';type='order_shipped';
   update.status=status;update.shippedAt=new Date();
  }else if(operation==='deliver'){
   if(['delivered','completed'].includes(order.status))return {orderId,status:order.status,reused:true};
   if(!['shipped','in_transit'].includes(order.status))throw conflict('Order must be shipped before marking it delivered');
   status='delivered';note='Order delivered. Please confirm receipt.';title='Your order has arrived';type='order_delivered';update.status=status;update.deliveredAt=new Date();
  }else{
   if(order.status!=='shipped')throw conflict('Tracking updates require an order in shipped status');
   note=body.note?.trim()??'';if(!note)throw badRequest('A tracking note is required');title='Order tracking update';type='order_tracking_update';
  }
  if(operation==='tracking'&&history.length>=99)throw conflict('This order has reached its tracking-history limit');
  update.trackingUpdates=[...history.slice(-99),{...(body.idempotencyKey?{id:body.idempotencyKey}:{}),status:operation==='tracking'?'update':status,note,timestamp:new Date().toISOString()}];
  await tx.update(schema.merchOrders).set(update).where(eq(schema.merchOrders.id,orderId));
  await insertNotification(tx,order.buyerId,type,title,note,{orderId},`${orderId}:${operation}:${body.idempotencyKey??history.length}`);
  return {orderId,status,reused:false};
 });
}
