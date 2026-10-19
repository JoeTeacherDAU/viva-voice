// Runs a TypeScript command from scripts/cli. esbuild bundles it with the
// project's "@/..." paths into node_modules/.cache as CommonJS, leaves packages external,
// and Node runs the bundle with the remaining arguments.

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const entry = process.argv[2];
if (!entry) {
  console.error("Usage: node scripts/run-ts.mjs <file.ts> [args]");
  process.exit(1);
}
const outdir = resolve("node_modules/.cache/viva-cli");
mkdirSync(outdir, { recursive: true });
const outfile = resolve(outdir, basename(entry).replace(/\.ts$/, ".cjs"));
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});
process.argv.splice(2, 1);
await import(pathToFileURL(outfile).href);
