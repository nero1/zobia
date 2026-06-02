"use client";

/**
 * app/(app)/settings/page.tsx
 *
 * Settings page: account details, language, theme, notifications,
 * privacy toggles, and danger zone (logout / delete account).
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSettings {
  displayName: string;
  bio: string;
  email: string;
  language: string;
  theme: "light" | "dark" | "system";
  notifications: Record<string, boolean>;
  dmOptOut: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "yo", label: "Yoruba" },
  { code: "ha", label: "Hausa" },
  { code: "ig", label: "Igbo" },
  { code: "pcm", label: "Pidgin" },
  { code: "fr", label: "French" },
  { code: "ar", label: "Arabic" },
  { code: "pt", label: "Portuguese" },
];

const NOTIFICATION_TYPES: { key: string; label: string; description: string }[] = [
  { key: "new_message", label: "New messages", description: "Direct messages and room mentions" },
  { key: "friend_request", label: "Friend requests", description: "Someone wants to add you" },
  { key: "gift_received", label: "Gifts received", description: "When someone sends you a gift" },
  { key: "rank_up", label: "Rank up", description: "When you reach a new rank" },
  { key: "war_start", label: "Guild wars", description: "Guild war start and end alerts" },
  { key: "season_end", label: "Season end", description: "Season summary and rewards" },
  { key: "announcement", label: "Announcements", description: "Platform-wide announcements" },
];

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${checked ? "bg-blue-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-card transition duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * User settings page.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state (initialized from settings)
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState("en");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [notifications, setNotifications] = useState<Record<string, boolean>>({});
  const [dmOptOut, setDmOptOut] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  // Delete account
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [savingField, setSavingField] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me/settings", { credentials: "include" });
        if (res.status === 401) { router.push("/login"); return; }
        if (!res.ok) throw new Error("Failed to load settings");
        const data = (await res.json()) as UserSettings;
        setSettings(data);
        setDisplayName(data.displayName);
        setBio(data.bio);
        setEmail(data.email);
        setLanguage(data.language);
        setTheme(data.theme);
        setNotifications(data.notifications);
        setDmOptOut(data.dmOptOut);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function saveField(field: string, value: unknown) {
    setSavingField(field);
    try {
      const res = await fetch("/api/me/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSavingField(null);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (newPassword !== confirmPassword) { setPwError("Passwords do not match"); return; }
    if (newPassword.length < 8) { setPwError("Password must be at least 8 characters"); return; }
    setPwSaving(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) { const d = (await res.json()) as { message?: string }; throw new Error(d.message ?? "Failed"); }
      showToast("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Error");
    } finally {
      setPwSaving(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== "DELETE") return;
    setDeleting(true);
    try {
      const res = await fetch("/api/me", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete account");
      router.push("/goodbye");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setDeleting(false);
    }
  }

  function toggleNotification(key: string, val: boolean) {
    const updated = { ...notifications, [key]: val };
    setNotifications(updated);
    void saveField("notifications", updated);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 h-5 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="h-10 rounded bg-neutral-200 dark:bg-neutral-700" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Settings</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Account */}
      <Section title="Account">
        <div className="space-y-4">
          {[
            { key: "displayName", label: "Display Name", value: displayName, onChange: setDisplayName, placeholder: "Your name" },
            { key: "email", label: "Email (optional)", value: email, onChange: setEmail, placeholder: "email@example.com", type: "email" },
          ].map(({ key, label, value, onChange, placeholder, type }) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">{label}</label>
              <div className="flex gap-2">
                <input
                  type={type ?? "text"}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={placeholder}
                  className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
                <button
                  onClick={() => saveField(key, value)}
                  disabled={savingField === key}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingField === key ? "…" : "Save"}
                </button>
              </div>
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Bio</label>
            <div className="flex gap-2">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={2}
                maxLength={160}
                placeholder="Tell people about yourself…"
                className="flex-1 resize-none rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <button
                onClick={() => saveField("bio", bio)}
                disabled={savingField === "bio"}
                className="self-start rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {savingField === "bio" ? "…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* Password change */}
      <Section title="Change Password">
        <form onSubmit={handlePasswordChange} className="space-y-3">
          {[
            { id: "cur", label: "Current password", value: currentPassword, onChange: setCurrentPassword },
            { id: "new", label: "New password", value: newPassword, onChange: setNewPassword },
            { id: "confirm", label: "Confirm new password", value: confirmPassword, onChange: setConfirmPassword },
          ].map(({ id, label, value, onChange }) => (
            <div key={id}>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">{label}</label>
              <input
                type="password"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          ))}
          {pwError && <p className="text-xs text-red-600 dark:text-red-400">{pwError}</p>}
          <button type="submit" disabled={pwSaving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {pwSaving ? "Changing…" : "Change Password"}
          </button>
        </form>
      </Section>

      {/* Language */}
      <Section title="Language">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">App language</label>
          <select
            value={language}
            onChange={(e) => { setLanguage(e.target.value); void saveField("language", e.target.value); }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </Section>

      {/* Theme */}
      <Section title="Theme">
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTheme(t); void saveField("theme", t); }}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold capitalize transition-colors ${theme === t ? "bg-blue-600 text-white" : "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
            >
              {t === "light" ? "☀️" : t === "dark" ? "🌙" : "💻"} {t}
            </button>
          ))}
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <div className="space-y-3">
          {NOTIFICATION_TYPES.map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{label}</p>
                <p className="text-xs text-neutral-500">{description}</p>
              </div>
              <ToggleSwitch
                checked={notifications[key] ?? true}
                onChange={(v) => toggleNotification(key, v)}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* Privacy */}
      <Section title="Privacy">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Disable direct messages</p>
            <p className="text-xs text-neutral-500">Prevent non-friends from sending you DMs</p>
          </div>
          <ToggleSwitch
            checked={dmOptOut}
            onChange={(v) => { setDmOptOut(v); void saveField("dmOptOut", v); }}
          />
        </div>
      </Section>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-200 bg-white shadow-card dark:border-red-900 dark:bg-neutral-900">
        <div className="border-b border-red-200 px-5 py-4 dark:border-red-900">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">Danger Zone</h2>
        </div>
        <div className="space-y-4 p-5">
          <button
            onClick={handleLogout}
            className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Log Out
          </button>
          <div>
            <p className="mb-2 text-sm font-semibold text-red-700 dark:text-red-400">Delete Account</p>
            <p className="mb-3 text-xs text-neutral-500">This action is permanent and cannot be undone. All your data will be deleted.</p>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Type <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">DELETE</code> to confirm
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="flex-1 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-red-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "DELETE" || deleting}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
