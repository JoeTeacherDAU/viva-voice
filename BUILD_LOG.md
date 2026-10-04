# Build log

Each agent run appends one entry: date, phase, tasks done, acceptance result, anything deferred, and the commit hash. A run records the hash after it commits, so each entry's hash line lands in the repository with the next commit.

## 2026-10-04, P1: Skeleton, CI, auth, schemas, registry, mock transcriber, fixtures

Before starting I pushed the plan commit ad4ac2a to origin main.

Tasks done: P1.1, P1.2, P1.2b, P1.3, P1.4, P1.5, P1.6, P1.7, P1.8, P1.9.

Acceptance: `npm run lint && npm run test && npm run build && node scripts/check-fixtures.mjs` exited 0 on the first attempt. Vitest ran 38 tests in 8 files. I also started `next dev` with a throwaway password and confirmed with curl that an unauthenticated page redirects to /login, an unauthenticated API call returns 401, a wrong password returns 401, and the right password sets a cookie that opens /dev/ui.

What I built:

- A Next.js 16 app with TypeScript strict, Tailwind v4, ESLint with Prettier, Vitest, and a husky pre-commit hook that runs lint and test.
- The DESIGN.md tokens in app/globals.css and tailwind.config.ts, Space Grotesk through next/font/google, and Button, Card, Meter, FaultStrip, and Icon in lib/ui with a /dev/ui sheet.
- lib/registry, which validates lib/registry/features.json against the schema when it loads and rejects malformed input in six unit tests.
- schemas/session.schema.json and schemas/words.schema.json, with TypeScript types in lib/analysis/types.ts and validators in lib/validation.ts.
- Cookie auth in lib/auth, POST /api/login with a constant-time compare, a login page, and proxy.ts guarding every other route.
- The Transcriber interface and a mock provider that replays words as interims, then finals.
- Three golden fixtures (balanced, asymmetric, gappy) and docs/OPERATIONAL_DEFINITIONS.md, which fixes every rule the one-line formulas in features.json leave open.
- .github/workflows/ci.yml and docs/ARCHITECTURE.md.

Places where I departed from the plan, and why:

- Next.js 16 renamed middleware.ts to proxy.ts. The route guard lives in proxy.ts and behaves as P1.5 describes.
- Tailwind v4 reads its settings from CSS. app/globals.css loads tailwind.config.ts with an `@config` line, so the file P1.2b names still holds the colour map.
- next/font/google does not offer Material Symbols Outlined. The app bundles the icon font from the `material-symbols` npm package instead, which also keeps the exam room free of font requests.
- P1.7 names scripts/make-fixtures.ts, while CLAUDE.md runs `node scripts/make-fixtures.mjs`. I wrote the .mjs file so the CLAUDE.md command works with no build step.
- The session schema gains three optional fields the task list omits: `state` (setup, live, closing, done, which P3 and P5 use), `channelMap` (which channel carries which student, which P4 needs), and `config.speechFloorDbfs` (the level at which an energy frame counts as speech, default -60, which the unattributed ratio needs).
- features.json gives talk_time_share, filled_pause_rate, and articulation_rate_sps_est no pause threshold, but each divides by phonation time, which depends on one. All three use 350 ms and record thresholdMs 350. docs/OPERATIONAL_DEFINITIONS.md states this.
- The fixture WAVs run 39 to 62 seconds rather than a full exam length, which keeps the three files at 10 to 12 MB each.

Requests for Joe:

- P1.8 asks for the CI check to be required on main. That is a GitHub setting, which CLAUDE.md puts off limits for me. When you want it, open the repository on GitHub, go to Settings, then Branches, add a rule for main, and tick "Require status checks to pass" with the check named "check".
- Please read docs/OPERATIONAL_DEFINITIONS.md. Phase P2 implements those rules, and the golden fixtures already encode them. Three choices deserve your eye: backchannel tokens such as "right" and "really" leave the pruned count wherever they occur, as P2.5 says; response latency averages keep negative (overlapping) transitions; and the false-start rule is a heuristic that flags any short clause opening followed by "uh" or "um" and an unrelated restart.

Local machine note: this Mac runs Node 25.8.1. CI pins Node 22 as build-plan.json asks.

Deferred: nothing.

Commit: eac500e. GitHub Actions ran ci.yml on that commit and passed in 43 seconds.

## 2026-10-04, P2: Analysis pipeline, all tier 1 features, golden tests

Tasks done: P2.1, P2.2, P2.3, P2.4, P2.5, P2.6, P2.7, P2.8, P2.9, P2.10, P2.11, P2.12.

Acceptance: `npm run test && node scripts/feature-coverage.mjs` exited 0 on the first attempt. Vitest ran 558 tests. The golden test runs the pipeline on all three fixtures for both passes and checks 480 expected values, and every one matched within the plan's tolerances. To confirm the golden test can fail, I raised one expected pause rate by 1 percent and one turn count by 1; the test reported exactly those two failures, and I regenerated the fixtures afterwards. Coverage on lib/analysis reached 98 percent of statements and 93 percent of branches, and vitest.config.mts now fails the coverage run below 90 percent.

What I built:

