"use client";

/**
 * GameCoverNav — top navigation for public /g/[slug] cover pages.
 * Shows Zobia logo + login/signup links for guests,
 * or logo + "My Games" + profile link for logged-in users.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface NavUser { username: string | null; avatar_emoji: string | null }

export default function GameCoverNav({ slug }: { slug: string }) {
  const [user, setUser] = useState<NavUser | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(json => setUser(json?.user ?? null))
      .catch(() => setUser(null));
  }, []);

  return (
    <nav className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-30">
      <Link href="/" className="text-lg font-bold text-foreground tracking-tight">
        Zobia
      </Link>

      <div className="flex items-center gap-3">
        {user === undefined ? null : user === null ? (
          <>
            <Link
              href={`/login?next=/g/${slug}/play`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Log in
            </Link>
            <Link
              href={`/signup?next=/g/${slug}/play`}
              className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-full font-semibold hover:opacity-90 transition-opacity"
            >
              Sign up
            </Link>
          </>
        ) : (
          <>
            <Link href="/games" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              🎮 Games
            </Link>
            <Link
              href={user.username ? `/u/${user.username}` : "/profile"}
              className="text-lg leading-none"
              title={user.username ?? "Profile"}
            >
              {user.avatar_emoji ?? "👤"}
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
