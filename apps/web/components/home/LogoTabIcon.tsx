"use client";

/**
 * components/home/LogoTabIcon.tsx
 *
 * Renders the site logo (/images/logosmall.png) for the Home tab bar's
 * default logo-only tab. The asset doesn't exist in the repo yet (see
 * public/images/README.md) — this defends against that with an onError
 * fallback to a simple "Z" text/emoji placeholder so the tab bar never
 * breaks before the real file is uploaded.
 */

import { useState } from "react";
import Image from "next/image";

export function LogoTabIcon({ size = 22 }: { size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="flex items-center justify-center rounded-full bg-blue-600 font-extrabold text-white"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden="true"
      >
        Z
      </span>
    );
  }

  return (
    <Image
      src="/images/logosmall.png"
      alt=""
      width={size}
      height={size}
      className="rounded-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
