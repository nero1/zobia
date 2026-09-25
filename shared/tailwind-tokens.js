/** @type {import('tailwindcss').Config['theme']['extend']} */
module.exports = {
  colors: {
    primary: {
      50: "#eff6ff",
      100: "#dbeafe",
      200: "#bfdbfe",
      300: "#93c5fd",
      400: "#60a5fa",
      500: "#3b82f6",
      600: "#2563eb",
      700: "#1d4ed8",
      800: "#1e40af",
      900: "#1e3a8a",
      950: "#172554",
      // Theme-aware DEFAULT/foreground pair (CSS vars set in globals.css for
      // :root/.dark). Coexists with the numeric shade scale above — e.g.
      // `bg-primary` resolves via the var, `bg-primary-600` via the shade.
      DEFAULT: "hsl(var(--primary))",
      foreground: "hsl(var(--primary-foreground))",
    },
    // Shadcn-style semantic tokens, theme-aware via CSS vars (see globals.css
    // :root / .dark blocks in apps/web and apps/android). These back the
    // `bg-card`, `text-foreground`, `border-border`, `bg-accent`,
    // `text-muted-foreground` classes used throughout the games UI and
    // elsewhere; without them Tailwind silently drops the unknown utility
    // (transparent bg / inherited text), which is why buttons on a couple of
    // pages were rendering invisibly against the dark background.
    background: "hsl(var(--background))",
    foreground: "hsl(var(--foreground))",
    card: {
      DEFAULT: "hsl(var(--card))",
      foreground: "hsl(var(--card-foreground))",
    },
    border: "hsl(var(--border))",
    input: "hsl(var(--input))",
    accent: {
      DEFAULT: "hsl(var(--accent))",
      foreground: "hsl(var(--accent-foreground))",
    },
    muted: {
      DEFAULT: "hsl(var(--muted))",
      foreground: "hsl(var(--muted-foreground))",
    },
    success: {
      50: "#f0fdf4",
      100: "#dcfce7",
      200: "#bbf7d0",
      300: "#86efac",
      400: "#4ade80",
      500: "#22c55e",
      600: "#16a34a",
      700: "#15803d",
      800: "#166534",
      900: "#14532d",
      950: "#052e16",
    },
    gold: {
      50: "#fffbeb",
      100: "#fef3c7",
      200: "#fde68a",
      300: "#fcd34d",
      400: "#fbbf24",
      500: "#f59e0b",
      600: "#d97706",
      700: "#b45309",
      800: "#92400e",
      900: "#78350f",
      950: "#451a03",
    },
    // Theme-aware — these used to be static hex, so a site-wide re-skin
    // (see gate44/config "Theming" group + settings.siteTheme, and
    // shared/utils/uiThemes.ts) meant touching every component that uses
    // `bg-neutral-*`/`text-neutral-*`/`border-neutral-*` (hundreds of call
    // sites). Routing them through CSS vars set in globals.css'
    // `:root`/`.dark`/`[data-theme="..."]` blocks means a theme switch
    // re-colors the whole app instantly, with zero component changes.
    // Values are HSL triples (see shared/tailwind-tokens numeric-shade note
    // above `primary` for why no hsl() wrapper).
    neutral: {
      50: "hsl(var(--neutral-50))",
      100: "hsl(var(--neutral-100))",
      200: "hsl(var(--neutral-200))",
      300: "hsl(var(--neutral-300))",
      400: "hsl(var(--neutral-400))",
      500: "hsl(var(--neutral-500))",
      600: "hsl(var(--neutral-600))",
      700: "hsl(var(--neutral-700))",
      800: "hsl(var(--neutral-800))",
      900: "hsl(var(--neutral-900))",
      950: "hsl(var(--neutral-950))",
    },
    danger: {
      50: "#fef2f2",
      100: "#fee2e2",
      200: "#fecaca",
      300: "#fca5a5",
      400: "#f87171",
      500: "#ef4444",
      600: "#dc2626",
      700: "#b91c1c",
      800: "#991b1b",
      900: "#7f1d1d",
    },
  },
  fontFamily: {
    sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
    mono: ["JetBrains Mono", "ui-monospace", "monospace"],
  },
  // Base sizes are Tailwind's stock scale x1.3 (the sitewide "+30% font
  // size" pass), then wrapped in calc() against `--font-zoom` (default 1,
  // set in globals.css `:root`) so the Settings > Appearance zoom stepper
  // (shared/utils/uiThemes.ts FONT_ZOOM_STEPS) scales every `text-*`
  // utility at once with no per-component work. line-heights are kept as
  // unitless ratios (not rem) so they scale proportionally with the size
  // automatically instead of needing their own calc().
  fontSize: {
    xs: ["calc(0.975rem * var(--font-zoom, 1))", { lineHeight: "1.4" }],
    sm: ["calc(1.1375rem * var(--font-zoom, 1))", { lineHeight: "1.45" }],
    base: ["calc(1.3rem * var(--font-zoom, 1))", { lineHeight: "1.5" }],
    lg: ["calc(1.4625rem * var(--font-zoom, 1))", { lineHeight: "1.55" }],
    xl: ["calc(1.625rem * var(--font-zoom, 1))", { lineHeight: "1.4" }],
    "2xl": ["calc(1.95rem * var(--font-zoom, 1))", { lineHeight: "1.35" }],
    "3xl": ["calc(2.4375rem * var(--font-zoom, 1))", { lineHeight: "1.2" }],
    "4xl": ["calc(2.925rem * var(--font-zoom, 1))", { lineHeight: "1.15" }],
    "5xl": ["calc(3.9rem * var(--font-zoom, 1))", { lineHeight: "1.1" }],
    "6xl": ["calc(4.875rem * var(--font-zoom, 1))", { lineHeight: "1.05" }],
    "7xl": ["calc(5.85rem * var(--font-zoom, 1))", { lineHeight: "1" }],
    "8xl": ["calc(7.8rem * var(--font-zoom, 1))", { lineHeight: "1" }],
    "9xl": ["calc(10.4rem * var(--font-zoom, 1))", { lineHeight: "1" }],
  },
  borderRadius: {
    // `--radius-scale` (default 1, themed in globals.css) lets a site theme
    // shift sharp-vs-rounded corners app-wide (e.g. Reddit-style is sharper,
    // Facebook-style rounder) without per-component edits.
    DEFAULT: "calc(0.5rem * var(--radius-scale, 1))",
    sm: "calc(0.375rem * var(--radius-scale, 1))",
    md: "calc(0.5rem * var(--radius-scale, 1))",
    lg: "calc(0.75rem * var(--radius-scale, 1))",
    xl: "calc(1rem * var(--radius-scale, 1))",
    "2xl": "calc(1.5rem * var(--radius-scale, 1))",
  },
  boxShadow: {
    card: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    elevated: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    modal: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  },
  animation: {
    "fade-in": "fadeIn 0.2s ease-in-out",
    "slide-up": "slideUp 0.3s ease-out",
    "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
    "ping-fast": "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
    "ping-slow": "ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite",
  },
  keyframes: {
    fadeIn: {
      "0%": { opacity: "0" },
      "100%": { opacity: "1" },
    },
    slideUp: {
      "0%": { transform: "translateY(8px)", opacity: "0" },
      "100%": { transform: "translateY(0)", opacity: "1" },
    },
    ping: {
      "75%, 100%": { transform: "scale(2)", opacity: "0" },
    },
  },
};
