import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // CLAUDE.md: lib/analysis runs in the browser and in a Vercel Function.
    files: ["lib/analysis/**/*.ts"],
    ignores: ["lib/analysis/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["node:*", "next", "next/*", "fs", "path", "react", "react-dom"] },
      ],
      "no-restricted-globals": ["error", "window", "document", "navigator", "localStorage"],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**", "research/**"]),
]);

export default eslintConfig;
