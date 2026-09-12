/**
 * apps/android/src/components/profile/AvatarCropModal.tsx
 *
 * Profile Pictures feature — Android mirror of
 * apps/web/components/profile/AvatarCropModal.tsx. Same crop/upload flow
 * (react-easy-crop → canvas → multipart POST to the same
 * /api/users/me/avatar backend route), ported to this app's plain
 * `<input type="file">` + apiClient (axios) idiom (see
 * src/routes/forum/thread/$slug.tsx's handleUploadImage for the existing
 * precedent — no native camera/gallery plugin is wired in for uploads here).
 */

import { useState, useCallback, useEffect } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';

export interface AvatarChangeEligibility {
  plan: string;
  isPaid: boolean;
  nextEligibleAt: string | null;
  creditBalance: number;
  starBalance: number;
  costCredits: number;
  costStars: number;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export interface AvatarCropModalProps {
  imageSrc: string;
  onClose: () => void;
  onUploaded: (avatarUrl: string) => void;
}

async function getCroppedBlob(imageSrc: string, cropPixels: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const OUTPUT_SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image'))), 'image/jpeg', 0.92);
  });
}

export function AvatarCropModal({ imageSrc, onClose, onUploaded }: AvatarCropModalProps) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<AvatarChangeEligibility | null>(null);
  const [currency, setCurrency] = useState<'credits' | 'stars'>('credits');

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<AvatarChangeEligibility>('/users/me/avatar')
      .then(({ data }) => {
        if (!cancelled) setEligibility(data);
      })
      .catch(() => {
        // Non-fatal — the upload itself still enforces cost/cooldown server-side.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const needsPayment = eligibility && !eligibility.isPaid;
  const canPayCredits = !!eligibility && eligibility.costCredits > 0 && eligibility.creditBalance >= eligibility.costCredits;
  const canPayStars = !!eligibility && eligibility.costStars > 0 && eligibility.starBalance >= eligibility.costStars;
  const canAffordChange = !needsPayment || canPayCredits || canPayStars;
  const onCooldown = !!eligibility?.nextEligibleAt;

  async function handleConfirm() {
    if (!croppedAreaPixels || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      const formData = new FormData();
      formData.append('file', blob, 'avatar.jpg');
      if (needsPayment) formData.append('currency', currency);

      const { data } = await apiClient.post<{ avatarUrl: string }>('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(data.avatarUrl);
      onClose();
    } catch (err) {
      if (isAxiosError<ApiErrorBody>(err)) {
        setError(err.response?.data?.error?.message ?? t('profile.avatar.uploadFailed'));
      } else {
        setError(t('profile.avatar.uploadFailed'));
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('profile.avatar.modalTitle')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-neutral-900">{t('profile.avatar.modalTitle')}</h2>
          <button onClick={onClose} aria-label={t('action.close')} className="rounded-full p-1 text-neutral-500">
            ✕
          </button>
        </div>

        <div className="relative h-72 w-full overflow-hidden rounded-xl bg-neutral-950">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label={t('profile.avatar.zoomLabel')}
          className="mt-4 w-full"
        />

        {onCooldown && eligibility?.nextEligibleAt && (
          <p className="mt-3 text-xs text-amber-600" role="alert">
            {t('profile.avatar.cooldownActive', { date: new Date(eligibility.nextEligibleAt).toLocaleDateString() })}
          </p>
        )}

        {needsPayment && !onCooldown && (
          <div className="mt-3 rounded-xl bg-neutral-50 p-3 text-xs">
            <p className="mb-2 text-neutral-600">
              {t('profile.avatar.freePlanCostNotice', { credits: eligibility?.costCredits, stars: eligibility?.costStars })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canPayCredits}
                onClick={() => setCurrency('credits')}
                className={`flex-1 rounded-lg border px-2 py-1.5 font-semibold disabled:opacity-40 ${
                  currency === 'credits' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-300'
                }`}
              >
                {t('profile.avatar.payWithCredits', { cost: eligibility?.costCredits })}
              </button>
              <button
                type="button"
                disabled={!canPayStars}
                onClick={() => setCurrency('stars')}
                className={`flex-1 rounded-lg border px-2 py-1.5 font-semibold disabled:opacity-40 ${
                  currency === 'stars' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-300'
                }`}
              >
                {t('profile.avatar.payWithStars', { cost: eligibility?.costStars })}
              </button>
            </div>
            {!canAffordChange && <p className="mt-2 text-danger-600">{t('profile.avatar.cannotAfford')}</p>}
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-danger-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-600">
            {t('action.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={uploading || onCooldown || (!!needsPayment && !canAffordChange) || !croppedAreaPixels}
            className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {uploading ? t('action.saving') : t('profile.avatar.saveAndUpload')}
          </button>
        </div>
      </div>
    </div>
  );
}
