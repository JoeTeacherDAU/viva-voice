#!/usr/bin/env node
// Confirms the golden fixtures exist and are complete (build-plan P1 acceptance).
// For each fixture: every file is present, stereo.wav parses as 48 kHz 16-bit
// stereo PCM, words.json is a non-empty word list, and expected.json carries a
// value for every tier 1 feature, for both students, both passes, and every
// pause threshold the feature takes.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = ["balanced", "asymmetric", "gappy"];
const FILES = [
  "stereo.wav",
  "words.json",
  "energy.json",
  "expected.json",
  "session.json",
  "baseline.json",
];
const registry = JSON.parse(readFileSync(join(ROOT, "lib/registry/features.json"), "utf8"));
const tier1 = registry.features.filter((f) => f.tier === 1);

const problems = [];

function checkWav(path) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    return "not a RIFF/WAVE file";
  }
  const format = b.readUInt16LE(20);
  const channels = b.readUInt16LE(22);
  const rate = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  if (format !== 1 || channels !== 2 || rate !== 48000 || bits !== 16) {
    return `format ${format}, ${channels} ch, ${rate} Hz, ${bits} bit`;
  }
  const dataBytes = b.readUInt32LE(40);
  if (dataBytes !== b.length - 44)
    return `data chunk says ${dataBytes} bytes, file has ${b.length - 44}`;
  return null;
}

for (const name of FIXTURES) {
  const dir = join(ROOT, "fixtures", "golden", name);
  for (const f of FILES) {
    if (!existsSync(join(dir, f))) problems.push(`${name}: missing ${f}`);
  }
  if (problems.some((p) => p.startsWith(`${name}:`))) continue;

  const wavProblem = checkWav(join(dir, "stereo.wav"));
  if (wavProblem) problems.push(`${name}: stereo.wav ${wavProblem}`);

  const words = JSON.parse(readFileSync(join(dir, "words.json"), "utf8"));
  if (!Array.isArray(words) || words.length === 0) problems.push(`${name}: words.json is empty`);

  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  const have = new Set(
    expected.values.map((v) => `${v.featureId}|${v.participant}|${v.pass}|${v.thresholdMs}`),
  );
  for (const f of tier1) {
    const thresholds = Array.isArray(f.params.pauseThresholdMs) ? f.params.pauseThresholdMs : null;
    for (const participant of ["A", "B"]) {
      for (const pass of [1, 2]) {
        const keys = thresholds
          ? thresholds.map((t) => `${f.id}|${participant}|${pass}|${t}`)
          : [null, 350].map((t) => `${f.id}|${participant}|${pass}|${t}`);
        const ok = thresholds ? keys.every((k) => have.has(k)) : keys.some((k) => have.has(k));
        if (!ok)
          problems.push(`${name}: expected.json lacks ${f.id} for ${participant} pass ${pass}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`check-fixtures: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `check-fixtures: ${FIXTURES.length} fixtures complete, ${tier1.length} tier 1 features each`,
);
