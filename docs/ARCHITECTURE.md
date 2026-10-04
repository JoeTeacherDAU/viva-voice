# Architecture

Viva Voice is one Next.js application on Vercel with one private Blob store. PLAN.md section 13 gives the summary; this file says where each piece lives in the repository.

## Browser

The browser captures two microphone channels, streams them to Deepgram, runs the pass-one pipeline for the live display, builds the WAV at Stop, and uploads the archive. Screens live under `app/`: `app/(auth)/login`, `app/setup`, `app/session`, `app/review/[id]`, and `app/import`. Shared components live in `lib/ui/` and follow DESIGN.md. The page `/dev/ui` renders each component once.

## Server

Route handlers under `app/api/` run as Vercel Functions: `login`, `asr/grant`, `upload`, `file`, `pass2`, and `export`. The file `proxy.ts` (the Next.js 16 name for middleware) checks the signed session cookie on every route except `/login` and `/api/login`. Each handler that touches data also calls `requireAuth` from `lib/auth/requireAuth.ts` as a second check.

## Shared code

`lib/analysis/` holds the measurement pipeline. It imports nothing from the browser, Node, or Next, so the browser runs it on pass one and the pass-two function runs the same code. `lib/analysis/types.ts` defines the word, config, and session types, which mirror `schemas/words.schema.json` and `schemas/session.schema.json`.

`lib/registry/` loads `lib/registry/features.json`, checks it against `schemas/features.schema.json` when the module loads, and exports `get`, `byTier`, and `byConstruct`. From phase P1 on, `lib/registry/features.json` is the registry of record. The copy of features.json at the repository root stays as the plan document.

`lib/asr/` defines the `Transcriber` interface. `createTranscriber()` returns the mock provider when `VIVA_MOCK_ASR=1` and the Deepgram adapter otherwise.

`lib/validation.ts` checks session records and word lists against their schemas.

## Fixtures

`scripts/make-fixtures.mjs` writes three synthetic sessions to `fixtures/golden/`: balanced, asymmetric, and gappy. Each holds a stereo WAV of sine bursts, the word list, energy frames, a session record, a baseline, and `expected.json` with every tier 1 value. The script computes those values from the authored conversation and never calls the pipeline. docs/OPERATIONAL_DEFINITIONS.md states the rules both sides follow. `scripts/check-fixtures.mjs` confirms each fixture is complete.

## Capture and the live session

lib/audio holds the capture graph (capture.ts), the two AudioWorklets under lib/audio/worklets, the DSP they share (dsp.ts), device rules (devices.ts), the WAV builder (wav.ts), the onboard decoder and aligner (decode.ts, align.ts), and a synthetic stereo source for tests (synthetic.ts). scripts/build-worklets.mjs bundles the worklets into public/worklets before every dev and build run. lib/storage/local.ts is the IndexedDB crash buffer.

lib/session/controller.ts drives a live session: it forwards audio to the transcriber, recomputes pass one every 10 seconds, counts target structures, estimates talk time, and raises faults. lib/session/state.ts is the state machine. lib/asr/providers/deepgram.ts is the live adapter, lib/asr/clock.ts the session clock, and lib/asr/batch.ts the pass-two transcriber.

## Archive and outputs

lib/storage/store.ts wraps the private Blob store and the in-memory fake that CI uses. lib/storage/archive.ts uploads a session from the browser after Stop. lib/output/pass2.ts runs pass two and writes everything downstream of it: transcript, measurements, documents (studentDoc.ts), cohort CSVs (csv.ts), the baseline, and the instructor file. lib/output/replicate.ts compares a fresh run with stored measurements, and lib/output/retention.ts carries out ruling R2. docs/REPLICATION.md explains how to reproduce a measurement.

## Research

`research/` holds the Python layer for tier 2 and tier 3 features. Each module under research/viva declares the registry ids it computes and the ids it owns but skips, with the reason. `uv run viva-research export` reads a local copy of the archive and writes long.csv and manifest.json. It never reads the roster and never deploys.
