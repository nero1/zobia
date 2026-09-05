import type { Config } from "tailwindcss";
const tokens = require("../../shared/tailwind-tokens.js");

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: { ...tokens },
  },
  // @tailwindcss/typography powers the `.prose` classes used to render
  // sanitized markdown-derived HTML (blog posts, announcements) — without
  // it those utility classes are no-ops and headings/lists/blockquotes/code
  // blocks render as unstyled, visually-joined plain text.
  plugins: [require("@tailwindcss/typography")],
};

export default config;
