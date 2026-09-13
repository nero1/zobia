/**
 * apps/android/src/routes/creator/merch.tsx
 *
 * Creator Merch Store management — mirrors apps/web/app/(app)/creator/merch/
 * page.tsx: create/update the store, add products (digital/physical/course
 * material), and the Market referral opt-in for creator products.
 *
 * Unlike creator/bank-account.tsx and creator/wallet.tsx, this is plain CRUD
 * (no PIN/2FA-gated payout risk), so it's built natively here instead of
 * handed off to the web flow.
 *
 * Eligibility mirrors the API (lib/merch/eligibility.ts): Elite+ creators or
 * verified Business accounts. GET /merch/:userId returns 404 when the caller
 * has no store yet (rendered as the create-store form) and 403 when they're
 * ineligible (rendered as an explanatory empty state).
 */

import { useState, type FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

interface StoreState {
  id: string;
  name: string;
  description: string;
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

interface StoreData {
  store: StoreState | null;
  products: ProductRow[];
}

async function fetchStore(userId: string): Promise<StoreData> {
  try {
    const { data } = await apiClient.get<{
      store?: { id: string; name: string; description: string | null };
      products?: ProductRow[];
    }>(`/merch/${userId}`);
    return {
      store: data.store ? { id: data.store.id, name: data.store.name, description: data.store.description ?? '' } : null,
      products: data.products ?? [],
    };
  } catch (err) {
    if ((err as AxiosError).response?.status === 404) {
      return { store: null, products: [] };
    }
    throw err;
  }
}

const inputClass = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900';

function CreatorMerchPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';

  const { data, status, error } = useQuery({
    queryKey: ['creator', 'merch', 'store', userId],
    queryFn: () => fetchStore(userId),
    enabled: !!userId,
    retry: false,
  });

  const [storeForm, setStoreForm] = useState({ name: '', description: '' });
  const [storeFormTouched, setStoreFormTouched] = useState(false);
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    product_type: 'digital' as 'digital' | 'physical' | 'course_material',
    price_kobo: '',
    stock: '',
    referral_enabled: false,
    referral_commission_pct: '',
  });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  const store = data?.store ?? null;
  const nameValue = storeFormTouched ? storeForm.name : (store?.name ?? storeForm.name);
  const descValue = storeFormTouched ? storeForm.description : (store?.description ?? storeForm.description);

  const saveStoreMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) => apiClient.post(`/merch/${userId}`, body),
    onSuccess: () => {
      showToast(t('creator.merch.storeSaved', 'Store saved!'));
      setStoreFormTouched(false);
      qc.invalidateQueries({ queryKey: ['creator', 'merch', 'store', userId] });
    },
    onError: (err: unknown) => {
      const e = err as AxiosError<{ error?: { message?: string } }>;
      showToast(e.response?.data?.error?.message ?? t('creator.merch.saveFailed', 'Failed to save store'), 'error');
    },
  });

  const addProductMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post(`/merch/${userId}/products`, body),
    onSuccess: () => {
      showToast(t('creator.merch.productAdded', '{{name}} added!', { name: productForm.name }));
      setProductForm({ name: '', description: '', product_type: 'digital', price_kobo: '', stock: '', referral_enabled: false, referral_commission_pct: '' });
      qc.invalidateQueries({ queryKey: ['creator', 'merch', 'store', userId] });
    },
    onError: (err: unknown) => {
      const e = err as AxiosError<{ error?: { message?: string } }>;
      showToast(e.response?.data?.error?.message ?? t('creator.merch.addProductFailed', 'Failed to add product'), 'error');
    },
  });

  function handleSaveStore(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    saveStoreMutation.mutate({ name: nameValue, description: descValue });
  }

  function handleAddProduct(e: FormEvent) {
    e.preventDefault();
    if (!userId || !store) return;
    const priceKobo = Math.round(parseFloat(productForm.price_kobo || '0') * 100);
    const body: Record<string, unknown> = {
      name: productForm.name,
      description: productForm.description || undefined,
      product_type: productForm.product_type,
      price_kobo: priceKobo,
      stock: productForm.stock ? parseInt(productForm.stock, 10) : null,
      referral_enabled: productForm.referral_enabled,
    };
    if (productForm.product_type === 'physical' && productForm.referral_enabled) {
      body.referral_commission_pct = parseFloat(productForm.referral_commission_pct || '1');
    }
    addProductMutation.mutate(body);
  }

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4 space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-neutral-200" />
        <div className="h-48 animate-pulse rounded-xl bg-neutral-200" />
      </div>
    );
  }

  const ineligible = status === 'error' && (error as AxiosError | null)?.response?.status === 403;

  if (ineligible) {
    return (
      <div className="flex flex-col items-center py-16 px-6 text-center">
        <span className="text-5xl">🔒</span>
        <p className="mt-4 font-semibold text-neutral-700">
          {t('creator.merch.ineligibleTitle', 'Merch stores are for Elite+ creators and verified Business accounts')}
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          {t('creator.merch.ineligibleDesc', 'Reach Elite tier or verify your Business account to open a store.')}
        </p>
        <Link to="/creator" className="mt-4 text-sm font-semibold text-primary-600">
          ← {t('creator.title', 'Creator Dashboard')}
        </Link>
      </div>
    );
  }

  if (status === 'error' || !data) {
    return <div className="p-6 text-sm text-red-600">{t('error.generic')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      {toast && (
        <div className={`fixed bottom-6 left-4 right-4 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-teal-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <h1 className="text-xl font-bold text-neutral-900">🛍️ {t('creator.merch.title', 'My Merch Store')}</h1>

      <form onSubmit={handleSaveStore} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        <p className="text-sm font-semibold text-neutral-800">{t('creator.merch.storeDetails', 'Store details')}</p>
        <input
          value={nameValue}
          onChange={(e) => { setStoreFormTouched(true); setStoreForm({ name: e.target.value, description: descValue }); }}
          placeholder={t('creator.merch.storeNamePlaceholder', 'Store name')}
          required
          minLength={2}
          className={inputClass}
        />
        <textarea
          value={descValue}
          onChange={(e) => { setStoreFormTouched(true); setStoreForm({ name: nameValue, description: e.target.value }); }}
          placeholder={t('creator.merch.storeDescPlaceholder', 'Description (optional)')}
          rows={2}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={saveStoreMutation.isPending}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saveStoreMutation.isPending
            ? t('creator.merch.saving', 'Saving…')
            : store
              ? t('creator.merch.updateStore', 'Update store')
              : t('creator.merch.createStore', 'Create store')}
        </button>
      </form>

      {store && (
        <>
          <form onSubmit={handleAddProduct} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
            <p className="text-sm font-semibold text-neutral-800">{t('creator.merch.addProduct', 'Add a product')}</p>
            <input
              value={productForm.name}
              onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
              placeholder={t('creator.merch.productNamePlaceholder', 'Product name')}
              required
              minLength={2}
              className={inputClass}
            />
            <textarea
              value={productForm.description}
              onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
              placeholder={t('creator.merch.storeDescPlaceholder', 'Description (optional)')}
              rows={2}
              className={inputClass}
            />
            <div className="flex gap-2">
              <select
                value={productForm.product_type}
                onChange={(e) => setProductForm({ ...productForm, product_type: e.target.value as typeof productForm.product_type })}
                className={inputClass}
              >
                <option value="digital">{t('creator.merch.typeDigital', 'Digital')}</option>
                <option value="physical">{t('creator.merch.typePhysical', 'Physical')}</option>
                <option value="course_material">{t('creator.merch.typeCourseMaterial', 'Course Material')}</option>
              </select>
              <input
                type="number"
                min="1"
                step="0.01"
                value={productForm.price_kobo}
                onChange={(e) => setProductForm({ ...productForm, price_kobo: e.target.value })}
                placeholder={t('creator.merch.pricePlaceholder', 'Price (₦)')}
                required
                className={inputClass}
              />
            </div>
            <input
              type="number"
              min="0"
              value={productForm.stock}
              onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
              placeholder={t('creator.merch.stockPlaceholder', 'Stock (leave blank for unlimited)')}
              className={inputClass}
            />

            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={productForm.referral_enabled}
                onChange={(e) => setProductForm({ ...productForm, referral_enabled: e.target.checked })}
              />
              {t('creator.merch.referralToggle', 'Let other users earn a commission by referring this item')}
            </label>
            {productForm.referral_enabled && productForm.product_type === 'physical' && (
              <div>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="0.01"
                  value={productForm.referral_commission_pct}
                  onChange={(e) => setProductForm({ ...productForm, referral_commission_pct: e.target.value })}
                  placeholder={t('creator.merch.commissionPlaceholder', 'Commission % (min 1%)')}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-neutral-500">
                  {t('creator.merch.commissionHint', "This % of the sale price is set aside for referrals. The platform takes its standard cut of that amount; the rest goes to whoever referred the buyer.")}
                </p>
              </div>
            )}
            {productForm.referral_enabled && productForm.product_type !== 'physical' && (
              <p className="text-xs text-neutral-500">
                {t('creator.merch.digitalReferralHint', "Digital items use the platform's standard referral commission rate — no % to set.")}
              </p>
            )}

            <button
              type="submit"
              disabled={addProductMutation.isPending}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {addProductMutation.isPending ? t('creator.merch.adding', 'Adding…') : t('creator.merch.addProductBtn', 'Add product')}
            </button>
          </form>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-neutral-800">
              {t('creator.merch.yourProducts', 'Your products ({{count}})', { count: data.products.length })}
            </p>
            {data.products.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3 text-sm shadow-card">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{p.name}</p>
                  <p className="text-xs text-neutral-500">
                    {p.product_type} · ₦{(p.priceKobo / 100).toLocaleString()}
                    {p.referral_enabled && (
                      <span className="ml-2 text-teal-600">
                        · {t('creator.merch.referralLabel', 'referral')} {p.product_type === 'physical' ? `${p.referralCommissionPct}%` : t('creator.merch.referralOn', 'on')}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Link to="/creator" className="block text-center text-sm text-primary-600">
        ← {t('creator.title', 'Creator Dashboard')}
      </Link>
    </div>
  );
}

export const Route = createFileRoute('/creator/merch')({
  component: CreatorMerchPage,
});
