"use client";

/**
 * app/(app)/kyc/page.tsx
 *
 * User-facing identity verification (KYC) panel — Tier 1 (BVN for Nigerians
 * / govt ID + proof of address for everyone else), Tier 2 (video statement +
 * liveness), Tier 3 (manual bank-grade physical KYC). Verified accounts get
 * a blue checkmark (see components/shared/VerifiedBadge.tsx).
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { SUPPORTED_NIGERIAN_BANKS } from "@/lib/payments/supported-banks";
import { VerifiedBadge } from "@/components/shared/VerifiedBadge";

const COMMON_COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" },
  { code: "ZA", name: "South Africa" },
  { code: "IN", name: "India" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "AU", name: "Australia" },
];

interface Submission {
  id: string;
  tier: number;
  status: string;
  citizenship_country: string | null;
  video_url: string | null;
  rejection_reason: string | null;
  submitted_at: string;
}

interface StatusData {
  kycTier: number;
  isVerified: boolean;
  submissions: Submission[];
  config: { costCredits: number; badgeMinTier: number };
}

function statusLabel(t: TFunction, status: string): string {
  switch (status) {
    case "pending": return t("kyc.status.pending", "Pending");
    case "ai_review": return t("kyc.status.aiReview", "Under AI review");
    case "manual_review": return t("kyc.status.manualReview", "Under review — may take a few days");
    case "approved": return t("kyc.status.approved", "Approved");
    case "rejected": return t("kyc.status.rejected", "Rejected");
    case "cancelled": return t("kyc.status.cancelled", "Cancelled");
    default: return status;
  }
}

function statusColor(status: string): string {
  if (status === "approved") return "text-emerald-500";
  if (status === "rejected") return "text-red-500";
  if (status === "cancelled") return "text-muted-foreground";
  return "text-amber-500";
}

async function uploadDoc(file: File, docType: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("docType", docType);
  const res = await fetch("/api/kyc/documents", { method: "POST", credentials: "include", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Upload failed");
  return body.data.id as string;
}

function DocUpload({
  label, docType, docId, onUploaded, disabled,
}: { label: string; docType: string; docId: string | null; onUploaded: (id: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const id = await uploadDoc(file, docType);
      onUploaded(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("kyc.doc.uploadFailed", "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {docId ? (
          <span className="text-xs font-medium text-emerald-500">{t("kyc.doc.uploaded", "✓ Uploaded")}</span>
        ) : (
          <label className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent">
            {uploading ? t("kyc.doc.uploading", "Uploading…") : t("kyc.doc.chooseFile", "Choose file")}
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={disabled || uploading} onChange={handleChange} />
          </label>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export default function KycPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [activeForm, setActiveForm] = useState<null | "tier1" | "tier2" | "tier3">(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/kyc/status", { credentials: "include" });
      const body = await res.json();
      if (res.ok) setStatus(body.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function cancel(id: string) {
    setMsg(null);
    const res = await fetch(`/api/kyc/${id}`, { method: "DELETE", credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(body?.error?.message ?? "Could not cancel.");
    void load();
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted-foreground">{t("common.loading", "Loading…")}</div>;
  }
  if (!status) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted-foreground">{t("kyc.loadError", "Could not load verification status.")}</div>;
  }

  const activeSubmission = (tier: number) => status.submissions.find((s) => s.tier === tier && ["pending", "ai_review", "manual_review"].includes(s.status));
  const latestSubmission = (tier: number) => status.submissions.find((s) => s.tier === tier);
  const tier1Active = activeSubmission(1);
  const tier2Active = activeSubmission(2);
  const tier3Active = activeSubmission(3);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-2xl font-bold text-foreground">{t("kyc.title", "Identity Verification")}</h1>
        <VerifiedBadge show={status.isVerified} size="md" />
      </div>

      {status.isVerified && (
        <div className="mb-6 rounded-xl border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-300">
          {t("kyc.verifiedBanner", "Your account is verified. You have the blue checkmark on your profile.")}
        </div>
      )}

      {msg && <p className="mb-4 text-sm text-amber-400">{msg}</p>}

      <p className="mb-6 text-sm text-muted-foreground">
        {t("kyc.intro", "Verifying your identity unlocks the blue checkmark and lets you sell higher-value products. Tier 1 costs {{cost}} credits.", { cost: status.config.costCredits })}
      </p>

      {/* Tier 1 */}
      <TierCard
        t={t}
        tier={1}
        title={t("kyc.tier1.title", "Tier 1 — Identity")}
        description={t("kyc.tier1.desc", "BVN verification for Nigerians, or government ID + proof of address for everyone else.")}
        approved={status.kycTier >= 1}
        active={tier1Active}
        latest={latestSubmission(1)}
        onCancel={cancel}
        expanded={activeForm === "tier1"}
        onToggle={() => setActiveForm(activeForm === "tier1" ? null : "tier1")}
      >
        <Tier1Form onSubmitted={() => { setActiveForm(null); void load(); }} onError={setMsg} />
      </TierCard>

      {/* Tier 2 */}
      <TierCard
        t={t}
        tier={2}
        title={t("kyc.tier2.title", "Tier 2 — Video + Liveness")}
        description={t("kyc.tier2.desc", "A public YouTube statement video, your government ID, and a selfie.")}
        approved={status.kycTier >= 2}
        active={tier2Active}
        latest={latestSubmission(2)}
        locked={status.kycTier < 1}
        lockedReason={t("kyc.tier2.locked", "Complete Tier 1 first.")}
        onCancel={cancel}
        expanded={activeForm === "tier2"}
        onToggle={() => setActiveForm(activeForm === "tier2" ? null : "tier2")}
      >
        <Tier2Form onSubmitted={() => { setActiveForm(null); void load(); }} onError={setMsg} />
      </TierCard>

      {/* Tier 3 */}
      <TierCard
        t={t}
        tier={3}
        title={t("kyc.tier3.title", "Tier 3 — Bank-Grade Physical KYC")}
        description={t("kyc.tier3.desc", "Manual, in-person verification for the highest selling limits.")}
        approved={status.kycTier >= 3}
        active={tier3Active}
        latest={latestSubmission(3)}
        locked={status.kycTier < 2}
        lockedReason={t("kyc.tier3.locked", "Complete Tier 2 first.")}
        onCancel={cancel}
        expanded={activeForm === "tier3"}
        onToggle={() => setActiveForm(activeForm === "tier3" ? null : "tier3")}
      >
        <Tier3Form onSubmitted={() => { setActiveForm(null); void load(); }} onError={setMsg} />
      </TierCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier card shell
