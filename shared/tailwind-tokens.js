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
    neutral: {
      50: "#fafafa",
      100: "#f5f5f5",
      200: "#e5e5e5",
      300: "#d4d4d4",
      400: "#a3a3a3",
      500: "#737373",
      600: "#525252",
      700: "#404040",
      800: "#262626",
      900: "#171717",
      950: "#0a0a0a",
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
  borderRadius: {
    DEFAULT: "0.5rem",
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.75rem",
    xl: "1rem",
    "2xl": "1.5rem",
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
