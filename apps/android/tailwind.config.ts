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
  plugins: [],
};

export default config;
