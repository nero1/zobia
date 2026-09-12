/**
 * apps/android/src/components/home/LogoTabIcon.tsx
 *
 * Mirrors apps/web/components/home/LogoTabIcon.tsx. Vite serves this app's
 * `public/` folder at the site root exactly like Next.js's `public/`
 * (see public/icon.svg), so the same eventual filename/location as web's
 * `/images/logosmall.png` is used here — place the file at
 * apps/android/public/images/logosmall.png when it's ready. The asset
 * doesn't exist yet, so this defends against that with a plain <img>
 * onError fallback to a simple "Z" text/emoji placeholder, same as web,
 * so the tab bar never breaks before the real file is uploaded.
 */

import { useState } from 'react';

export function LogoTabIcon({ size = 22 }: { size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="flex items-center justify-center rounded-full bg-primary-600 font-extrabold text-white"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden="true"
      >
        Z
      </span>
    );
  }

  return (
    <img
      src="/images/logosmall.png"
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="rounded-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
