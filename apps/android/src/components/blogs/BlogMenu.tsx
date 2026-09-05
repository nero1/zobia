/**
 * apps/android/src/components/blogs/BlogMenu.tsx
 *
 * Visitor-facing blog navigation menu (owner-configured via the web
 * dashboard's menu builder — Android doesn't duplicate the builder itself,
 * see blogs/$slug/manage.tsx for the owner-side item list editor it does
 * get). Always a hamburger + vertical accordion, per product spec (Android
 * never shows the horizontal-bar variant, regardless of the owner's
 * desktop-web orientation setting) — mirrors apps/web's BlogMenu.tsx's
 * mobile branch.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { resolveMenuItemTarget, type BlogMenuConfig } from '@/lib/blogs/menu';
import { Browser } from '@capacitor/browser';

export function BlogMenu({ blogSlug, menuConfig }: { blogSlug: string; menuConfig: BlogMenuConfig }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!menuConfig || menuConfig.items.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700"
      >
        <span aria-hidden="true">☰</span>
        {t('blogs.menu.title', 'Menu')}
      </button>
      {open && (
        <nav className="mt-2 flex flex-col gap-1 rounded-xl border border-neutral-200 bg-white p-2">
          {menuConfig.items.map((item) => {
            const target = resolveMenuItemTarget(blogSlug, item);
            if (target.kind === 'external') {
              return (
                <button
                  key={item.id}
                  onClick={() => { setOpen(false); void Browser.open({ url: target.url }); }}
                  className="rounded-lg px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                >
                  {item.label}
                </button>
              );
            }
            if (target.kind === 'none') return null;
            return (
              <Link
                key={item.id}
                to={target.to}
                params={target.params as never}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
