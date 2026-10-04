# CLAUDE.md for viva-voice

This file goes in the repository root at `~/CC Projects/viva-voice`. Claude Code reads it on every session.

## What this project is

Viva Voice records a two-student timed conversation on two microphone channels, transcribes both channels with Deepgram, shows the instructor a four-element live display, and produces one DOCX per student with the transcript and that student's utterance fluency measurements. A Python research layer computes an extended feature set from the same archive. PLAN.md gives the full design. MEASUREMENT_FRAMEWORK.md explains every measure. features.json defines them. build-plan.json is the build order.

## Read before you write

0. RESEARCH_PRINCIPLES.md. It governs every other file; where anything disagrees with it, it wins.
1. build-plan.json. Find the first phase whose acceptance has not passed. Work on that phase only.
2. PLAN.md sections 5 to 11 for whatever the phase touches.
3. DESIGN.md before any screen. features.json for any feature you implement. The id in the registry is the id in the code, the DOCX, the CSV, and the tests.
4. BUILD_LOG.md for what the previous run did and where it stopped.

## How a run goes

1. `npm ci`
2. `npm run lint && npm run test` to confirm the starting state is green. If it is red, fix that first and log it.
3. Do the phase's tasks in order.
4. `npm run lint && npm run test && npm run build`, then the phase's `acceptanceCommand`.
5. One commit: `P<n>: <title>` with a body listing the task ids done. Push.
6. Append to BUILD_LOG.md: date, phase, tasks done, acceptance result, anything deferred, the commit hash.
7. If the acceptance command fails three times, stop. Write a BLOCKED entry with the failing output and what you tried. Do not change the test to make it pass. Do not start the next phase.

## Hard rules

Never create, modify, or delete anything in Vercel, GitHub settings, Deepgram, or Porkbun. Pushing to a branch for a preview deploy is fine. Production deploys happen only from `main` through Vercel's git integration after Joe merges.

Never commit `.env*`, API keys, or audio outside `fixtures/golden/`. Fixture audio is synthetic (sine bursts), never a human voice.

Never read, log, or export anything under the `roster/` Blob prefix from research or export code.

`lib/analysis/` imports nothing from `window`, `document`, `node:*`, or `next/*`. It runs in the browser and in a Vercel Function.

A feature exists only if it has an entry in `lib/registry/features.json`. Add the entry, then the function, then a fixture expectation. `scripts/feature-coverage.mjs` fails the build otherwise.

Tier 1 features stay in TypeScript. Tier 2 and 3 features live under `research/` in Python and never deploy.

## Style for files Joe reads

Markdown for Joe (BUILD_LOG.md, docs/*.md, REPLICATION.md): no em dashes, active voice in every tense, complete sentences, no tables, lists only where organization needs them. Use the simplest verb. Say what happened to the specific thing; never close on a general truth. Code comments follow the same rules.

## Commands

- `npm run dev` with `VIVA_MOCK_ASR=1` for a local session with the mock transcriber
- `npm run test` (vitest), `npm run test:e2e` (Playwright, headless Chromium with fake media devices)
- `node scripts/make-fixtures.mjs` to regenerate golden fixtures
- `node scripts/feature-coverage.mjs` to check the registry against the code and fixtures
- `cd research && uv run viva-research export --exam <id> --tiers 2` for the research export

## Decisions already made

docs/rulings.md records five decisions: the app stores the live score and keeps it out of every student output; retention is 24 months for audio and transcripts; a failed V1 means a USB interface; the tap scale is 1 to 5; the exam machine is Chrome on a MacBook Air. Follow them. For any new decision of that kind, write the question in BUILD_LOG.md and stop that task.
