#!/usr/bin/env node
// Builds lib/analysis/syllables.json from the public CMU Pronouncing Dictionary.
// The table keeps only words whose first cmudict pronunciation has a syllable
// count different from orthographicSyllables(), grouped by count. A lookup
// that misses the table falls back to the orthographic rule, so every cmudict
// word still gets its dictionary count.
//
// Run: node scripts/build-syllable-table.mjs [path/to/cmudict.dict]
// Needs Node 22.18 or later, which loads the .ts import below without a build.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { orthographicSyllables } from "../lib/analysis/orthographic.ts";

const SOURCE = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const text = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : await (await fetch(SOURCE)).text();

const counts = new Map();
let entries = 0;
for (const line of text.split("\n")) {
  const m = line.match(/^(\S+)\s+(.+?)(\s+#.*)?$/);
  if (!m) continue;
  const head = m[1];
  if (/\(\d+\)$/.test(head)) continue; // alternate pronunciation; keep the first
  entries++;
  const syl = m[2].split(/\s+/).filter((p) => /\d$/.test(p)).length;
  if (syl === 0) continue;
  if (syl !== orthographicSyllables(head)) counts.set(head, syl);
}

const byCount = {};
for (const [w, n] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  (byCount[n] ??= []).push(w);
}
const out = {
  source: SOURCE,
  rule: "first pronunciation; only words that differ from orthographicSyllables()",
  dictionaryEntries: entries,
  exceptions: Object.fromEntries(Object.entries(byCount).map(([n, ws]) => [n, ws.join(" ")])),
};
writeFileSync(join(ROOT, "lib/analysis/syllables.json"), JSON.stringify(out) + "\n");
console.log(`syllables.json: ${counts.size} exceptions from ${entries} entries`);
