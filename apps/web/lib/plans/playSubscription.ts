import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest, conflict } from "@/lib/api/errors";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { findPlayAccountType } from "./catalog";
import { acknowledgeGooglePlaySubscription, cancelGooglePlaySubscription, consumeGooglePlayPurchase, verifyGooglePlayProductPurchase, verifyGooglePlaySubscriptionPurchase } from "@/lib/payments/googlePlayVerify";
import { insertNotification } from "@/lib/notifications/insert";

async function verifyPeriod(kind: "personal" | "business", packageName: string, productId: string, purchaseToken: string) {
  const product = await findPlayAccountType(productId, kind);
  if (!product || product.basePlan === "free") throw badRequest("Unknown subscription product", "UNKNOWN_PRODUCT");
  const verified = await verifyGooglePlaySubscriptionPurchase(packageName, productId, purchaseToken);
  const expiry = Number(verified.expiryTimeMillis), start = Number(verified.startTimeMillis);
  const paid = [1,2].includes(verified.paymentState ?? -1) || (verified.paymentState == null && verified.cancelReason != null);
  if (!paid || !Number.isSafeInteger(expiry) || !Number.isSafeInteger(start) || expiry <= Date.now() || start <= 0 || start > expiry) throw badRequest("Subscription is unpaid or expired", "SUBSCRIPTION_NOT_PAID");
  return { product, verified, expiry, start, tokenHash: createHash("sha256").update(purchaseToken).digest("hex") };
}

/** Caller locks the user first. Hash lock also serializes competing users who
 * submit the same token, without storing tokens in the receipt registry. */
