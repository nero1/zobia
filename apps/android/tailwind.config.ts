import type { Config } from "tailwindcss";
const tokens = require("../../shared/tailwind-tokens.js");

const config: Config = {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: { ...tokens },
  },
  // Mirrors apps/web's fix — .prose classes render blog post/announcement
  // HTML; without this plugin they're no-ops and content renders unstyled.
  plugins: [require("@tailwindcss/typography")],
};

export default config;
