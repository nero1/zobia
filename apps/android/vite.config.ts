import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    TanStackRouterVite(),
  ],
  resolve: {
    alias: [
      { find: "@zobia/shared/schemas/auth", replacement: path.resolve(__dirname, "../../shared/schemas/api/auth.ts") },
      { find: "@zobia/shared/schemas/coins", replacement: path.resolve(__dirname, "../../shared/schemas/api/coins.ts") },
      { find: "@zobia/shared/schemas/user", replacement: path.resolve(__dirname, "../../shared/schemas/api/user.ts") },
      { find: "@zobia/shared/schemas/notifications", replacement: path.resolve(__dirname, "../../shared/schemas/api/notifications.ts") },
      { find: "@zobia/shared/schemas/economy", replacement: path.resolve(__dirname, "../../shared/schemas/api/economy.ts") },
      { find: "@zobia/shared/schemas", replacement: path.resolve(__dirname, "../../shared/schemas/index.ts") },
      { find: "@zobia/shared/types", replacement: path.resolve(__dirname, "../../shared/types/index.ts") },
      { find: "@zobia/shared/utils", replacement: path.resolve(__dirname, "../../shared/utils/index.ts") },
      { find: "@zobia/shared/i18n/locales/en", replacement: path.resolve(__dirname, "../../shared/i18n/locales/en.json") },
      { find: "@zobia/shared/i18n/locales/fr", replacement: path.resolve(__dirname, "../../shared/i18n/locales/fr.json") },
      { find: "@zobia/shared/i18n/locales/ar", replacement: path.resolve(__dirname, "../../shared/i18n/locales/ar.json") },
      { find: "@zobia/shared/i18n/locales/ha", replacement: path.resolve(__dirname, "../../shared/i18n/locales/ha.json") },
      { find: "@zobia/shared/i18n/locales/sw", replacement: path.resolve(__dirname, "../../shared/i18n/locales/sw.json") },
      { find: "@zobia/shared/i18n/locales/am", replacement: path.resolve(__dirname, "../../shared/i18n/locales/am.json") },
      { find: "@zobia/shared/i18n/locales/zu", replacement: path.resolve(__dirname, "../../shared/i18n/locales/zu.json") },
      { find: "@zobia/shared/i18n/locales/pt", replacement: path.resolve(__dirname, "../../shared/i18n/locales/pt.json") },
      { find: "@zobia/shared/i18n/locales/pidgin", replacement: path.resolve(__dirname, "../../shared/i18n/locales/pidgin.json") },
      { find: "@zobia/shared/i18n", replacement: path.resolve(__dirname, "../../shared/i18n/locales.ts") },
      { find: "@zobia/shared", replacement: path.resolve(__dirname, "../../shared") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["@tanstack/react-router"],
          query: ["@tanstack/react-query"],
          i18n: ["i18next", "react-i18next"],
        },
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
