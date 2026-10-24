import {badRequest} from "@/lib/api/errors";
import {and,eq,sql} from "drizzle-orm";
import {schema,type DbOrTx} from "@/lib/db/drizzle";
import {creditCryptoBalance} from "./crypto/payouts";
import type {CryptoCurrency} from "@zobia/types";

/** Restore the reserved asset once, in the same transaction as a terminal failure. */
export async function restorePayoutReservation(tx:DbOrTx,payoutId:string):Promise<boolean>{
 const [payout]=await tx.select().from(schema.creatorPayouts).where(eq(schema.creatorPayouts.id,payoutId)).for("update");
 if(!payout || payout.earningsRestored)return false;
 if(!["rejected","failed","cancelled"].includes(payout.status))throw new Error("Only a terminal unsuccessful payout can be refunded");
 if(payout.cryptoAmountBaseUnits!==null){
  if(!payout.cryptoCurrency || !["BNB","SOL","JAGA"].includes(payout.cryptoCurrency))throw new Error("Unsupported payout refund asset");
  const amount=BigInt(payout.cryptoAmountBaseUnits);
  if(amount<=0n)throw new Error("Invalid payout reservation");
  await creditCryptoBalance(tx,payout.creatorId,payout.cryptoCurrency as CryptoCurrency,amount,"payout_refund",`payout-refund:${payout.id}:${payout.reservationVersion}`,{payoutId});
 }else{
  const amount=payout.grossKobo??payout.netKobo??payout.amountKobo;
  if(amount<=0n)throw new Error("Invalid payout reservation");
  await tx.update(schema.users).set({availableEarningsKobo:sql`COALESCE(${schema.users.availableEarningsKobo},0)+${amount}`,updatedAt:new Date()}).where(eq(schema.users.id,payout.creatorId));
 }
 await tx.update(schema.creatorPayouts).set({earningsRestored:true,updatedAt:new Date()}).where(eq(schema.creatorPayouts.id,payoutId));
 return true;
}

/** A successful appeal creates a new reservation of the same immutable asset. */
export async function reserveAppealedPayout(tx:DbOrTx,payoutId:string):Promise<void>{
 const [payout]=await tx.select().from(schema.creatorPayouts).where(eq(schema.creatorPayouts.id,payoutId)).for("update");
 if(!payout || payout.status!=="rejected" || payout.appealStatus!=="pending" || !payout.earningsRestored)throw new Error("Payout appeal has no refundable reservation to reopen");
 if(payout.cryptoAmountBaseUnits!==null){
  if(!payout.cryptoCurrency || !["BNB","SOL","JAGA"].includes(payout.cryptoCurrency))throw new Error("Unsupported payout asset");
  const amount=BigInt(payout.cryptoAmountBaseUnits);
  if(amount<=0n)throw new Error("Invalid payout reservation");
  const updated=await tx.update(schema.creatorCryptoBalances).set({balanceBaseUnits:sql`${schema.creatorCryptoBalances.balanceBaseUnits}-${amount.toString()}::numeric`,updatedAt:new Date()})
   .where(and(eq(schema.creatorCryptoBalances.userId,payout.creatorId),eq(schema.creatorCryptoBalances.currency,payout.cryptoCurrency),sql`${schema.creatorCryptoBalances.balanceBaseUnits}>=${amount.toString()}::numeric`)).returning({userId:schema.creatorCryptoBalances.userId});
  if(!updated.length)throw badRequest("Insufficient original-asset balance to reopen the payout","INSUFFICIENT_PAYOUT_BALANCE");
  await tx.insert(schema.cryptoBalanceLedger).values({userId:payout.creatorId,currency:payout.cryptoCurrency,amountBaseUnits:(-amount).toString(),sourceType:"payout_reserve",referenceId:`payout-reserve:${payout.id}:${payout.reservationVersion+1}`,metadata:{payoutId}});
 }else{
  const amount=payout.grossKobo??payout.netKobo??payout.amountKobo;
  if(amount<=0n)throw new Error("Invalid payout reservation");
  const changed=await tx.update(schema.users).set({availableEarningsKobo:sql`${schema.users.availableEarningsKobo}-${amount}`,updatedAt:new Date()})
   .where(and(eq(schema.users.id,payout.creatorId),sql`${schema.users.availableEarningsKobo}>=${amount}`)).returning({id:schema.users.id});
  if(!changed.length)throw badRequest("Insufficient earnings to reopen the payout","INSUFFICIENT_PAYOUT_BALANCE");
 }
 await tx.update(schema.creatorPayouts).set({earningsRestored:false,reservationVersion:payout.reservationVersion+1,status:"awaiting_approval",updatedAt:new Date()}).where(eq(schema.creatorPayouts.id,payoutId));
}
