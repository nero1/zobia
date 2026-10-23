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
    dedupe: ["react", "react-dom", "i18next", "react-i18next"],
    alias: [
      { find: "@zobia/shared/schemas/auth", replacement: path.resolve(__dirname, "../../shared/schemas/api/auth.ts") },
      { find: "@zobia/shared/schemas/coins", replacement: path.resolve(__dirname, "../../shared/schemas/api/coins.ts") },
      { find: "@zobia/shared/schemas/user", replacement: path.resolve(__dirname, "../../shared/schemas/api/user.ts") },
      { find: "@zobia/shared/schemas/notifications", replacement: path.resolve(__dirname, "../../shared/schemas/api/notifications.ts") },
      { find: "@zobia/shared/schemas/economy", replacement: path.resolve(__dirname, "../../shared/schemas/api/economy.ts") },
      { find: "@zobia/shared/schemas", replacement: path.resolve(__dirname, "../../shared/schemas/index.ts") },
      { find: "@zobia/shared/types", replacement: path.resolve(__dirname, "../../shared/types/index.ts") },
      { find: "@zobia/shared/utils", replacement: path.resolve(__dirname, "../../shared/utils/index.ts") },
      { find: /^@zobia\/shared\/i18n\/locales\/(.+)$/, replacement: path.resolve(__dirname, "../../shared/i18n/locales") + "/$1.json" },
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
