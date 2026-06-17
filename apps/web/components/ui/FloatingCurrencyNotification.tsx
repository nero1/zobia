"use client";

import { useEffect, useState } from "react";

export interface FloatingItem {
  id: string;
  label: string;     // "+50 XP" or "+25 Credits" etc.
  colorClass: string; // tailwind bg color class
  textClass: string;  // tailwind text color class
}

interface Props {
  item: FloatingItem;
  index: number; // used to stagger vertical position
  onDone: (id: string) => void;
}

export function FloatingCurrencyNotification({ item, index, onDone }: Props) {
  const [phase, setPhase] = useState<"enter" | "rise" | "fade">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("rise"), 50);
    const t2 = setTimeout(() => setPhase("fade"), 1700);
    const t3 = setTimeout(() => onDone(item.id), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [item.id, onDone]);

  const translateY = phase === "enter" ? "0px" : phase === "rise" ? "-140px" : "-180px";
  const opacity = phase === "fade" ? 0 : 1;
  // Stagger: each notification starts 64px higher than the previous
  const bottomOffset = 80 + index * 64;

  return (
    <div
      aria-live="polite"
      aria-label={item.label}
      style={{
        position: "fixed",
        bottom: `${bottomOffset}px`,
        left: "50%",
        transform: `translateX(-50%) translateY(${translateY})`,
        opacity,
        transition: `transform 2.4s cubic-bezier(0.2, 0.8, 0.4, 1), opacity 0.8s ease-in`,
        zIndex: 9999,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full px-4 py-2 text-base font-bold shadow-lg ${item.colorClass} ${item.textClass}`}
        style={{ backdropFilter: "blur(8px)" }}
      >
        {item.label}
      </span>
    </div>
  );
}
