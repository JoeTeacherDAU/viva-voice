# Viva Voice: design tokens

Viva Voice follows the Weevil Labs design schema so it reads as a sibling of Markomatic. Source, read 2026-10-04: the `:root` block in `~/CC Projects/weevillabs-site/index.html`. The Markomatic repository is not on this Mac (the `mark-o-matic` folder contains only a `.claude` directory), and markomatic.app's compiled CSS refused both fetch routes, so the Weevil Labs site is the brand authority here. When Joe locates the Markomatic source, compare its `globals.css` against this file and reconcile in one commit.

## Tokens

Copy these into `app/globals.css` as CSS variables and into `tailwind.config.ts` as theme colors with the same names.

```
--bg: #000000;
--surface-low: #0a0f0d;
--surface: #111a16;
--surface-high: #17241e;
--surface-highest: #1c2e26;
--surface-bright: #22382e;
--on-surface: #e8f0ec;
--on-surface-variant: #a5b8b0;
--outline: #6f8a7e;
--outline-variant: #3d5248;
--primary: #10B981;
--primary-dim: #0d9b6a;
--primary-container: #00CEA6;
--secondary: #00CEA6;
--tertiary: #00DCFD;
--success: #10B981;
```

Dark theme only. `<html class="dark">` as on the Weevil Labs site. No light mode in version one.

## Type

Space Grotesk from Google Fonts, weights 300 to 700, with `system-ui, sans-serif` fallback. Load it through `next/font/google` so it bundles with the app and the exam room never waits on a font request. Material Symbols Outlined for icons, same source as the Weevil Labs site.

The DOCX keeps Sukhumvit Set with Calibri fallback (PLAN.md 11.1), because the document is a teaching artifact under Joe's course typography and the web app is a Weevil Labs product.

## Shape

Border radius: 16 px for cards and panels, 10 px for inputs and small controls, 9999 px for pills and the talk-time bar ends. Buttons: filled `--primary` with `--bg` text at weight 600 for the single primary action on a screen; outlined `--outline-variant` with `--on-surface` text for everything else. Disabled: opacity 0.4.

## Fault and state colours

Viva Voice adds three tokens the brand file does not have, because an exam-room display needs them:

```
--fault: #EF4444;
--warn: #F59E0B;
--hidden-slot: #1c2e26;   (same as --surface-highest; the masked index slot)
```

Student A uses `--primary` (#10B981) and student B uses `--tertiary` (#00DCFD) everywhere the two appear side by side: the talk-time bar, the index slots, the counters, the level meters, and the transcript speaker labels in the review screen. Never swap them between screens.

## Live display specifics

Background `--bg`. Numbers at 96 px or larger in weight 600. Labels at 20 px in `--on-surface-variant`. The talk-time bar is 48 px tall, full width, two fills meeting in the middle with no gap. The fault strip is the top 12 px of the viewport: `--surface` when clear, `--warn` during a reconnect, `--fault` on a drop. Score buttons are 72 px squares in a row at the bottom, outlined until tapped, then filled `--primary`. The hidden index slot shows a `--hidden-slot` block with no text until the first tap.

Contrast check: `--on-surface` on `--bg` and `--primary` on `--bg` both pass WCAG AA for large text. Run `scripts/contrast-check.mjs` in Phase 5 to confirm every pairing used on the display.

## Setup and review screens

Standard Markomatic-style layout: a `--surface` card on `--bg`, 16 px radius, 24 px padding, one primary button per card. Level meters use `--primary` and `--tertiary` fills on `--surface-highest` tracks. Blocking warnings use `--fault` text on `--surface` with a Material Symbols `error` icon.
