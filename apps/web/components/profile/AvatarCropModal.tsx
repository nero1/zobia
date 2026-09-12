"use client";

/**
 * components/profile/AvatarCropModal.tsx
 *
 * Profile Pictures feature — reusable crop/resize modal used everywhere a
 * profile photo can be changed (Settings; wire in any future entry point
 * the same way). Modeled on components/announcements/AnnouncementModal.tsx's
 * fixed-overlay pattern since this codebase has no shared Modal/Dialog
 * primitive yet.
 *
 * Flow:
 *   1. Caller renders <AvatarCropModal open onClose onUploaded .../> once a
 *      file is picked (via an <input type="file"> the caller owns).
 *   2. User pans/zooms a square crop (Facebook-style) over the image using
 *      react-easy-crop.
 *   3. On confirm, the crop is rendered to a canvas, exported as a WebP/JPEG
 *      Blob, and POSTed as multipart/form-data to POST /api/users/me/avatar.
 *      The server re-compresses and (for GIF) strips animation server-side —
 *      this client-side crop only frames the shot, it isn't the final
 *      compression pass.
 *   4. On INSUFFICIENT_AVATAR_CHANGE_FUNDS (free plan, can't afford either
 *      currency) or AVATAR_CHANGE_RATE_LIMITED (cooldown), shows the
 *      relevant message inline instead of uploading blindly — the modal
 *      calls GET /api/users/me/avatar on open to pre-flight this.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

export interface AvatarChangeEligibility {
  plan: string;
  isPaid: boolean;
  nextEligibleAt: string | null;
  creditBalance: number;
  starBalance: number;
  costCredits: number;
  costStars: number;
}

export interface AvatarCropModalProps {
  /** The picked file's object URL (or data URL) to crop. */
  imageSrc: string;
  onClose: () => void;
  /** Called with the new avatar URL after a successful upload. */
  onUploaded: (avatarUrl: string) => void;
}

async function getCroppedBlob(imageSrc: string, cropPixels: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const OUTPUT_SIZE = 512; // matches the avatar HD-send override in lib/storage/compress.ts
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

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
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode image"))),
      "image/jpeg",
      0.92
    );
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
  const [currency, setCurrency] = useState<"credits" | "stars">("credits");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users/me/avatar", { credentials: "include" });
        const json = await res.json();
        if (!cancelled && res.ok) {
          setEligibility(json.data);
          if (json.data?.starBalance >= json.data?.costStars && json.data?.costStars > 0) {
            // default choice: prefer credits unless the user only has stars
          }
        }
      } catch {
        // Non-fatal — the upload itself still enforces cost/cooldown server-side.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
      formData.append("file", blob, "avatar.jpg");
      if (needsPayment) formData.append("currency", currency);

      const res = await fetch("/api/users/me/avatar", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(json?.error?.message ?? "Upload failed"), {
          code: json?.error?.code,
        });
      }
      onUploaded(json.data.avatarUrl);
      onClose();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setError(translateApiError(t, e.code, e.message ?? t("profile.avatar.uploadFailed")));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("profile.avatar.modalTitle")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl dark:bg-neutral-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
            {t("profile.avatar.modalTitle")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("action.close")}
            className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
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
          aria-label={t("profile.avatar.zoomLabel")}
          className="mt-4 w-full"
        />

        {onCooldown && eligibility?.nextEligibleAt && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400" role="alert">
            {t("profile.avatar.cooldownActive", {
              date: new Date(eligibility.nextEligibleAt).toLocaleDateString(),
            })}
          </p>
        )}

        {needsPayment && !onCooldown && (
          <div className="mt-3 rounded-xl bg-neutral-50 p-3 text-xs dark:bg-neutral-800">
            <p className="mb-2 text-neutral-600 dark:text-neutral-300">
              {t("profile.avatar.freePlanCostNotice", {
                credits: eligibility?.costCredits,
                stars: eligibility?.costStars,
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canPayCredits}
                onClick={() => setCurrency("credits")}
                className={`flex-1 rounded-lg border px-2 py-1.5 font-semibold disabled:opacity-40 ${
                  currency === "credits"
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {t("profile.avatar.payWithCredits", { cost: eligibility?.costCredits })}
              </button>
              <button
                type="button"
                disabled={!canPayStars}
                onClick={() => setCurrency("stars")}
                className={`flex-1 rounded-lg border px-2 py-1.5 font-semibold disabled:opacity-40 ${
                  currency === "stars"
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {t("profile.avatar.payWithStars", { cost: eligibility?.costStars })}
              </button>
            </div>
            {!canAffordChange && (
              <p className="mt-2 text-red-600 dark:text-red-400">
                {t("profile.avatar.cannotAfford")}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("action.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={uploading || onCooldown || (!!needsPayment && !canAffordChange) || !croppedAreaPixels}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? t("action.saving") : t("profile.avatar.saveAndUpload")}
          </button>
        </div>
      </div>
    </div>
  );
}
