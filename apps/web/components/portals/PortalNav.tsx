"use client";

/**
 * components/portals/PortalNav.tsx
 *
 * Top bar for the public portal pages (/h, /h/<slug>). Same idea as
 * components/games/GameCoverNav.tsx: Zobia logo + login/signup for guests,
 * or shortcuts back into the app for signed-in users.
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth/hooks";
import { Icon } from "@/components/ui/Icon";

export function PortalNav({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  return (
    <nav className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
      <Link href="/" className="text-lg font-bold tracking-tight text-foreground">
        Zobia
      </Link>
      <div className="flex items-center gap-3">
        <Link href="/h" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <Icon emoji="🧭" size={14} /> {t("portals.title")}
        </Link>
        {isLoading ? null : user ? (
          <Link href="/home" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            {t("portals.backToApp")}
          </Link>
        ) : (
          <>
            <Link href={`/auth/login?redirect=${encodeURIComponent(redirectTo)}`} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {t("portals.login")}
            </Link>
            <Link href="/auth/register" className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              {t("portals.signUp")}
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