async function claimReceipt(tx: DbOrTx, userId: string, productId: string, purchaseToken: string, tokenHash: string, expiry: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`play:${tokenHash}`},0))`);
  const [receipt] = await tx.select().from(schema.playPurchaseReceipts).where(eq(schema.playPurchaseReceipts.tokenHash, tokenHash)).for("update");
  if (receipt && (receipt.userId !== userId || receipt.productId !== productId)) throw conflict("Purchase already belongs to another account or product", "PURCHASE_ALREADY_CLAIMED");
  const [legacyCoin] = await tx.select({ userId: schema.coinLedger.userId }).from(schema.coinLedger).where(eq(schema.coinLedger.referenceId, `iap:sub:${purchaseToken}`)).limit(1);
  const [legacyBusiness] = await tx.select({ userId: schema.payments.userId }).from(schema.payments).where(eq(schema.payments.idempotencyKey, `play:biz:${purchaseToken}`)).limit(1);
  const [legacyPack] = await tx.select({ userId: schema.coinLedger.userId }).from(schema.coinLedger).where(eq(schema.coinLedger.referenceId, `iap:${purchaseToken}`)).limit(1);
  const [legacyStars] = await tx.select({ userId: schema.starLedger.userId }).from(schema.starLedger).where(eq(schema.starLedger.referenceId, `iap:${purchaseToken}`)).limit(1);
  if ([legacyCoin, legacyBusiness, legacyPack, legacyStars].some(row => row && row.userId !== userId)) throw conflict("Purchase already belongs to another account", "PURCHASE_ALREADY_CLAIMED");
  await tx.insert(schema.playPurchaseReceipts).values({ tokenHash, userId, productId, expiresAt: new Date(expiry) }).onConflictDoUpdate({ target: schema.playPurchaseReceipts.tokenHash, set: { expiresAt: sql`GREATEST(${schema.playPurchaseReceipts.expiresAt}, ${new Date(expiry)})`, updatedAt: new Date() } });
  return { receipt, legacy: !!legacyCoin || !!legacyBusiness || !!legacyPack || !!legacyStars };
}

/** Google remains the authority for the expiry, including restored/renewed
 * purchases. Provider calls stay outside the wallet/subscription transaction. */
export async function activatePlaySubscription(userId: string, packageName: string, productId: string, purchaseToken: string) {
  const { product, verified, expiry, start, tokenHash } = await verifyPeriod("personal", packageName, productId, purchaseToken);
  const orm = await getDb();
  let priorToken: string | null = null;
  let priorProduct: string | null = null;
  const result = await orm.transaction(async tx => {
    const [user] = await tx.select({ id: schema.users.id, plan: schema.users.plan }).from(schema.users).where(eq(schema.users.id, userId)).for("no key update");
    if (!user) throw badRequest("User not found");
    const { receipt, legacy } = await claimReceipt(tx, userId, productId, purchaseToken, tokenHash, expiry);
    const [current] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId)).for("update");
    const staleRestore = current && current.providerSubscriptionId !== purchaseToken && current.startsAt.getTime() > start && current.endsAt.getTime() > Date.now();
    if (staleRestore) return { plan: user.plan, coinsGranted: 0 };
    if (current?.provider === "google_play" && current.providerSubscriptionId && current.providerSubscriptionId !== purchaseToken) {
      const oldHash = createHash("sha256").update(current.providerSubscriptionId).digest("hex");
      const [old] = await tx.select().from(schema.playPurchaseReceipts).where(eq(schema.playPurchaseReceipts.tokenHash, oldHash)).limit(1);
      priorToken = current.providerSubscriptionId;
      priorProduct = old?.productId ?? null;
    }
    const values = {
      plan: product.basePlan, accountTypeSlug: product.slug, billingPeriod: product.interval,
      status: "active", provider: "google_play", providerSubscriptionId: purchaseToken,
      startsAt: new Date(start), endsAt: new Date(expiry), autoRenew: verified.autoRenewing ?? false,
      cancelledAt: verified.autoRenewing === false ? new Date() : null, gracePeriodEndsAt: null, updatedAt: new Date(),
    };
    await tx.insert(schema.subscriptions).values({ userId, ...values }).onConflictDoUpdate({ target: schema.subscriptions.userId, set: values });
    await tx.update(schema.users).set({ plan: product.basePlan, accountTypeSlug: product.slug, planActivatedAt: new Date(start), updatedAt: new Date() }).where(eq(schema.users.id, userId));
    const coins = ({ plus: 50, pro: 200, max: 500 } as Record<string,number>)[product.basePlan] ?? 0;
    const freshPeriod = !legacy && (!receipt || expiry > receipt.expiresAt.getTime());
    let granted = 0;
    if (coins > 0 && freshPeriod) {
      const reference = `plan:${userId}:${new Date().toISOString().slice(0,7)}`;
      const [paid] = await tx.select({ id: schema.coinLedger.id }).from(schema.coinLedger).where(eq(schema.coinLedger.referenceId, reference)).limit(1);
      if (!paid) {
        await creditCoins(userId, coins, "subscription_bonus", reference, "Google Play monthly plan bonus", { productId, accountTypeSlug: product.slug }, tx);
        granted = coins;
      }
    }
    return { plan: product.basePlan, coinsGranted: granted };
  });
  await acknowledgeGooglePlaySubscription(packageName, productId, purchaseToken);
  if (priorToken && priorProduct) await cancelGooglePlaySubscription(packageName, priorProduct, priorToken);
  return result;
}

export async function activatePlayBusiness(userId: string, packageName: string, productId: string, purchaseToken: string, signup: { business_name?: string; business_type?: string }) {
  const { product, expiry, start, tokenHash } = await verifyPeriod("business", packageName, productId, purchaseToken);
  const orm = await getDb();
  const result = await orm.transaction(async tx => {
    const [user] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for("no key update");
    if (!user) throw badRequest("User not found");
    const { receipt, legacy } = await claimReceipt(tx, userId, productId, purchaseToken, tokenHash, expiry);
    const [account] = await tx.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.userId, userId)).for("update");
    if (!account && !signup.business_name) throw badRequest("A business name is required", "BUSINESS_NAME_REQUIRED");
    // Restoring an older purchase must not replace a newer account product.
    if (account?.accountTypeSlug !== product.slug && account?.tierUpdatedAt && account.tierUpdatedAt.getTime() > start && account.currentPeriodEndsAt && account.currentPeriodEndsAt.getTime() > Date.now()) return { tier: account.tier };
    const values = { tier: product.basePlan, accountTypeSlug: product.slug, status: "active", currentPeriodEndsAt: new Date(expiry), gracePeriodEndsAt: null, pendingTier: null, pendingAccountTypeSlug: null, pendingPaymentRef: null, downgradeToTier: null, downgradeAccountTypeSlug: null, downgradeEffectiveAt: null, tierUpdatedAt: new Date(start), updatedAt: new Date() };
    const [saved] = account
      ? await tx.update(schema.businessAccounts).set(values).where(eq(schema.businessAccounts.id, account.id)).returning()
      : await tx.insert(schema.businessAccounts).values({ userId, businessName: signup.business_name!, businessType: signup.business_type ?? null, ...values }).returning();
    if (!legacy && (!receipt || expiry > receipt.expiresAt.getTime())) {
      const reference = `play:biz:${tokenHash}:${expiry}`;
      await tx.insert(schema.payments).values({ userId, paymentType: "business_upgrade", amountKobo: BigInt(product.monthlyPriceKobo), currency: "NGN", provider: "google_play", status: "completed", idempotencyKey: reference, providerReference: reference, metadata: { itemType: account ? "business_upgrade" : "business_signup", businessAccountId: saved.id, tier: product.basePlan, accountTypeSlug: product.slug, productId, verifiedExpiry: new Date(expiry).toISOString() }, completedAt: new Date() }).onConflictDoNothing({ target: schema.payments.idempotencyKey });
      await insertNotification(tx, userId, "business_tier_activated", "Business account activated", `Your ${product.name} account is active.`, { businessAccountId: saved.id, tier: product.basePlan }, reference);
    }
    return { tier: product.basePlan };
  });
  await acknowledgeGooglePlaySubscription(packageName, productId, purchaseToken);
  return result;
}

/** A token is globally claimed before either ledger is credited. Per-user
 * ledger uniqueness alone cannot prevent a replay into a different wallet. */
export async function activatePlayConsumable(userId: string, packageName: string, productId: string, purchaseToken: string, coins: number, stars: number) {
  const verified = await verifyGooglePlayProductPurchase(packageName, productId, purchaseToken);
  if (verified.purchaseState !== 0) throw badRequest("Purchase is not in a valid state", "PURCHASE_INVALID");
  const tokenHash = createHash("sha256").update(purchaseToken).digest("hex");
  const orm = await getDb();
  const result = await orm.transaction(async tx => {
    const [user] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for("no key update");
    if (!user) throw badRequest("User not found");
    const { receipt, legacy } = await claimReceipt(tx, userId, productId, purchaseToken, tokenHash, Date.now());
    if (receipt || legacy) return { coinsGranted: 0, starsGranted: 0 };
    if (verified.consumptionState !== 0) throw conflict("This purchase has already been consumed", "PURCHASE_ALREADY_PROCESSED");
    const reference = `iap:${tokenHash}`;
    if (coins > 0) await creditCoins(userId, coins, "iap_purchase", reference, `Google Play: ${productId}`, { productId, orderId: verified.orderId }, tx);
    if (stars > 0) await creditStars(userId, stars, "purchase", reference, `Google Play: ${productId}`, tx);
    return { coinsGranted: coins, starsGranted: stars };
  });
  await consumeGooglePlayPurchase(packageName, productId, purchaseToken);
  return result;
}
