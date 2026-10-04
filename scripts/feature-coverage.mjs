#!/usr/bin/env node
// Checks the feature registry against the code and the golden fixtures
// (build-plan P2.12). Fails when:
//   - a tier 1 feature has no defineFeature("<id>", ...) under lib/analysis/features,
//   - a tier 1 feature has no non-null expected value in any golden fixture,
//   - code defines a feature id the registry lacks, or defines a non-tier-1 id.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(join(ROOT, "lib/registry/features.json"), "utf8"));
const tierOf = new Map(registry.features.map((f) => [f.id, f.tier]));
const tier1 = registry.features.filter((f) => f.tier === 1).map((f) => f.id);

const featureDir = join(ROOT, "lib/analysis/features");
const defined = new Map();
for (const file of readdirSync(featureDir).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
)) {
  const src = readFileSync(join(featureDir, file), "utf8");
  for (const m of src.matchAll(/defineFeature\(\s*"([a-z0-9_]+)"/g)) defined.set(m[1], file);
}

const goldenDir = join(ROOT, "fixtures/golden");
const withValue = new Set();
for (const fx of readdirSync(goldenDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const expected = JSON.parse(readFileSync(join(goldenDir, fx.name, "expected.json"), "utf8"));
  for (const v of expected.values) if (v.value !== null) withValue.add(v.featureId);
}

const problems = [];
for (const id of tier1) {
  if (!defined.has(id)) problems.push(`${id}: no defineFeature in lib/analysis/features`);
  if (!withValue.has(id)) problems.push(`${id}: no non-null expected value in any golden fixture`);
}
for (const [id, file] of defined) {
  if (!tierOf.has(id)) problems.push(`${id} (${file}): not in lib/registry/features.json`);
  else if (tierOf.get(id) !== 1)
    problems.push(`${id} (${file}): tier ${tierOf.get(id)} belongs in research/`);
}

if (problems.length) {
  console.error(`feature-coverage: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `feature-coverage: all ${tier1.length} tier 1 features have a function and a fixture value`,
);
