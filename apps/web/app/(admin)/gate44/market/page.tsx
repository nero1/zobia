"use client";

/**
 * app/(admin)/gate44/market/page.tsx
 *
 * Admin Market curation — search creator items and platform store items to
 * toggle their "Featured" flag (merch_products.is_admin_featured /
 * store_items.is_featured), and toggle a creator item's "Sponsored" flag
 * (merch_products.is_sponsored). Backs the Market page's Sponsored/Featured
 * sections (lib/market/query.ts).
 */

import { useState, useEffect, useCallback } from "react";

interface AdminProduct {
  id: string;
  name: string;
  product_type: string;
  price_kobo: string;
  is_active: boolean;
  is_sponsored: boolean;
  is_admin_featured: boolean;
  sponsored_until: string | null;
  creator_username: string;
}

interface AdminStoreItem {
  id: string;
  name: string;
  item_type: string;
  cosmetic_type: string | null;
  is_active: boolean;
  is_featured: boolean;
}

export default function AdminMarketPage() {
  const [tab, setTab] = useState<"creator" | "platform">("creator");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [items, setItems] = useState<AdminStoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "creator") {
        const res = await fetch(`/api/admin/market?q=${encodeURIComponent(query)}`, { credentials: "include" });
        const json = (await res.json()) as { data?: { products: AdminProduct[] } };
        setProducts(json.data?.products ?? []);
      } else {
        const res = await fetch(`/api/admin/store-items?q=${encodeURIComponent(query)}`, { credentials: "include" });
        const json = (await res.json()) as { data?: { items: AdminStoreItem[] } };
        setItems(json.data?.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  useEffect(() => { void load(); }, [load]);

  async function toggleProductFlag(id: string, field: "isAdminFeatured" | "isSponsored", value: boolean) {
    try {
      const res = await fetch(`/api/admin/market/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field === "isAdminFeatured" ? "is_admin_featured" : "is_sponsored"]: value } : p)));
      showToast("Updated");
    } catch {
      showToast("Failed to update", "error");
    }
  }

  async function toggleItemFeatured(id: string, value: boolean) {
    try {
      const res = await fetch(`/api/admin/store-items/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFeatured: value }),
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_featured: value } : i)));
      showToast("Updated");
    } catch {
      showToast("Failed to update", "error");
    }
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Market Curation</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab("creator")}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "creator" ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
        >
          Creator Items
        </button>
        <button
          onClick={() => setTab("platform")}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "platform" ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
        >
          Platform Items
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or creator username…"
        className="mb-4 w-full max-w-md rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      />

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {tab === "creator" ? (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                <th className="px-4 py-3 text-left font-semibold">Item</th>
                <th className="px-4 py-3 text-left font-semibold">Creator</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-center font-semibold">Featured</th>
                <th className="px-4 py-3 text-center font-semibold">Sponsored</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">No items found</td></tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">@{p.creator_username}</td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{p.product_type}</td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={p.is_admin_featured} onChange={(e) => toggleProductFlag(p.id, "isAdminFeatured", e.target.checked)} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={p.is_sponsored} onChange={(e) => toggleProductFlag(p.id, "isSponsored", e.target.checked)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                <th className="px-4 py-3 text-left font-semibold">Item</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-center font-semibold">Featured</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {loading ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-neutral-500">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-neutral-500">No items found</td></tr>
              ) : (
                items.map((i) => (
                  <tr key={i.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-neutral-100">{i.name}</td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{i.item_type}{i.cosmetic_type ? ` · ${i.cosmetic_type}` : ""}</td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={i.is_featured} onChange={(e) => toggleItemFeatured(i.id, e.target.checked)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
