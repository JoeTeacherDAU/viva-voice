#!/usr/bin/env node
// Bundles each lib/audio/worklets/*.worklet.ts into public/worklets/*.js.
// An AudioWorklet loads from its own script URL, so the TypeScript sources
// (and the DSP code they import) need a standalone bundle. Runs before
// `npm run dev` and `npm run build`.

import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "lib/audio/worklets");
const entries = readdirSync(SRC).filter((f) => f.endsWith(".worklet.ts"));

await build({
  entryPoints: entries.map((f) => join(SRC, f)),
  outdir: join(ROOT, "public/worklets"),
  entryNames: "[name]",
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  logLevel: "warning",
});
console.log(`build-worklets: ${entries.length} worklets -> public/worklets/`);
