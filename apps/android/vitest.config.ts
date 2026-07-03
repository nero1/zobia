import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuses the same path aliases as vite.config.ts (T10 / ZB-AND-10) so test
// files can import with the same "@/..."/"@zobia/shared/..." specifiers as
// the app code, rather than duplicating the alias list.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/__tests__/**/*.test.ts"],
    },
  })
);
