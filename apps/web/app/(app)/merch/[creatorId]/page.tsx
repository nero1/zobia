"use client";

/**
 * app/(app)/merch/[creatorId]/page.tsx
 *
 * Individual creator merch store.
 * Shows store name, description, product grid.
 * "Buy" button triggers purchase with coin deduction.
 * Shows confirmation modal before purchase.
 * Creator sees a settings panel if viewing their own store.
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  imageEmoji: string | null;
  priceCoin: number;
  stock: number | null; // null = unlimited
  isSoldOut: boolean;
}

interface MerchStore {
  creatorId: string;
  storeName: string;
  description: string | null;
  products: Product[];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ProductSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 h-32 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
      <div className="mb-2 h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mb-3 h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-9 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm purchase modal
// ---------------------------------------------------------------------------

interface ConfirmModalProps {
  product: Product;
  onConfirm: () => void;
  onCancel: () => void;
  buying: boolean;
}

function ConfirmModal({ product, onConfirm, onCancel, buying }: ConfirmModalProps) {
  const currency = useCurrency();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">Confirm Purchase</h3>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          You are about to buy <span className="font-semibold text-neutral-900 dark:text-neutral-100">{product.name}</span> for{" "}
          <span className="font-bold text-amber-600">🪙 {product.priceCoin.toLocaleString()} {currency.softPlural.toLowerCase()}</span>.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            disabled={buying}
            className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={buying}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {buying ? "Buying…" : "Confirm Buy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

interface ProductCardProps {
  product: Product;
  onBuy: (product: Product) => void;
}

function ProductCard({ product, onBuy }: ProductCardProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      {/* Image or emoji */}
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt={product.name}
          className="mb-3 h-32 w-full rounded-xl object-cover"
        />
      ) : (
        <div className="mb-3 flex h-32 items-center justify-center rounded-xl bg-neutral-100 text-5xl dark:bg-neutral-800">
          {product.imageEmoji ?? "🛍️"}
        </div>
      )}

      {/* Info */}
      <p className="mb-0.5 font-semibold text-neutral-900 dark:text-neutral-100">{product.name}</p>
      {product.description && (
        <p className="mb-2 line-clamp-2 text-xs text-neutral-500">{product.description}</p>
      )}

      {/* Stock */}
      {product.stock !== null && product.stock <= 5 && !product.isSoldOut && (
        <p className="mb-2 text-xs font-semibold text-red-600">Only {product.stock} left!</p>
      )}

      {/* Price + action */}
      <div className="mt-auto space-y-2">
        <p className="text-lg font-bold text-amber-600">🪙 {product.priceCoin.toLocaleString()}</p>
        {product.isSoldOut ? (
          <div className="rounded-xl bg-neutral-100 py-2 text-center text-sm font-semibold text-neutral-500 dark:bg-neutral-800">
            Sold Out
          </div>
        ) : (
          <button
            onClick={() => onBuy(product)}
            className="w-full rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Buy
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Individual creator merch store.
 */
export default function CreatorMerchStorePage() {
  const { creatorId } = useParams<{ creatorId: string }>();
  const { t } = useTranslation();

  const [store, setStore] = useState<MerchStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null);
  const [buying, setBuying] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        // NB: this used to fetch /api/merch/stores/:creatorId, which doesn't
        // exist — the real per-store endpoint is GET /api/merch/:creatorId
        // (envelope-wrapped, kobo pricing).
        const res = await fetch(`/api/merch/${creatorId}`, { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (res.status === 404) { setError("Store not found"); return; }
        if (!res.ok) throw new Error("Failed to load store");
        const json = (await res.json()) as {
          data?: {
            store?: { id: string; creator_id: string; name: string; description: string | null };
            products?: Array<{ id: string; name: string; description: string | null; image_url: string | null; priceKobo: number; stock: number | null }>;
          };
        };
        if (!json.data?.store) { setError("Store not found"); return; }
        setStore({
          creatorId: json.data.store.creator_id,
          storeName: json.data.store.name,
          description: json.data.store.description,
          products: (json.data.products ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            imageUrl: p.image_url,
            imageEmoji: null,
            priceCoin: Math.ceil(p.priceKobo / 100),
            stock: p.stock,
            isSoldOut: p.stock !== null && p.stock <= 0,
          })),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [creatorId]);

  async function handleBuy() {
    if (!confirmProduct) return;
    setBuying(true);
    try {
      const res = await fetch(`/api/merch/${creatorId}/products/${confirmProduct.id}/purchase`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        const err = new Error(body.error?.message ?? "Purchase failed") as Error & { code?: string | null };
        err.code = body.error?.code ?? null;
        throw err;
      }
      showToast(`You bought ${confirmProduct.name}!`);
      setConfirmProduct(null);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Purchase failed") : "Purchase failed", "error");
    } finally {
      setBuying(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <ProductSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <p className="text-neutral-500">{error ?? "Store not found"}</p>
        <Link href="/merch" className="mt-3 text-sm text-blue-600 hover:underline">← Back to Stores</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Confirm modal */}
      {confirmProduct && (
        <ConfirmModal
          product={confirmProduct}
          onConfirm={handleBuy}
          onCancel={() => setConfirmProduct(null)}
          buying={buying}
        />
      )}

      {/* Store header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-4xl dark:bg-neutral-800">
            🛍️
          </span>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{store.storeName}</h1>
          </div>
        </div>
        <Link href="/merch" className="shrink-0 text-sm text-neutral-500 hover:underline">← Stores</Link>
      </div>

      {/* Description */}
      {store.description && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{store.description}</p>
      )}

      {/* Products */}
      {store.products.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-neutral-200 bg-white py-16 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-5xl">📦</span>
          <p className="mt-3 font-semibold text-neutral-700 dark:text-neutral-300">No products yet</p>
          <p className="mt-1 text-sm text-neutral-500">This store hasn&apos;t added any products.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {store.products.map((product) => (
            <ProductCard key={product.id} product={product} onBuy={setConfirmProduct} />
          ))}
        </div>
      )}
    </div>
  );
}
