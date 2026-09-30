"use client";

/**
 * components/portals/HashtagText.tsx
 *
 * Renders user text with `#tags` turned into links to their Portal page
 * (/h/<slug>). Uses the shared tokenizer (@zobia/shared/utils splitHashtags)
 * so web, PWA and the Capacitor app agree on what a hashtag is, and emits
 * React nodes only (no dangerouslySetInnerHTML), so user text can never
 * inject markup.
 *
 * Do NOT use inside another <a>/<Link> (nested anchors are invalid HTML and
 * hydration-unsafe); use `plain` there, which renders the tags as styled
 * text without links.
 */

import Link from "next/link";
import { portalPath, splitHashtags } from "@zobia/shared/utils";

interface HashtagTextProps {
  text: string | null | undefined;
  className?: string;
  /** Render hashtags as styled spans instead of links (for use inside a parent link). */
  plain?: boolean;
  /** Stop click propagation so a tag inside a clickable card doesn't trigger the card. */
  stopPropagation?: boolean;
}

export function HashtagText({ text, className, plain, stopPropagation }: HashtagTextProps) {
  if (!text) return null;
  const segments = splitHashtags(text);
  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.value}</span>;
        if (plain) {
          return (
            <span key={i} className="font-medium text-primary">
              {seg.value}
            </span>
          );
        }
        return (
          <Link
            key={i}
            href={portalPath(seg.slug)}
            className="font-medium text-primary hover:underline"
            onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          >
            {seg.value}
          </Link>
        );
      })}
    </span>
  );
}
