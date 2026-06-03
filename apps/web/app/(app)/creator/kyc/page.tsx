"use client";

/**
 * app/(app)/creator/kyc/page.tsx
 *
 * Creator KYC verification page (web version).
 * Step 1: identity form (name, DOB, bank details).
 * Step 2: pending — awaiting review.
 * Step 3: verified — ready to accept payments.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KYCStatus = "not_started" | "pending" | "verified" | "rejected";

interface KYCStateResponse {
  status: KYCStatus;
  rejectionReason?: string;
}

interface KYCFormData {
  fullName: string;
  dateOfBirth: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{message}</p>;
}

function validate(form: KYCFormData): Partial<Record<keyof KYCFormData, string>> {
  const errors: Partial<Record<keyof KYCFormData, string>> = {};
  if (!form.fullName.trim()) errors.fullName = "Full name is required";
  if (!form.dateOfBirth) errors.dateOfBirth = "Date of birth is required";
  if (!form.bankName.trim()) errors.bankName = "Bank name is required";
  if (!form.accountNumber.trim()) errors.accountNumber = "Account number is required";
  else if (!/^\d{6,18}$/.test(form.accountNumber.replace(/\s/g, "")))
    errors.accountNumber = "Enter a valid account number (6–18 digits)";
  if (!form.accountName.trim()) errors.accountName = "Account name is required";
  return errors;
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

// Step 1: Form

interface FormStepProps {
  onSubmit: (data: KYCFormData) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
}

function FormStep({ onSubmit, submitting, submitError }: FormStepProps) {
  const [form, setForm] = useState<KYCFormData>({
    fullName: "",
    dateOfBirth: "",
    bankName: "",
    accountNumber: "",
    accountName: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof KYCFormData, string>>>({});

  function set(key: keyof KYCFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const errors = validate(form);
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    await onSubmit(form);
  }

  return (
    <div className="mx-auto max-w-xl">
      {/* Header */}
      <div className="mb-6 text-center">
        <span className="text-4xl" aria-hidden>🪪</span>
        <h1 className="mt-3 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Verify Your Identity</h1>
        <p className="mt-2 text-sm text-neutral-500">
          To accept payments as a creator, we need to verify your identity and bank details.
          Your information is encrypted and securely stored.
        </p>
      </div>

      {/* Requirements notice */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/30">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">What you&apos;ll need</p>
        <ul className="mt-2 space-y-1 text-sm text-blue-700 dark:text-blue-300">
          <li>· Your full legal name (as on your ID)</li>
          <li>· Your date of birth</li>
          <li>· Bank account details for payouts</li>
        </ul>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Submit error */}
        {submitError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {submitError}
          </div>
        )}

        {/* Personal Info */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Personal Information</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300" htmlFor="fullName">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="fullName"
                type="text"
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                placeholder="As it appears on your ID"
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
              />
              <FieldError message={fieldErrors.fullName} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300" htmlFor="dateOfBirth">
                Date of Birth <span className="text-red-500">*</span>
              </label>
              <input
                id="dateOfBirth"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
                max={new Date(Date.now() - 18 * 365.25 * 86400000).toISOString().split("T")[0]}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <FieldError message={fieldErrors.dateOfBirth} />
            </div>
          </div>
        </div>

        {/* Bank Details */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Bank Account Details</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300" htmlFor="bankName">
                Bank Name <span className="text-red-500">*</span>
              </label>
              <input
                id="bankName"
                type="text"
                value={form.bankName}
                onChange={(e) => set("bankName", e.target.value)}
                placeholder="e.g. First Bank, GTBank"
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
              />
              <FieldError message={fieldErrors.bankName} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300" htmlFor="accountNumber">
                Account Number <span className="text-red-500">*</span>
              </label>
              <input
                id="accountNumber"
                type="text"
                inputMode="numeric"
                value={form.accountNumber}
                onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, ""))}
                placeholder="10-digit account number"
                maxLength={18}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
              />
              <FieldError message={fieldErrors.accountNumber} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300" htmlFor="accountName">
                Account Name <span className="text-red-500">*</span>
              </label>
              <input
                id="accountName"
                type="text"
                value={form.accountName}
                onChange={(e) => set("accountName", e.target.value)}
                placeholder="Name on your bank account"
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
              />
              <FieldError message={fieldErrors.accountName} />
            </div>
          </div>
        </div>

        {/* Legal note */}
        <p className="text-xs text-neutral-400">
          By submitting, you confirm that all information is accurate and you are at least 18 years old.
          Your data is processed in accordance with our Privacy Policy.
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit for Verification"}
        </button>
      </form>
    </div>
  );
}

// Step 2: Pending

