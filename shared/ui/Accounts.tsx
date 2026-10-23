"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TalesTransport } from "./Tales";

export interface AccountProduct {
  slug: string; name: string; description: string; kind: "personal" | "business";
  basePlan: string; monthlyPriceKobo: number; annualPriceKobo: number;
  playMonthlyProductId: string | null; playAnnualProductId: string | null;
  isActive: boolean; builtIn?: boolean; revision?: number;
}
interface Setting { key: string; value: string; description: string | null }
const field = "w-full rounded-lg border border-input bg-background p-2 text-foreground";
const button = "rounded-full border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50";
const panel = "rounded-xl border border-neutral-200 p-4 dark:border-neutral-700";
const empty: AccountProduct = { slug: "", name: "", description: "", kind: "personal", basePlan: "free", monthlyPriceKobo: 0, annualPriceKobo: 0, playMonthlyProductId: null, playAnnualProductId: null, isActive: false };
const personal = ["free", "plus", "pro", "max"];
const business = ["starter", "growth", "enterprise"];
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, s => s.toUpperCase());
const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "NGN" }).format(value / 100);
const productOrder = (a: AccountProduct, b: AccountProduct) => a.monthlyPriceKobo - b.monthlyPriceKobo || a.name.localeCompare(b.name);

export function AccountsPanel({ api }: { api: TalesTransport }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState<AccountProduct[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [draft, setDraft] = useState<AccountProduct>({ ...empty });
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [types, values] = await Promise.all([api.request<AccountProduct[]>("/admin/accounts"), api.request<Setting[]>("/admin/config")]);
      setProducts(types.sort(productOrder)); setSettings(values); setLoaded(true);
    } catch (e) { setError(e instanceof Error ? e.message : t("accountCatalog.failed", "Unable to load account settings")); }
    finally { setBusy(false); }
  }, [api, t]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => products.filter(p => `${p.name} ${p.slug} ${p.kind} ${p.basePlan}`.toLowerCase().includes(search.toLowerCase())), [products, search]);
  const tierSettings = useMemo(() => settings.filter(s => {
    const base = draft.basePlan;
    return (s.key.endsWith(`_${base}`) || s.key.startsWith(`${base}_`) || s.key.includes(`_${base}_`)) && `${s.key} ${s.description ?? ""}`.toLowerCase().includes(search.toLowerCase());
  }), [settings, draft.basePlan, search]);
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { builtIn: _builtIn, ...payload } = draft;
      // API responses contain timestamps too; send only editable fields.
      const saved = await api.request<AccountProduct>("/admin/accounts", "POST", {
        slug: payload.slug, name: payload.name, description: payload.description, kind: payload.kind, basePlan: payload.basePlan,
        monthlyPriceKobo: payload.monthlyPriceKobo, annualPriceKobo: payload.annualPriceKobo,
        playMonthlyProductId: payload.playMonthlyProductId || null, playAnnualProductId: payload.playAnnualProductId || null,
        isActive: payload.isActive, ...(payload.revision ? { revision: payload.revision } : {}),
      });
      setProducts(old => [...old.filter(p => p.slug !== saved.slug), saved].sort(productOrder)); setDraft(saved);
      setNotice(t("accountCatalog.saved", "Account type saved"));
    } catch (e) { setError(e instanceof Error ? e.message : t("accountCatalog.failed", "Unable to load account settings")); }
    finally { setBusy(false); }
  }
  async function saveSetting(setting: Setting) {
    setBusy(true); setError("");
    try {
      await api.request(`/admin/config/${encodeURIComponent(setting.key)}`, "PUT", { value: setting.value });
      setNotice(t("accountCatalog.settingSaved", "Entitlement setting saved"));
    } catch (e) { setError(e instanceof Error ? e.message : t("accountCatalog.failed", "Unable to load account settings")); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold">{t("accountCatalog.title", "Account settings")}</h1><button className={button} disabled={busy} onClick={() => void load()}>{t("common.refresh", "Refresh")}</button><button className={button} onClick={() => { setDraft({ ...empty }); setNotice(""); }}>{t("accountCatalog.create", "Create account type")}</button></div>
    <p className="text-sm text-neutral-500">{t("accountCatalog.intro", "Manage Free, paid and business account products. Products are listed by monthly cost. New products inherit the selected tier's feature gates and limits.")}</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}{notice && <p role="status">{notice}</p>}
    <input className={field} aria-label={t("accountCatalog.search", "Find an account type or setting")} placeholder={t("accountCatalog.search", "Find an account type or setting")} value={search} onChange={e => setSearch(e.target.value)} list="account-catalog-results" />
    <datalist id="account-catalog-results">{visible.slice(0,10).map(p => <option key={p.slug} value={p.name} />)}</datalist>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map(p => <button key={p.slug} className={`${panel} text-left ${draft.slug === p.slug ? "ring-2 ring-blue-500" : ""}`} onClick={() => { setDraft(p); setNotice(""); }}><strong>{p.name}</strong><p>{money(p.monthlyPriceKobo)} / {t("accountCatalog.month", "month")}</p><p className="text-sm text-neutral-500">{p.kind === "business" ? t("accountCatalog.business", "Business") : t("accountCatalog.personal", "Regular")} · {human(p.basePlan)} · {p.isActive ? t("accountCatalog.available", "Available") : t("accountCatalog.unavailable", "Unavailable")}</p></button>)}</div>
    {loaded && !visible.length && <p>{t("accountCatalog.noResults", "No matching account types")}</p>}
    <form className={`${panel} space-y-3`} onSubmit={e => { e.preventDefault(); void save(); }}>
      <h2 className="text-lg font-semibold">{draft.revision ? draft.name : t("accountCatalog.create", "Create account type")}</h2>
      <label className="block">{t("accountCatalog.name", "Display name")}<input required maxLength={80} className={field} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="block">{t("accountCatalog.identifier", "Identifier")}<input required pattern="[a-z][a-z0-9_]{1,47}" disabled={!!draft.revision} className={field} value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} /></label>
      <label className="block">{t("accountCatalog.kind", "Account kind")}<select disabled={!!draft.revision} className={field} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as "personal" | "business", basePlan: e.target.value === "business" ? "starter" : "free", monthlyPriceKobo: e.target.value === "business" ? 500000 : 0, annualPriceKobo: e.target.value === "business" ? 5000000 : 0 })}><option value="personal">{t("accountCatalog.personal", "Regular")}</option><option value="business">{t("accountCatalog.business", "Business")}</option></select></label>
      <label className="block">{t("accountCatalog.entitlements", "Entitlement tier")}<select disabled={!!draft.revision} className={field} value={draft.basePlan} onChange={e => { const base = products.find(p => p.builtIn && p.kind === draft.kind && p.basePlan === e.target.value); setDraft({ ...draft, basePlan: e.target.value, monthlyPriceKobo: base?.monthlyPriceKobo ?? 0, annualPriceKobo: base?.annualPriceKobo ?? 0 }); }}>{(draft.kind === "personal" ? personal : business).map(tier => <option key={tier} value={tier}>{human(tier)}</option>)}</select></label>
      <p className="text-sm text-neutral-500">{t("accountCatalog.inheritance", "Feature settings below apply to every product that inherits this tier. Create a different product to change its entitlement tier; existing purchases keep their original tier.")}</p>
      <label className="block">{t("accountCatalog.description", "Description")}<textarea maxLength={1000} className={field} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label className="block">{t("accountCatalog.monthlyPrice", "Monthly price (kobo)")}<input required type="number" min="0" max="100000000000" step="1" disabled={draft.basePlan === "free"} className={field} value={draft.monthlyPriceKobo} onChange={e => setDraft({ ...draft, monthlyPriceKobo: Number(e.target.value) })} /></label>
      {draft.kind === "personal" && <label className="block">{t("accountCatalog.annualPrice", "Annual price (kobo)")}<input required type="number" min="0" max="1200000000000" step="1" disabled={draft.basePlan === "free"} className={field} value={draft.annualPriceKobo} onChange={e => setDraft({ ...draft, annualPriceKobo: Number(e.target.value) })} /></label>}
      {draft.basePlan !== "free" && <><label className="block">{t("accountCatalog.playMonthly", "Google Play monthly product ID")}<input className={field} value={draft.playMonthlyProductId ?? ""} onChange={e => setDraft({ ...draft, playMonthlyProductId: e.target.value || null })} /></label>{draft.kind === "personal" && <label className="block">{t("accountCatalog.playAnnual", "Google Play annual product ID")}<input className={field} value={draft.playAnnualProductId ?? ""} onChange={e => setDraft({ ...draft, playAnnualProductId: e.target.value || null })} /></label>}<p className="text-sm text-neutral-500">{t("accountCatalog.storeSetup", "Create matching products in Play Console before enabling Android purchases. Store prices come from Google Play. Removed product IDs remain reserved for restoring previous purchases.")}</p></>}
      <label className="flex items-center gap-2"><input type="checkbox" disabled={draft.slug === "free"} checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />{t("accountCatalog.available", "Available")}</label>
      <button className={button} disabled={busy} type="submit">{t("common.save", "Save")}</button>
    </form>
    <section className={`${panel} space-y-3`}><h2 className="font-semibold">{t("accountCatalog.tierSettings", "Tier features and limits")} — {human(draft.basePlan)}</h2>
      {tierSettings.map(setting => <div key={setting.key} className="border-b border-neutral-200 pb-3 dark:border-neutral-700"><label className="block font-medium" htmlFor={`setting-${setting.key}`}>{human(setting.key)}</label><p className="text-sm text-neutral-500">{setting.description}</p><div className="flex gap-2 mt-2">{["true","false"].includes(setting.value) ? <input id={`setting-${setting.key}`} type="checkbox" checked={setting.value === "true"} onChange={e => setSettings(old => old.map(s => s.key === setting.key ? { ...s, value: String(e.target.checked) } : s))} /> : <input id={`setting-${setting.key}`} className={field} value={setting.value} onChange={e => setSettings(old => old.map(s => s.key === setting.key ? { ...s, value: e.target.value } : s))} />}<button className={button} disabled={busy} onClick={() => void saveSetting(setting)}>{t("common.save", "Save")}</button></div></div>)}
      {!tierSettings.length && <p>{t("accountCatalog.noSettings", "No matching configurable limits for this tier")}</p>}
    </section>
  </div>;
}

