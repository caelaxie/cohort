import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/renderer/src/test-setup.ts"],
    environment: "node",
    environmentMatchGlobs: [["src/renderer/**/*.test.tsx", "jsdom"]],
  },
});
