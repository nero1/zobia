/**
 * apps/android/src/routes/merch/$creatorId.tsx
 *
 * Individual creator merch store — mirrors apps/web/app/(app)/merch/
 * [creatorId]/page.tsx: product grid, buy confirmation modal.
 *
 * CONTRACT FIX (see report): the web page called GET /api/merch/stores/:id
 * and POST /api/merch/stores/:id/products/:pid/buy, neither of which exist —
 * the real endpoints are GET /api/merch/:creatorId and POST /api/merch/
 * :creatorId/products/:productId/purchase (fixed in the same commit). Prices
 * are stored in kobo server-side; the purchase endpoint itself converts to
 * coins (kobo / 100), so this page mirrors that conversion for display.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess } from '@/lib/hooks/useManifest';
import { FeatureNotFound } from '@/components/shared/FeatureNotFound';

interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCoin: number;
  stock: number | null;
  isSoldOut: boolean;
  productType: string;
}

interface MerchStore {
  creatorId: string;
  storeName: string;
  description: string | null;
  products: Product[];
}

async function fetchStore(creatorId: string): Promise<MerchStore> {
  const { data } = await apiClient.get<{
    store: { id: string; creator_id: string; name: string; description: string | null };
    products: Array<{ id: string; name: string; description: string | null; image_url: string | null; priceKobo: number; stock: number | null; product_type: string }>;
  }>(`/merch/${creatorId}`);
  return {
    creatorId: data.store.creator_id,
    storeName: data.store.name,
    description: data.store.description,
    products: (data.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      imageUrl: p.image_url,
      priceCoin: Math.ceil(p.priceKobo / 100),
      stock: p.stock,
      isSoldOut: p.stock !== null && p.stock <= 0,
      productType: p.product_type,
    })),
  };
}

function CreatorMerchStorePage() {
  const { creatorId } = Route.useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();
  const access = resolveFeatureAccess(
    featureFlags?.merchStore !== false,
    modVisibleKeys.includes('merchStore'),
    { isAdmin: user?.is_admin, isModerator: user?.is_moderator }
  );
  const qc = useQueryClient();
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [shippingName, setShippingName] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [shippingCity, setShippingCity] = useState('');
  const [shippingCountry, setShippingCountry] = useState('');

  const isPhysical = confirmProduct?.productType === 'physical';
  const shippingComplete = !isPhysical || (shippingName.trim() && shippingAddress.trim() && shippingCity.trim() && shippingCountry.trim());

  const { data: store, status } = useQuery({ queryKey: ['merch', 'store', creatorId], queryFn: () => fetchStore(creatorId), enabled: access.accessible });

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const buyMutation = useMutation({
    mutationFn: async (product: Product) => {
      const body = product.productType === 'physical'
        ? { shippingName, shippingAddress, shippingCity, shippingCountry }
        : {};
      await apiClient.post(`/merch/${creatorId}/products/${product.id}/purchase`, body);
    },
    onSuccess: (_data, product) => {
      showToast(t('merch.purchaseSuccess', 'You bought {{name}}!', { name: product.name }));
      setConfirmProduct(null);
      setShippingName('');
      setShippingAddress('');
      setShippingCity('');
      setShippingCountry('');
      qc.invalidateQueries({ queryKey: ['merch', 'store', creatorId] });
      // ZSB-11 fix: merch purchases spend coins server-side — see gifts.tsx's
      // closeModal for the same fix and full explanation.
      qc.invalidateQueries({ queryKey: ['users', 'me'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error ?? t('merch.purchaseFailed', 'Purchase failed'), 'error');
    },
  });

  if (!access.accessible) {
    return <FeatureNotFound />;
  }

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-neutral-200" />)}
        </div>
      </div>
    );
  }

  if (status === 'error' || !store) {
    return (
      <div className="flex flex-col items-center p-12">
        <p className="text-neutral-500">{t('merch.storeNotFound', 'Store not found')}</p>
        <Link to="/merch" className="mt-3 text-sm text-primary-600">← {t('merch.backToStores', 'Back to Stores')}</Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      {toast && (
        <div className={`fixed bottom-6 left-4 right-4 z-50 rounded-xl px-4 py-3 text-center text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-teal-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-neutral-900">{store.storeName}</h1>
        {store.description && <p className="mt-1 text-sm text-neutral-600">{store.description}</p>}
      </div>

      {store.products.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-neutral-200 bg-white py-16">
          <span className="text-5xl">📦</span>
          <p className="mt-3 font-semibold text-neutral-700">{t('merch.noProducts', 'No products yet')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {store.products.map((product) => (
            <div key={product.id} className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.name} className="mb-2 h-24 w-full rounded-xl object-cover" />
              ) : (
                <div className="mb-2 flex h-24 items-center justify-center rounded-xl bg-neutral-100 text-3xl">🛍️</div>
              )}
              <p className="text-sm font-semibold text-neutral-900">{product.name}</p>
              {product.stock !== null && product.stock <= 5 && !product.isSoldOut && (
                <p className="text-xs font-semibold text-red-600">{t('merch.lowStock', 'Only {{count}} left!', { count: product.stock })}</p>
              )}
              <div className="mt-auto space-y-1.5 pt-2">
                <p className="text-base font-bold text-amber-600">🪙 {product.priceCoin.toLocaleString()}</p>
                {product.isSoldOut ? (
                  <div className="rounded-xl bg-neutral-100 py-1.5 text-center text-xs font-semibold text-neutral-500">{t('merch.soldOut', 'Sold Out')}</div>
                ) : (
                  <button onClick={() => setConfirmProduct(product)} className="w-full rounded-xl bg-primary-600 py-1.5 text-xs font-semibold text-white">
                    {t('merch.buy', 'Buy')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmProduct && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setConfirmProduct(null)} />
          <div className="fixed left-4 right-4 top-1/2 z-50 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-neutral-900">{t('merch.confirmPurchase', 'Confirm Purchase')}</h3>
            <p className="mt-2 text-sm text-neutral-600">
              {t('merch.confirmMessage', 'You are about to buy {{name}} for 🪙 {{price}} coins.', { name: confirmProduct.name, price: confirmProduct.priceCoin.toLocaleString() })}
            </p>

            {isPhysical && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-neutral-500">{t('merch.shippingDetails', 'Shipping Details')}</p>
                <input
                  value={shippingName}
                  onChange={(e) => setShippingName(e.target.value)}
                  placeholder={t('merch.shippingName', 'Full name')}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                />
                <input
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  placeholder={t('merch.shippingAddress', 'Street address')}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <input
                    value={shippingCity}
                    onChange={(e) => setShippingCity(e.target.value)}
                    placeholder={t('merch.shippingCity', 'City')}
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                  />
                  <input
                    value={shippingCountry}
                    onChange={(e) => setShippingCountry(e.target.value)}
                    placeholder={t('merch.shippingCountry', 'Country')}
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirmProduct(null)} disabled={buyMutation.isPending} className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => shippingComplete && buyMutation.mutate(confirmProduct)}
                disabled={buyMutation.isPending || !shippingComplete}
                className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {buyMutation.isPending ? t('merch.buying', 'Buying…') : t('merch.confirmBuy', 'Confirm Buy')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/merch/$creatorId')({
  component: CreatorMerchStorePage,
});