/** Additional account products share the existing checkout and store adapters. */
export function AccountProductPicker({ api, kind, store = false, catalog, storePrice, buy }: { api: TalesTransport; kind: "personal" | "business"; store?: boolean; catalog?: AccountProduct[]; storePrice?: (id: string) => string | undefined; buy: (product: AccountProduct, interval: "monthly" | "annual") => Promise<void> }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState<AccountProduct[]>([]);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => { if (catalog) { setProducts(catalog.filter(p => p.kind === kind && !p.builtIn).sort(productOrder)); return; } let live = true; api.request<AccountProduct[]>("/accounts/catalog").then(rows => { if (live) setProducts(rows.filter(p => p.kind === kind && !p.builtIn).sort(productOrder)); }).catch(e => { if (live) setError(e instanceof Error ? e.message : t("accountCatalog.failed", "Unable to load account settings")); }); return () => { live = false; }; }, [api, kind, t, catalog]);
  if (!products.length && !error) return null;
  return <section className="space-y-3"><h2 className="text-lg font-semibold">{t("accountCatalog.otherProducts", "More account types")}</h2>{error && <p role="alert" className="text-red-600">{error}</p>}{kind === "personal" && <label>{t("accountCatalog.billingPeriod", "Billing period")}<select className={field} value={interval} onChange={e => setInterval(e.target.value as "monthly" | "annual")}><option value="monthly">{t("accountCatalog.monthly", "Monthly")}</option><option value="annual">{t("accountCatalog.annual", "Annual")}</option></select></label>}
    <div className="grid gap-3 sm:grid-cols-2">{[...products].sort((a,b) => (interval === "annual" ? a.annualPriceKobo - b.annualPriceKobo : a.monthlyPriceKobo - b.monthlyPriceKobo)).map(product => {
      const available = !store || product.basePlan === "free" || !!(interval === "monthly" ? product.playMonthlyProductId : product.playAnnualProductId);
      const storeId = interval === "monthly" ? product.playMonthlyProductId : product.playAnnualProductId;
      return <article className={panel} key={product.slug}><h3 className="font-semibold">{product.name}</h3><p>{product.description}</p><p className="text-sm text-neutral-500">{t("accountCatalog.includes", "Includes {{tier}} features", { tier: human(product.basePlan) })}</p><p>{store && product.basePlan !== "free" ? (storeId && storePrice?.(storeId)) || t("accountCatalog.storePrice", "Review the price in Google Play before confirming") : money(interval === "monthly" ? product.monthlyPriceKobo : product.annualPriceKobo)}</p><button className={button} disabled={!!busy || !available} onClick={async () => { setBusy(product.slug); setError(""); try { await buy(product, interval); } catch (e) { setError(e instanceof Error ? e.message : t("accountCatalog.purchaseFailed", "Unable to select this account type")); } finally { setBusy(undefined); } }}>{available ? t("accountCatalog.select", "Select account type") : t("accountCatalog.storeUnavailable", "Not available in this store yet")}</button></article>;
    })}</div>
  </section>;
}