// ---------------------------------------------------------------------------

function TierCard({
  t, tier, title, description, approved, active, latest, locked, lockedReason, onCancel, expanded, onToggle, children,
}: {
  t: TFunction;
  tier: number; title: string; description: string; approved: boolean;
  active: Submission | undefined; latest: Submission | undefined;
  locked?: boolean; lockedReason?: string;
  onCancel: (id: string) => void;
  expanded: boolean; onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-foreground">{title}</h2>
            {approved && <span className="rounded-full bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-400">{t("kyc.approvedBadge", "✓ Approved")}</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {latest && (
            <p className={`mt-2 text-xs font-medium ${statusColor(latest.status)}`}>
              {statusLabel(t, latest.status)}
              {latest.status === "rejected" && latest.rejection_reason ? ` — ${latest.rejection_reason}` : ""}
            </p>
          )}
        </div>
        {!approved && !locked && (
          active ? (
            <button onClick={() => onCancel(active.id)} className="shrink-0 rounded-lg border border-red-800 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-950/40">
              {t("kyc.cancel", "Cancel")}
            </button>
          ) : (
            <button onClick={onToggle} className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
              {expanded ? t("kyc.close", "Close") : t("kyc.startTier", `Start Tier ${tier}`, { tier })}
            </button>
          )
        )}
      </div>
      {locked && !approved && <p className="mt-2 text-xs text-muted-foreground">{t("kyc.locked", `🔒 ${lockedReason}`, { reason: lockedReason })}</p>}
      {expanded && !active && !approved && <div className="mt-4 border-t border-border pt-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier 1 form — country branch
// ---------------------------------------------------------------------------

function Tier1Form({ onSubmitted, onError }: { onSubmitted: () => void; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const [country, setCountry] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Nigeria
  const [bvn, setBvn] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [ngDocId, setNgDocId] = useState<string | null>(null);

  // International
  const [idType, setIdType] = useState("passport");
  const [idNumber, setIdNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [idFrontId, setIdFrontId] = useState<string | null>(null);
  const [addressDocId, setAddressDocId] = useState<string | null>(null);
  const [selfieId, setSelfieId] = useState<string | null>(null);

  if (!country) {
    return (
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">{t("kyc.tier1.countryPrompt", "What country are you a citizen of?")}</label>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">{t("kyc.tier1.countrySelect", "Select a country…")}</option>
          <option value="NG">Nigeria</option>
          {COMMON_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </div>
    );
  }

  async function submitNigeria() {
    if (!ngDocId) { onError(t("kyc.tier1.uploadIdFirst", "Upload your ID or NIN slip first.")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/kyc/tier1", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          citizenshipCountry: "NG", bvn, accountNumber, bankCode, firstName, lastName,
          documentIds: [ngDocId],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? t("kyc.tier1.submissionFailed", "Submission failed"));
      onSubmitted();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("kyc.tier1.submissionFailed", "Submission failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitInternational() {
    const documentIds = [idFrontId, addressDocId, selfieId].filter((x): x is string => !!x);
    if (documentIds.length < 2) { onError(t("kyc.tier1.uploadIdAndAddressFirst", "Upload your ID and proof of address first.")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/kyc/tier1", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          citizenshipCountry: country, idType, idNumber, submittedFullName: fullName, documentIds,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? t("kyc.tier1.submissionFailed", "Submission failed"));
      onSubmitted();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("kyc.tier1.submissionFailed", "Submission failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100";

  if (country === "NG") {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setCountry("")} className="text-xs text-muted-foreground hover:text-foreground">{t("kyc.tier1.changeCountry", "← Change country")}</button>
        <input placeholder={t("kyc.tier1.firstName", "First name")} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
        <input placeholder={t("kyc.tier1.lastName", "Last name")} value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
        <input placeholder={t("kyc.tier1.bvnPlaceholder", "BVN (11 digits)")} value={bvn} onChange={(e) => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))} className={inputClass} />
        <select value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={inputClass}>
          <option value="">{t("kyc.tier1.bankSelect", "Select your bank…")}</option>
          {SUPPORTED_NIGERIAN_BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <input placeholder={t("kyc.tier1.accountNumberPlaceholder", "Account number (10 digits)")} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} className={inputClass} />
        <DocUpload label={t("kyc.tier1.idOrNinLabel", "ID or NIN slip")} docType="nin_slip" docId={ngDocId} onUploaded={setNgDocId} />
        <button
          disabled={submitting || !firstName || !lastName || bvn.length !== 11 || !bankCode || accountNumber.length !== 10}
          onClick={() => void submitNigeria()}
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? t("kyc.tier1.submitting", "Submitting…") : t("kyc.tier1.submit", "Submit Tier 1 verification")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setCountry("")} className="text-xs text-muted-foreground hover:text-foreground">{t("kyc.tier1.changeCountry", "← Change country")}</button>
      <input placeholder={t("kyc.tier1.fullNamePlaceholder", "Full legal name")} value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      <select value={idType} onChange={(e) => setIdType(e.target.value)} className={inputClass}>
        <option value="passport">{t("kyc.tier1.idType.passport", "Passport")}</option>
        <option value="drivers_license">{t("kyc.tier1.idType.driversLicense", "Driver's license")}</option>
        <option value="national_id">{t("kyc.tier1.idType.nationalId", "National ID")}</option>
        <option value="voters_card">{t("kyc.tier1.idType.votersCard", "Voter's card")}</option>
      </select>
      <input placeholder={t("kyc.tier1.idNumberPlaceholder", "ID number")} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={inputClass} />
      <DocUpload label={t("kyc.tier1.govtIdLabel", "Government ID")} docType="govt_id_front" docId={idFrontId} onUploaded={setIdFrontId} />
      <DocUpload label={t("kyc.tier1.proofOfAddressLabel", "Proof of address (utility bill, bank statement)")} docType="proof_of_address" docId={addressDocId} onUploaded={setAddressDocId} />
      <DocUpload label={t("kyc.tier1.selfieLabel", "Selfie (liveness check)")} docType="selfie" docId={selfieId} onUploaded={setSelfieId} />
      <button
        disabled={submitting || !fullName || !idNumber || !idFrontId || !addressDocId}
        onClick={() => void submitInternational()}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {submitting ? t("kyc.tier1.submitting", "Submitting…") : t("kyc.tier1.submit", "Submit Tier 1 verification")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier 2 form
// ---------------------------------------------------------------------------

function Tier2Form({ onSubmitted, onError }: { onSubmitted: () => void; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const [videoUrl, setVideoUrl] = useState("");
  const [idFrontId, setIdFrontId] = useState<string | null>(null);
  const [selfieId, setSelfieId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputClass = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100";

  async function submit() {
    const documentIds = [idFrontId, selfieId].filter((x): x is string => !!x);
    setSubmitting(true);
    try {
      const res = await fetch("/api/kyc/tier2", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, documentIds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? t("kyc.tier2.submissionFailed", "Submission failed"));
      onSubmitted();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("kyc.tier2.submissionFailed", "Submission failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("kyc.tier2.instructions", "Record a short statement video (stating your name and that you're verifying your Zobia account), upload it publicly to YouTube, and paste the link below.")}</p>
      <input placeholder={t("kyc.tier2.videoUrlPlaceholder", "https://youtube.com/watch?v=…")} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} className={inputClass} />
      <DocUpload label={t("kyc.tier2.govtIdLabel", "Government ID")} docType="govt_id_front" docId={idFrontId} onUploaded={setIdFrontId} />
      <DocUpload label={t("kyc.tier2.selfieLabel", "Selfie (liveness check)")} docType="selfie" docId={selfieId} onUploaded={setSelfieId} />
      <button
        disabled={submitting || !videoUrl || !idFrontId || !selfieId}
        onClick={() => void submit()}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {submitting ? t("kyc.tier2.submitting", "Submitting…") : t("kyc.tier2.submit", "Submit Tier 2 verification")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier 3 form
// ---------------------------------------------------------------------------

function Tier3Form({ onSubmitted, onError }: { onSubmitted: () => void; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const [reuse, setReuse] = useState(true);
  const [address, setAddress] = useState({ line1: "", city: "", state: "", country: "" });
  const [submitting, setSubmitting] = useState(false);
  const inputClass = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100";

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/kyc/tier3", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reusePreviousAddress: reuse, updatedAddress: reuse ? undefined : address }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? t("kyc.tier3.submissionFailed", "Submission failed"));
      onSubmitted();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("kyc.tier3.submissionFailed", "Submission failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("kyc.tier3.instructions", "Tier 3 is a physical, in-person verification. An admin will contact you to schedule it once you submit this request.")}</p>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
        {t("kyc.tier3.reuseAddress", "Use the address from my previous KYC tier")}
      </label>
      {!reuse && (
        <div className="space-y-2">
          <input placeholder={t("kyc.tier3.addressLine", "Address line")} value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} className={inputClass} />
          <input placeholder={t("kyc.tier3.city", "City")} value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} className={inputClass} />
          <input placeholder={t("kyc.tier3.state", "State/Region")} value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} className={inputClass} />
          <input placeholder={t("kyc.tier3.country", "Country")} value={address.country} onChange={(e) => setAddress({ ...address, country: e.target.value })} className={inputClass} />
        </div>
      )}
      <button
        disabled={submitting || (!reuse && !address.line1)}
        onClick={() => void submit()}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {submitting ? t("kyc.tier3.submitting", "Submitting…") : t("kyc.tier3.submit", "Request Tier 3 verification")}
      </button>
    </div>
  );
}
