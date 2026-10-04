#!/usr/bin/env node
// WCAG contrast for every foreground/background pairing the live display uses
// (build-plan P5.7). Reads the tokens from app/globals.css and fails below 3.0,
// the WCAG AA threshold for large text. Every number on the display is 48 px
// or larger and every label is 20 px, so large-text rules apply.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
const tokens = Object.fromEntries(
  [...css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
);

const PAIRS = [
  ["on-surface", "bg", "timer and score digits"],
  ["on-surface-variant", "bg", "labels on the background"],
  ["primary", "bg", "student A talk-time label"],
  ["tertiary", "bg", "student B talk-time label"],
  ["on-surface-variant", "surface", "labels inside the student cards"],
  ["primary", "surface", "student A index and counter"],
  ["tertiary", "surface", "student B index and counter"],
  ["bg", "primary", "digit on a tapped score button"],
  ["on-surface", "surface", "text on cards"],
  ["warn", "bg", "fault reason text"],
  ["fault", "surface", "blocking warnings on setup cards"],
];

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let failed = 0;
for (const [fg, bg, use] of PAIRS) {
  if (!tokens[fg] || !tokens[bg]) {
    console.error(`missing token --${fg} or --${bg}`);
    failed++;
    continue;
  }
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = r >= 3;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${r.toFixed(2)}:1  --${fg} on --${bg}  (${use})`);
}
if (failed) {
  console.error(`contrast-check: ${failed} pairing(s) under 3.0:1`);
  process.exit(1);
}
console.log(`contrast-check: all ${PAIRS.length} pairings reach 3.0:1`);
