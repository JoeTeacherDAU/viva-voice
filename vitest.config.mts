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
      exclude: ["**/*.test.ts", "lib/analysis/testutil.ts"],
      reporter: ["text-summary", "lcov"],
      // build-plan P2.11: 90 % on the analysis pipeline.
      thresholds: {
        "lib/analysis/**": { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
