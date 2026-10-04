import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**", "research/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