function PendingStep() {
  return (
    <div className="mx-auto max-w-md text-center">
      <span className="text-5xl" aria-hidden>⏳</span>
      <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Under Review</h1>
      <p className="mt-3 text-sm text-neutral-500">
        Your verification is under review. We&apos;ll notify you within 24 hours once your identity has been confirmed.
      </p>
      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xl dark:bg-amber-900">📋</span>
          <div className="text-left">
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">What happens next?</p>
            <p className="text-xs text-neutral-500">Our compliance team is reviewing your submission. You&apos;ll receive an in-app notification when the review is complete.</p>
          </div>
        </div>
      </div>
      <Link
        href="/creator"
        className="mt-6 inline-block text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to Creator Dashboard
      </Link>
    </div>
  );
}

// Step 3: Verified

function VerifiedStep() {
  return (
    <div className="mx-auto max-w-md text-center">
      <span className="text-5xl" aria-hidden>✅</span>
      <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">You&apos;re Verified!</h1>
      <p className="mt-3 text-sm text-neutral-500">
        Your identity has been verified. You can now accept payments and receive payouts directly to your bank account.
      </p>
      <div className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-5 dark:border-teal-800 dark:bg-teal-950/30">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xl dark:bg-teal-900">🎉</span>
          <div className="text-left">
            <p className="text-sm font-semibold text-teal-800 dark:text-teal-200">You&apos;re all set!</p>
            <p className="text-xs text-teal-600 dark:text-teal-400">Your creator account is fully activated. Start earning from your rooms and content.</p>
          </div>
        </div>
      </div>
      <Link
        href="/creator"
        className="mt-6 block w-full rounded-xl bg-blue-600 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
      >
        Go to Creator Dashboard →
      </Link>
    </div>
  );
}

// Rejected

function RejectedStep({ reason, onRetry }: { reason?: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md text-center">
      <span className="text-5xl" aria-hidden>❌</span>
      <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Verification Unsuccessful</h1>
      <p className="mt-3 text-sm text-neutral-500">
        We were unable to verify your identity. Please review the details below and resubmit.
      </p>
      {reason && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {reason}
        </div>
      )}
      <button
        onClick={onRetry}
        className="mt-6 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Try Again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-xl animate-pulse space-y-4">
      <div className="h-10 w-32 mx-auto rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-6 w-64 mx-auto rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="space-y-3">
          <div className="h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-10 w-full rounded-xl bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-10 w-full rounded-xl bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// NOTE: Metadata is defined here for SEO reference. In Next.js, metadata
// exports are only honoured by server components. A parent layout or a server
// wrapper component should export this metadata object for it to be applied.
//
// export const metadata = {
//   title: "Creator Verification – Zobia",
//   description: "Verify your identity to start accepting payments as a Zobia creator.",
// };

/**
 * Creator KYC page — handles not_started, pending, verified, and rejected states.
 */
export default function CreatorKYCPage() {
  const [status, setStatus] = useState<KYCStatus | "loading">("loading");
  const [rejectionReason, setRejectionReason] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/creator/kyc", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (res.status === 404) { setStatus("not_started"); return; }
        if (!res.ok) throw new Error("Failed to load KYC status");
        const data = (await res.json()) as KYCStateResponse;
        setStatus(data.status);
        setRejectionReason(data.rejectionReason);
      } catch {
        setStatus("not_started");
      }
    })();
  }, []);

  async function handleSubmit(formData: KYCFormData) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/creator/kyc", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? "Submission failed. Please try again.");
      }
      setStatus("pending");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Step indicator */}
      {status !== "loading" && status !== "not_started" && (
        <div className="mx-auto mb-6 flex max-w-xs items-center justify-center gap-3">
          {(["not_started", "pending", "verified"] as const).map((step, idx) => {
            const stepIndex = ["not_started", "pending", "verified"].indexOf(
              status === "rejected" ? "pending" : status
            );
            const active = idx <= stepIndex;
            return (
              <div key={step} className="flex items-center gap-3">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-blue-600 text-white" : "border-2 border-neutral-300 text-neutral-400 dark:border-neutral-600"}`}
                >
                  {idx + 1}
                </div>
                {idx < 2 && <div className={`h-0.5 w-8 ${active && idx < stepIndex ? "bg-blue-600" : "bg-neutral-200 dark:bg-neutral-700"}`} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Content */}
      {status === "loading" && <PageSkeleton />}
      {status === "not_started" && (
        <FormStep onSubmit={handleSubmit} submitting={submitting} submitError={submitError} />
      )}
      {status === "pending" && <PendingStep />}
      {status === "verified" && <VerifiedStep />}
      {status === "rejected" && (
        <RejectedStep reason={rejectionReason} onRetry={() => setStatus("not_started")} />
      )}
    </div>
  );
}
