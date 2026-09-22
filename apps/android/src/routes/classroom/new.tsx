/**
 * apps/android/src/routes/classroom/new.tsx
 *
 * Create a classroom — mirrors apps/web/app/(app)/classroom/new/page.tsx.
 * POST /api/rooms (type 'classroom') keeps every creator-eligibility and
 * Trust Score rule. The public URL is pre-filled from the name
 * (GET /api/classroom/slug?name=) and editable, with a live availability check.
 * CAPTCHA-gated room creation (if enabled by admins) isn't available in the
 * WebView — the server's error is surfaced as-is in that case.
 */

import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { apiError, get, type SlugAvailability } from '@/lib/classroom/api';

const CATEGORIES = ['Education', 'Technology', 'Business', 'Finance', 'Creativity', 'Music', 'Lifestyle', 'Health', 'Languages', 'Other'];

function NewClassroomPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Education');
  const [fee, setFee] = useState('0');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<SlugAvailability | null>(null);
  const [listed, setListed] = useState(true);
  const [modules, setModules] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (touched || name.trim().length < 2) return;
    const id = setTimeout(() => {
      get<{ suggestion: string }>('/slug', { name: name.trim() })
        .then((d) => {
          setSlug(d.suggestion);
          setStatus({ slug: d.suggestion, available: true, reason: null });
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [name, touched]);

  useEffect(() => {
    if (!touched || !slug.trim()) return;
    const id = setTimeout(() => {
      get<SlugAvailability>('/slug', { slug: slug.trim() }).then(setStatus).catch(() => setStatus(null));
    }, 400);
    return () => clearTimeout(id);
  }, [slug, touched]);

  async function submit() {
    if (name.trim().length < 2) {
      setError(t('classroom.create.nameRequired', 'Give your classroom a name (at least 2 characters).'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ room: { id: string } }>('/rooms', {
        name: name.trim(),
        description: description.trim() || undefined,
        type: 'classroom',
        category,
        coverEmoji: '📚',
        enrolmentFeeNgn: Math.max(0, parseInt(fee || '0', 10) || 0),
        slug: (status?.slug ?? slug.trim()) || undefined,
        showInCreatorListing: listed,
        curriculum: modules.map((m) => m.trim()).filter(Boolean).map((title, order) => ({ title, order })),
      });
      void navigate({ to: '/classroom/studio/$roomId', params: { roomId: data.room.id }, replace: true });
    } catch (e) {
      setError(apiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm';
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-xl font-bold">{t('classroom.create.title', 'Create a classroom')}</h1>
      <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('classroom.create.namePlaceholder', 'e.g. YouTube Monetization for Beginners')} />
      <div>
        <div className="flex items-center gap-1 rounded-xl border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm">
          <span className="text-neutral-400">/c/</span>
          <input className="min-w-0 flex-1 bg-transparent outline-none" value={slug} maxLength={60} onChange={(e) => { setTouched(true); setSlug(e.target.value.toLowerCase()); }} />
        </div>
        {status && (
          <p className={`mt-1 text-xs ${status.available ? 'text-teal-600' : 'text-danger-600'}`}>
            {status.available ? t('classroom.slug.available', 'Available: /c/{{slug}}', { slug: status.slug }) : t('classroom.slug.taken', 'That URL is already taken.')}
          </p>
        )}
        <p className="mt-1 text-[11px] text-neutral-400">{t('classroom.create.urlHint', "You can change it later from the classroom's settings (your first change is free).")}</p>
      </div>
      <textarea className={field} rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('classroom.create.description', 'Description')} />
      <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <label className="block text-xs text-neutral-500">
        {t('classroom.create.fee', 'Enrolment fee (Credits, 0 = free)')}
        <input type="number" min={0} className={field} value={fee} onChange={(e) => setFee(e.target.value)} />
      </label>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-neutral-500">{t('classroom.create.modules', 'First lessons (optional)')}</p>
        {modules.map((m, i) => (
          <input key={i} className={field} value={m} maxLength={200} placeholder={t('classroom.create.modulePlaceholder', 'Lesson {{n}} title', { n: i + 1 })} onChange={(e) => setModules(modules.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
        <button type="button" onClick={() => setModules([...modules, ''])} className="text-xs font-semibold text-primary-600">
          {t('classroom.card.addModule', '+ Add Module')}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
        {t('classroom.create.showInListing', 'Show on my public “Classrooms by” page')}
      </label>
      {error && <p className="rounded-lg bg-danger-50 p-2 text-sm text-danger-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? t('classroom.create.creating', 'Creating…') : t('classroom.create.submit', 'Create classroom')}
      </button>
    </div>
  );
}

export const Route = createFileRoute('/classroom/new')({
  component: NewClassroomPage,
});
