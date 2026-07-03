/**
 * apps/android/src/components/admin/AdminShell.tsx
 *
 * Admin section shell: header (hamburger + title + "Exit" back to /home) plus
 * a slide-out drawer listing every admin page — mirrors the mobile/PWA drawer
 * behaviour of apps/web/components/admin/AdminLayoutShell.tsx's MobileDrawer
 * (this app has no desktop breakpoint, so there's no sidebar variant to port).
 * Replaces TopBar/BottomNav for the /admin/* subtree — the admin section is a
 * distinct area, same as on web, not another bottom-nav tab.
 */

import { useState } from 'react';
import { Link, useRouterState, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';
import { adminNavItems } from '@/components/admin/adminNav';
import { AdminGuard } from '@/components/admin/AdminGuard';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clearAuth } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);

  const activeItem = [...adminNavItems].sort((a, b) => b.href.length - a.href.length).find((item) =>
    item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
  );

  const handleLogout = async () => {
    closeDrawer();
    await clearAuth();
    navigate({ to: '/auth/login', replace: true });
  };

  return (
    <AdminGuard>
      <div className="h-full flex flex-col bg-neutral-100">
        <header className="relative z-50 flex-none bg-neutral-900" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="h-14 flex items-center justify-between px-4">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                aria-label={t('admin.openMenu')}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
                className="rounded-lg p-2 text-neutral-300 hover:bg-white/10"
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <rect x="2" y="4" width="16" height="2" rx="1" />
                  <rect x="2" y="9" width="16" height="2" rx="1" />
                  <rect x="2" y="14" width="16" height="2" rx="1" />
                </svg>
              </button>
              <span className="truncate text-sm font-semibold text-white">
                {activeItem ? t(activeItem.labelKey, activeItem.labelDefault) : t('admin.panel')}
              </span>
              <span className="shrink-0 rounded bg-gold-500/90 px-1.5 py-0.5 text-[10px] font-bold text-neutral-900">ADMIN</span>
            </div>
            <Link
              to="/home"
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-white/10"
            >
              {t('nav.userArea')}
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="page-slide-in h-full">{children}</div>
        </main>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 bg-black/40" aria-hidden="true" onClick={closeDrawer} />
        )}

        <div
          role="dialog"
          aria-label={t('admin.panel')}
          className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white shadow-xl transition-transform duration-300 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex h-14 items-center justify-between border-b border-neutral-200 px-4">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-neutral-900">Zobia</span>
              <span className="rounded bg-gold-100 px-1.5 py-0.5 text-xs font-semibold text-gold-700">ADMIN</span>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label={t('nav.closeMenu')}
              className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100"
            >
              <span aria-hidden="true" className="text-xl leading-none">✕</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <Link
              to="/home"
              onClick={closeDrawer}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              <span className="text-base leading-none">←</span>
              {t('nav.userArea')}
            </Link>

            <div className="my-2 border-t border-neutral-200" />

            <nav className="space-y-0.5" aria-label={t('admin.panel')}>
              {adminNavItems.map((item) => {
                const isActive = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={closeDrawer}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
                    {t(item.labelKey, item.labelDefault)}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex-none border-t border-neutral-200 p-3">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-danger-600 hover:bg-danger-50"
            >
              🚪 {t('nav.logout')}
            </button>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