- lib/analysis modules for windowing and gaps, cross-talk rejection, energy gating, pruning, turns and backchannels, pauses and runs, the composite index, and the pipeline itself, which exports PIPELINE_VERSION 1.0.0 and adds rolling 10-second windows for the four live features.
- One feature file per construct under lib/analysis/features. Each feature registers under its registry id with defineFeature, and the pipeline reads units from the registry.
- lib/analysis/syllables.json, built by scripts/build-syllable-table.mjs from the CMU Pronouncing Dictionary. The table keeps only the 20,101 words whose dictionary count differs from the vowel-group rule, which brings it to 183 KB instead of several megabytes. A word missing from the table gets the rule, so every dictionary word still gets its dictionary count.
- scripts/feature-coverage.mjs. It now runs before every `npm run build`, so a tier 1 feature without a function or a fixture value fails the build, as CLAUDE.md requires.
- An ESLint rule that stops lib/analysis from importing node:*, next, or React, or from touching window or document.

A bug the unit tests caught: cross-talk rejection crashed when a shared phrase began at the first word on both channels, because the run-start check read index minus one. The golden fixtures never put a match there. I fixed the bounds check and kept the test.

Places where I departed from the plan, and why:

- run() takes the session markers, gap events, channel map, and the pass-one features in its options object, beside the `pass` field P2.10 names. The pipeline needs the markers to trim the window and the pass-one features to compute pass agreement.
- The rolling windows run back to back from the Start marker (0 to 10 s, 10 to 20 s, and so on) and drop a final partial window. The live display in P5 can call run() with markers for the last 10 seconds when it needs a trailing window.

Deferred: nothing.

Commit: b24be2a.

## 2026-10-04, P3: Device setup, capture, worklets, buffer, WAV

Tasks done: P3.1, P3.2, P3.3, P3.4, P3.5, P3.6, P3.7.

Acceptance: `npm run test && npm run test:e2e` passed. On this Mac the e2e run reported 4 passed and 1 skipped; on the GitHub Linux runner the same suite reported 5 passed with nothing skipped. The 60-second capture test records exactly 2,880,000 frames from the synthetic stereo source into IndexedDB, builds the WAV, downloads it, and the independent `wavefile` parser in Node reads it as 48 kHz, 16-bit, 2-channel PCM with 2,880,000 samples per channel and signal on both channels.

Attempts: the first local run failed on housekeeping (a leftover probe script, one unformatted file, and ESLint reading the generated worklet bundles). The second local run passed. Two CI runs on the side branch p3 then failed on the test of Chrome's fake microphone, which skips on macOS: the first exposed a race in the test, which read the device list before the lookup finished, and the second showed that the fake microphone is not mono (details below). The third CI run passed, and a final local run passed on the same code.

What I built:

- lib/audio/dsp.ts with 20 ms RMS-to-dBFS framing and a Blackman-windowed sinc decimator from 48 kHz to 16 kHz. A unit test feeds it a 1 kHz tone, which passes at full level, and a 12 kHz tone, which comes out more than 60 dB down.
- Two AudioWorklets, energy and downsample, written in TypeScript under lib/audio/worklets. scripts/build-worklets.mjs bundles them into public/worklets before every dev and build run, because a worklet loads from its own script URL.
- lib/audio/capture.ts, which builds the graph from PLAN.md section 5 and tees raw 48 kHz PCM into IndexedDB through lib/storage/local.ts with a two-second flush and a persistence request.
- lib/audio/wav.ts, which builds the stereo WAV from the IndexedDB store and two mono WAVs on demand.
- lib/audio/devices.ts with the exact constraint set, the settings readback, the blocking rules, and the Chrome-only check from ruling R5.
- The setup screen at /setup: device list, settings readback, two meters, A/B swap, calibration with a proposed gating margin, exam and roster loading, receiver gain and firmware fields, blocking warnings, and a Continue button that writes the session record in state "setup" to IndexedDB. A student whose consent is not "granted" blocks the session, per ruling R2.
- A dev harness at /dev/capture-test, a synthetic stereo source in lib/audio/synthetic.ts, and Playwright tests under tests/e2e. CI now installs Chromium and runs them.
- A demo exam and a demo roster with invented names in fixtures/exams, which the setup screen uses when VIVA_MOCK_ASR=1.

Places where I departed from the plan, and why:

- P3.7 asks for a test in which "a mono fake device shows the channel-count block". Chrome's fake microphone is not mono: on the GitHub Linux runner it reports 2 channels at 44100 Hz. The suite now covers the rule two ways. A "Synthetic mono (test)" device, built like the synthetic stereo one, checks the channel-count block. A second test opens Chrome's real fake microphone through getUserMedia and confirms that the settings come back and that the session blocks, which on Linux happens through the 48000 Hz rule.
- On macOS, headless Chromium cannot open even the fake microphone, because Chrome asks the operating system for permission and nobody can answer the prompt. The test of the real fake microphone therefore skips on macOS with that reason in the code, and CI on Linux runs it. The same finding led me to change the setup screen so it skips the permission prompt when device labels already show, and gives up after 10 seconds instead of waiting forever.
- Playwright uses the full Chromium build in headless mode rather than the stripped headless shell.
- Until P6 adds /api/file, the setup screen can load only the demo exam. A real exam id fails with a clear message.
- The setup screen hands the open stream to the session screen in memory, so the browser does not ask for the microphone twice. /session is a placeholder until P5.

Note for Joe: the branch p3 still exists on GitHub. It holds the three CI check commits that this squashed P3 commit replaces. You can delete it whenever you like; nothing depends on it.

Deferred: nothing.

Commit: recorded in the next entry.
