"use client";

/**
 * app/(app)/creator/merch/page.tsx
 *
 * Creator-side Merch Store management: create/update the store, toggle
 * physical goods, and add products (including the Market referral program
 * opt-in — PRD "Market" batch). Read-only order fulfillment lives on the
 * existing /api/merch/orders endpoints; this page only covers store/product
 * setup, which previously had no UI at all (products could only be created
 * by calling the API directly).
 *
 * Eligibility mirrors the API (lib/merch/eligibility.ts): Elite+ creators or
 * verified Business accounts. A 403 from the store endpoint renders an
 * explanatory empty state instead of a form.
 */

import { useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface StoreState {
  id: string;
  name: string;
  description: string;
  physicalGoodsEnabled: boolean;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  product_type: string;
  priceKobo: number;
  stock: number | null;
  is_active: boolean;
  referral_enabled: boolean;
  referralCommissionPct: number | null;
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

export default function CreatorMerchPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [ineligible, setIneligible] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [store, setStore] = useState<StoreState | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [storeForm, setStoreForm] = useState({ name: "", description: "" });
  const [savingStore, setSavingStore] = useState(false);

  const [productForm, setProductForm] = useState({
    name: "",
    description: "",
    product_type: "digital" as "digital" | "physical" | "course_material",
    price_kobo: "",
    stock: "",
    referral_enabled: false,
    referral_commission_pct: "",
  });
  const [savingProduct, setSavingProduct] = useState(false);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadStore() {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me", { credentials: "include" });
      const me = (await meRes.json()) as { user?: { id: string } };
      const uid = me.user?.id;
      if (!uid) { setLoading(false); return; }
      setUserId(uid);

      const storeRes = await fetch(`/api/merch/${uid}`, { credentials: "include" });
      if (storeRes.status === 404) {
        setStore(null);
        setProducts([]);
        setLoading(false);
        return;
      }
      if (storeRes.status === 403) {
        setIneligible(true);
        setLoading(false);
        return;
      }
      const json = (await storeRes.json()) as {
        data?: {
          store?: { id: string; name: string; description: string | null; physical_goods_enabled?: boolean };
          products?: ProductRow[];
        };
      };
      if (json.data?.store) {
        setStore({
          id: json.data.store.id,
          name: json.data.store.name,
          description: json.data.store.description ?? "",
          physicalGoodsEnabled: !!json.data.store.physical_goods_enabled,
        });
        setStoreForm({ name: json.data.store.name, description: json.data.store.description ?? "" });
        setProducts(json.data.products ?? []);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load your store", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveStore(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setSavingStore(true);
    try {
      const res = await fetch(`/api/merch/${userId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(storeForm),
      });
      if (!res.ok) {
        const errBody = (await res.json()) as { error?: { code?: string; message?: string } };
        const err = new Error(errBody.error?.message ?? "Failed to save store") as Error & { code?: string | null };
        err.code = errBody.error?.code ?? null;
        throw err;
      }
      showToast("Store saved!");
      await loadStore();
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(translateApiError(t, err.code, err.message || "Failed to save store"), "error");
    } finally {
      setSavingStore(false);
    }
  }

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    if (!store || !userId) return;
    setSavingProduct(true);
    try {
      const priceKobo = Math.round(parseFloat(productForm.price_kobo || "0") * 100);
      const body: Record<string, unknown> = {
        name: productForm.name,
        description: productForm.description || undefined,
        product_type: productForm.product_type,
        price_kobo: priceKobo,
        stock: productForm.stock ? parseInt(productForm.stock, 10) : null,
        referral_enabled: productForm.referral_enabled,
      };
      if (productForm.product_type === "physical" && productForm.referral_enabled) {
        body.referral_commission_pct = parseFloat(productForm.referral_commission_pct || "1");
      }

      const res = await fetch(`/api/merch/${userId}/products`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json()) as { error?: { code?: string; message?: string } };
        const err = new Error(errBody.error?.message ?? "Failed to add product") as Error & { code?: string | null };
        err.code = errBody.error?.code ?? null;
        throw err;
      }
      showToast(`${productForm.name} added!`);
      setProductForm({
        name: "",
        description: "",
        product_type: "digital",
        price_kobo: "",
        stock: "",
        referral_enabled: false,
        referral_commission_pct: "",
      });
      await loadStore();
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(translateApiError(t, err.code, err.message || "Failed to add product"), "error");
    } finally {
      setSavingProduct(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-neutral-500">Loading…</div>;
  }

  if (ineligible) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <span className="text-4xl">🔒</span>
        <p className="mt-3 font-semibold text-neutral-700 dark:text-neutral-300">Merch stores are for Elite+ creators and verified Business accounts</p>
        <p className="mt-1 text-sm text-neutral-500">Reach Elite tier or verify your Business account to open a store.</p>
        <Link href="/creator" className="mt-4 inline-block text-sm text-blue-600 hover:underline">← Creator dashboard</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">🛍️ My Merch Store</h1>
        {store && <Link href={`/merch/${store.id}`} className="text-sm text-blue-600 hover:underline">View public page →</Link>}
      </div>

      <form onSubmit={saveStore} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="font-semibold text-neutral-800 dark:text-neutral-200">Store details</p>
        <input
          value={storeForm.name}
          onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
          placeholder="Store name"
          required
          minLength={2}
          className={inputClass}
        />
        <textarea
          value={storeForm.description}
          onChange={(e) => setStoreForm({ ...storeForm, description: e.target.value })}
          placeholder="Description (optional)"
          rows={2}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={savingStore}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {savingStore ? "Saving…" : store ? "Update store" : "Create store"}
        </button>
      </form>

      {store && (
        <>
          <form onSubmit={addProduct} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="font-semibold text-neutral-800 dark:text-neutral-200">Add a product</p>
            <input
              value={productForm.name}
              onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
              placeholder="Product name"
              required
              minLength={2}
              className={inputClass}
            />
            <textarea
              value={productForm.description}
              onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
              placeholder="Description (optional)"
              rows={2}
              className={inputClass}
            />
            <div className="flex gap-2">
              <select
                value={productForm.product_type}
                onChange={(e) => setProductForm({ ...productForm, product_type: e.target.value as typeof productForm.product_type })}
                className={inputClass}
              >
                <option value="digital">Digital</option>
                <option value="physical">Physical</option>
                <option value="course_material">Course Material</option>
              </select>
              <input
                type="number"
                min="1"
                step="0.01"
                value={productForm.price_kobo}
                onChange={(e) => setProductForm({ ...productForm, price_kobo: e.target.value })}
                placeholder="Price (₦)"
                required
                className={inputClass}
              />
            </div>
            <input
              type="number"
              min="0"
              value={productForm.stock}
              onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
              placeholder="Stock (leave blank for unlimited)"
              className={inputClass}
            />

            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={productForm.referral_enabled}
                onChange={(e) => setProductForm({ ...productForm, referral_enabled: e.target.checked })}
              />
              Let other users earn a commission by referring this item
            </label>
            {productForm.referral_enabled && productForm.product_type === "physical" && (
              <div>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="0.01"
                  value={productForm.referral_commission_pct}
                  onChange={(e) => setProductForm({ ...productForm, referral_commission_pct: e.target.value })}
                  placeholder="Commission % (min 1%)"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-neutral-500">
                  This % of the sale price is set aside for referrals. The platform takes its standard cut of that amount; the rest goes to whoever referred the buyer.
                </p>
              </div>
            )}
            {productForm.referral_enabled && productForm.product_type !== "physical" && (
              <p className="text-xs text-neutral-500">
                Digital items use the platform&apos;s standard referral commission rate — no % to set.
              </p>
            )}

            <button
              type="submit"
              disabled={savingProduct}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {savingProduct ? "Adding…" : "Add product"}
            </button>
          </form>

          <div className="space-y-2">
            <p className="font-semibold text-neutral-800 dark:text-neutral-200">Your products ({products.length})</p>
            {products.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{p.name}</p>
                  <p className="text-xs text-neutral-500">
                    {p.product_type} · ₦{(p.priceKobo / 100).toLocaleString()}
                    {p.referral_enabled && (
                      <span className="ml-2 text-teal-600">
                        · referral {p.product_type === "physical" ? `${p.referralCommissionPct}%` : "on"}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
