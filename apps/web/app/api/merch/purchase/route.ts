export const dynamic='force-dynamic';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {withAuth,validateBody} from '@/lib/api/middleware';
import {handleApiError} from '@/lib/api/errors';
import {enforceRateLimit,RATE_LIMITS} from '@/lib/security/rateLimit';
import {requireFeatureEnabled} from '@/lib/manifest';
import {enforcePaymentContext,getUserIsNigeria} from '@/lib/payments/contextSettings';
import {merchPurchaseInput,purchaseMerchWithCredits} from '@/lib/merch/purchase';
import {initializeMerchCheckout} from '@/lib/merch/checkout';
const inputSchema=merchPurchaseInput.extend({productId:z.string().uuid(),storeId:z.string().uuid(),paymentMethod:z.enum(['coins','paystack','crypto']),cryptoCurrency:z.enum(['JAGA','BNB','SOL']).optional()});
export const POST=withAuth(async(req:NextRequest,{auth})=>{
 try{
  await requireFeatureEnabled('merchStore');await enforceRateLimit(auth.user.sub,'user',RATE_LIMITS.apiWrite);
  const body=await validateBody(req,inputSchema),buyerId=auth.user.sub;
  if(body.paymentMethod==='coins')return NextResponse.json(await purchaseMerchWithCredits(buyerId,body.productId,body,{storeId:body.storeId}));
  const decision=await enforcePaymentContext('merch_purchase',await getUserIsNigeria(buyerId),body.paymentMethod,body.cryptoCurrency);
  if(decision.isFree)return NextResponse.json({...await purchaseMerchWithCredits(buyerId,body.productId,body,{storeId:body.storeId},true),free:true});
  return NextResponse.json(await initializeMerchCheckout(buyerId,body.productId,body.storeId,body,decision.provider,decision.cryptoCurrency));
 }catch(error){return handleApiError(error);}
});
