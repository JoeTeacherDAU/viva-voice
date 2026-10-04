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

Commit: 584e23a.

## 2026-10-04, P4: Deepgram live adapter, grant route, session clock, reconnection

Tasks done: P4.1, P4.2, P4.3, P4.4, P4.5, P4.6.

Acceptance: `npm run test` exited 0 on the first attempt with 584 tests passing and 1 skipped. The skipped test is the live Deepgram test, which reports "skipped: DEEPGRAM_API_KEY is not set", as the phase's human gate expects.

What I built:

- POST /api/asr/grant, which checks the session cookie, trades DEEPGRAM_API_KEY for a 60-second JWT at Deepgram's grant endpoint, and returns {token, expiresIn}. Unit tests with a mocked fetch confirm the request shape, the 401 without a cookie, the error paths, and that the key appears in no response and no log line.
- lib/asr/providers/deepgram.ts, which builds the exact PLAN.md 6.1 query, opens the socket with ['bearer', jwt], parses Results messages by channel_index, maps channels to students, sends KeepAlive every 5 seconds, and sends CloseStream on close. A comment in the code explains why an is_final result counts as final whatever speech_final says.
- lib/asr/clock.ts. The clock counts every audio chunk, including chunks dropped while the socket is down, and records the session time at which each connection sent its first chunk. A word's session time is that offset plus Deepgram's timestamp, and the dropped stretch becomes a gap event with exact bounds.
- Reconnection with delays of 0.5, 1, 2, 4, and 4 seconds, five tries, and a fresh grant per try, after which the adapter reports a fatal fault. The adapter exposes its state for the P5 fault strip.
- fixtures/deepgram/balanced-stream.json, 105 messages built by scripts/make-deepgram-fixture.mjs from the balanced fixture's words. One unit test replays the whole stream through the adapter, runs the pipeline on the resulting final words, and reproduces every pass-one value in the balanced expected.json.
- createTranscriber() now returns the Deepgram adapter unless VIVA_MOCK_ASR=1.

Places where I departed from the plan, and why:

- P4.4 lists four backoff delays (0.5, 1, 2, 4 seconds) and five tries. The fifth try reuses the 4-second delay.
- P4.6 asks the live test to stream fixtures/golden/balanced/stereo.wav and assert words on both channels. That WAV holds sine bursts, as CLAUDE.md requires, and Deepgram transcribes speech, so it would likely return no words and the assertion would fail for a reason unrelated to the code. With the fixture, the live test checks the grant, the bearer subprotocol, real-time streaming, a clean close, and the channel and ordering of any words that do arrive. When VIVA_LIVE_WAV points to a stereo speech recording on your Mac, the test also requires final words on both channels. That recording never goes into the repository.
- While the socket is down, the adapter drops audio rather than buffering it, so pass one shows a gap event, as PLAN.md 6.1 describes. Pass two transcribes the full WAV, so the gap never reaches the record of account.

Request for Joe, when the key exists: run `DEEPGRAM_API_KEY=<key> npx vitest run tests/live` once, ideally also with VIVA_LIVE_WAV set to a short stereo recording of you speaking on one channel and someone else on the other. A pass there also settles the bearer half of verification task V6.

Deferred: nothing.

Commit: 629c7ed.

## 2026-10-04, P5: Live display

Tasks done: P5.1, P5.2, P5.3, P5.4, P5.5, P5.6, P5.7.

Acceptance: `npm run test && npm run test:e2e` passed on the third attempt, together with lint, build, and the contrast check. Vitest ran 593 tests with 1 skipped (the live Deepgram test). Playwright ran 5 tests with 1 skipped on this Mac (the fake-microphone test, which runs on Linux CI). The first attempt failed because the new contrast script needed formatting. The second failed because the P3 setup test still expected the text of the placeholder session page, which P5 replaced; that test now reads the session record from IndexedDB instead, which checks more than the text did.

What I built:

- lib/session/state.ts, a reducer for setup, live, closing, and done. Every change appends an event. A score tap outside the live state, or outside the 1 to 5 scale, changes nothing. The first tap sets the timestamp and later taps change only the value, per ruling R4.
- lib/session/controller.ts, a LiveSession class that forwards audio to the transcriber only while live, keeps final words in capture time, recomputes pass one every 10 seconds and once at Stop, counts target structures on final words, estimates talk time from interims, stops by itself when the configured duration runs out, and raises faults. A fake-timer unit test confirms that the recompute fires at exactly 10 and 20 seconds after Start, once more at Stop, and never after.
- The fault strip turns amber while the transcriber reconnects and red on a fatal transcriber failure, a dropped device track, or a channel that stays below -90 dBFS for 10 seconds. Each red fault also goes into the session record as an event.
- app/session, the live display: timer, Start and Stop, the talk-time bar, two index slots that stay as grey blocks until the first score tap, two target counters, and five score buttons. At Stop the screen saves the pass-one transcript, the pass-one measurements, and the energy frames to a new IndexedDB store for P6 to upload. I viewed a screenshot at 1280 by 800 and checked it against DESIGN.md, and the e2e test asserts that nothing on the page scrolls.
- scripts/contrast-check.mjs, which checks 11 foreground and background pairings from app/globals.css. The lowest ratio is 4.72 to 1 (fault red on the card surface), against the 3.0 the plan requires. CI runs it.

Places where I departed from the plan, and why:

- Stored times use capture time, meaning milliseconds since the WAV began, rather than a clock that starts at the Start marker. The transcriber still counts from zero at Start, as PLAN.md 6.1 says, and the controller adds the Start offset when words arrive. With one time base, pass one and pass two line up with each other and with the WAV, and the markers say where the window sits inside the WAV.
- The index slot recomputes over everything from Start to now, not over the last 10 seconds, because a growing window gives Joe a steadier number. The rolling windows from P2 stay available in the stored measurements.
- No course baseline exists until P6 writes one, so the composite stays null for now, and after the score tap each slot shows the three raw components (words per minute, pauses per minute at 350 ms, and words per run at 350 ms), as PLAN.md section 9 allows.
- The noise-floor watchdog uses -90 dBFS, close to digital silence, so a quiet student never trips it but a dead transmitter does.
- The mock transcriber now emits times that start at zero on connect, like Deepgram, instead of raw fixture times.

Deferred: nothing.

Commit: 11561df.

## 2026-10-04, P6: Archive, pass two, documents, exports, bundle

Tasks done: P6.1, P6.2, P6.3, P6.4, P6.5, P6.6, P6.7, P6.8, P6.9, P6.10.

Acceptance: `npm run test && npm run test:e2e` passed on the first attempt, together with lint, build, and the contrast check. Vitest ran 607 tests with 1 skipped. Playwright ran 6 tests with 1 skipped on this Mac. The new end-to-end test runs a mock session for 12 seconds, stops it, waits for the browser to archive it to the in-memory store, opens the review page, runs pass two, and then confirms that both DOCX files open as Word documents, that /api/export returns long.csv rows for both passes, that the bundle zip holds all seven files, and that the stored session record reads "done".

What I built:

- lib/storage/store.ts with one interface and two implementations: VercelBlobStore for the private Blob store, and MemoryStore, the in-memory fake that runs when VIVA_STORE=memory or when no Blob token exists and VIVA_MOCK_ASR=1. lib/storage/paths.ts holds every archive path from PLAN.md section 10.
- POST /api/upload, which hands Vercel Blob client-upload tokens to a signed-in browser for the allowed session paths only (audio/wav and application/json, 120 MB, private), plus a PUT route that writes straight into the in-memory fake for local runs and CI.
- lib/storage/archive.ts, which runs automatically after Stop: it trims the WAV to 5 seconds before the Start marker, uploads the WAV, energy, pass-one transcript, pass-one measurements, and finally the session record, retries each upload three times, shows progress, and deletes the IndexedDB copy only after all five uploads succeed. If an upload fails, the session screen keeps the recording and offers a retry.
- GET /api/file for authenticated reads with Cache-Control private, no-store.
- POST /api/pass2 and lib/output/pass2.ts: a presigned 10-minute URL for the WAV, Deepgram's pre-recorded API with the PLAN.md 6.2 query, the pipeline with pass 2 and the course baseline, then the pass-two transcript and measurements, the session record in state "done", the course baseline, instructor/{examId}.json for ruling R1, both student documents, and the cohort CSVs. A unit test feeds the route a mocked Deepgram response built from the balanced fixture and gets back every golden pass-two value. A second run of pass two replaces the session's CSV rows and leaves the baseline count alone.
- lib/output/studentDoc.ts, one DOCX per student following PLAN.md 11.1. A unit test confirms that every tier 1 label appears exactly once, that the student's own values appear, that none of the partner's distinctive values appear (it checks more than ten of them), that the partner's participant id is absent, and that the words "instructor" and "live score" never appear.
- lib/output/csv.ts for wide.csv and long.csv, appended per session and regenerated on demand by GET /api/export?examId=.
- lib/output/bundle.ts and GET /api/bundle?sessionId=, which zips both documents, the WAV, both transcripts, the energy file, and the session record, and stores the zip at bundles/{id}/bundle.zip.
- The review page at /review/[id], which shows pass one and pass two side by side for both students, marks any pass-two value more than 10 percent away from pass one, and offers A.docx, B.docx, bundle.zip, and a "Run pass two" button.
- GET /api/retention and lib/output/retention.ts. vercel.json schedules it for 18:00 UTC on the 1st of each month (03:00 on the 2nd in Seoul). It deletes audio, transcripts, documents, bundles, and the roster for each exam whose termEnd lies more than 24 months back, keeps session records, measurements, and CSVs, and appends a line to retention/log.json.

Places where I departed from the plan, and why:

- Vercel Functions may cap response bodies at about 4.5 MB, and the documentation I could reach did not settle whether streaming lifts that cap. A five-minute WAV runs about 58 MB. So /api/file streams files up to 4 MB and answers larger ones with a redirect to a 10-minute presigned URL, which the browser follows straight to Blob. /api/bundle does the same with the zip. The in-memory fake cannot presign, so it streams everything.
- P6.1 lists the paths a browser may upload, but P6.2 also uploads measurements/{id}/pass1.json. The upload rule allows that path too.
- proxy.ts now lets /api/upload and /api/retention through without the cookie. Vercel Blob's upload callback carries a signature rather than a cookie, and Vercel Cron carries CRON_SECRET. Both routes check auth themselves, and the token step of /api/upload still requires the cookie.
- Because the WAV trims its pre-roll, it no longer starts at the moment the capture began. The archive step records wavOffsetMs (the capture time of the first WAV sample) in the session record, and pass two adds it to Deepgram's timestamps so both passes share one time base.
- The baseline file counts sessions in n, which baselineMinSessions compares against, while each component's mean and SD run over student observations, two per session. It also lists the session ids it already holds, so rerunning pass two never counts a session twice.
- Each row in wide.csv uses the 350 ms value for features measured at two thresholds, so the columns stay exactly the tier 1 ids plus metadata. long.csv carries both thresholds and the rolling windows.
- PLAN.md 11.1 asks for Sukhumvit Set, falling back to Calibri. A DOCX names one font, and Word picks its own substitute when that font is missing. The documents name Sukhumvit Set, which ships with macOS. Setting VIVA_DOCX_FONT=Calibri in Vercel switches every document to Calibri.
- I added GET /api/bundle, which P6.7 implies but does not name.

Requests for Joe:

- In Vercel, add an environment variable named CRON_SECRET holding any long random string. Vercel Cron sends it to /api/retention, and without it the monthly job gets a 401.
- Each exams/{examId}.json needs a termEnd date (for example "2027-02-28") for the retention job to act on that exam. The demo exam in fixtures/exams shows the shape.

Deferred: nothing.

Commit: d8feb4a.

## 2026-10-04, P7: Onboard import, replication, research export

Tasks done: P7.1, P7.2, P7.3, P7.4, P7.5, P7.6.

Acceptance: `npm run test && npm run test:e2e && (cd research && uv run pytest)` passed on the first attempt. Afterwards I found a bug that the tests had missed (below), fixed it, strengthened the test that should have caught it, and reran the full acceptance, which passed again. Vitest ran 617 tests with 1 skipped, Playwright ran 7 with 1 skipped on this Mac, and pytest ran 7.

What I built:

- The import screen at /import?id=. It decodes each onboard WAV (16-, 24-, or 32-bit PCM, or 32-bit float), computes a 20 ms energy envelope, and finds its offset by FFT cross-correlation against the archived energy frames, refined below one frame by fitting a parabola to the peak. It flags a weak match for a check by ear, builds the aligned stereo WAV on the archive's timeline, uploads it as audio/{id}/onboard-stereo.wav, and offers a pass-two run with source "onboard". A unit test and an end-to-end test shift the two fixture channels by 3,217 ms early (saved as float) and 1,500 ms late (saved as 16-bit PCM), and the screen recovers both offsets within 20 ms.
- Replication on the review screen. "Recompute from stored transcript" runs the current pipeline over the stored pass-two transcript and lists every value that differs; the end-to-end test confirms it reports "Replication run (pipeline 1.0.0): 0 differences". "Re-transcribe" runs a fresh pass two into separate robustness files labelled with the model string and date, and leaves the record of account, the baseline, the documents, and the CSVs alone.
- Exam configuration: schemas/exam.schema.json and schemas/roster.schema.json, POST and GET /api/exam, POST /api/roster, and import and export buttons on the setup screen.
- The Python research layer under research/: a uv project with the viva-research command, an archive reader that refuses roster paths, and the modules PLAN.md names. Twelve tier 2 features compute today. These are the mean length of AS-unit and the AS-unit pause classes at both thresholds; content-word ratio, discourse-marker rate, hedge rate, and agreement-token rate; self-repair count; and follow-up questions, new-topic questions, partner answer length after a question, and topic initiations. The export also writes the live score as rater_perceived_fluency when asked for tier 4, reading it from instructor/{examId}.json per ruling R1. Every other tier 2 and tier 3 id belongs to a module that records it in manifest.json as skipped, with the reason. A test checks that no tier 2 or tier 3 id lacks a module.
- docs/REPLICATION.md, and CI now runs the Python tests.

The bug: in local and CI runs, browser uploads go to the in-memory store through /api/upload, and Next.js's proxy layer buffers request bodies only up to 10 MB, so any upload larger than that arrived truncated without an error. Production was never affected, because there the browser uploads straight to Vercel Blob. The P7 import test passed anyway, because it checked only the WAV header. I removed /api/upload from the proxy matcher (the route checks auth itself), made the route reject a body shorter than its declared length, and made the import test compare the stored file's length with the original.

Places where I departed from the plan, and why:

- The import screen aligns against the archived energy frames rather than the archived WAV. The frames come from the same audio, and using them spares the browser a 58 MB download.
- The research layer's AS-unit segmenter follows a written rule over the ASR punctuation (research/viva/asunit.py states it) instead of a spaCy parse, because no spaCy model is installed yet. The P7.5 test checks it against my hand segmentation of the balanced fixture: 16 units for each student, with the derivation written in the test. The test also checks the research layer's MATTR and MTLD against the values the fixture script computed on its own.
- Features that need a dependency parse (the L2SCA indices, clauses, morphology), a reference list (bigrams, word frequency, the Academic Word List), forced alignment, or Praat and openSMILE appear in the manifest as skipped, never as estimates. The tier 3 modules raise a clear "not installed" message, as P7.4 allows.
- The research layer treats a lone "okay" that answers a partner as a backchannel, where the app counts it as a turn. The comment in research/viva/archive.py explains the choice.
- I added POST /api/roster, which the plan does not list, because without it a real exam has no way to get its roster into the store. The route only writes; nothing in export or research code reads the roster.
- Onboard files must be 48 kHz. The import screen refuses any other rate with a message instead of resampling.

Deferred: nothing within P7. Phase P8 is the rehearsal, which needs Joe, the hardware, and the live services, so the agent build stops here.

Commit: e8bad93. A follow-up commit records this hash, updates one stale line in docs/ARCHITECTURE.md, and clears one lint warning in lib/audio/align.ts.

## 2026-10-04, CI fix after P7

GitHub Actions failed on the P6 and P7 commits, which I had not checked before moving on. One unit test, the pass-two route test with a mocked Deepgram response, passed on this Mac and failed in CI. The CI job sets VIVA_MOCK_ASR=1 for every step, so the route picked the mock transcriber and never called the mocked fetch. The test now clears that variable for itself and restores it afterwards, and the createTranscriber test does the same. I ran the whole Vitest suite both with and without VIVA_MOCK_ASR=1, and all 617 tests pass both ways. Because the unit-test step failed first, the P6 and P7 end-to-end tests and the Python tests had not yet run on GitHub; this commit is their first CI run.

The previous commit message claimed to clear a lint warning in lib/audio/align.ts, but that edit had not applied. This commit clears it.

The same CI run then exposed a worse problem: app/api/roster/route.ts had never been committed. The .gitignore line `roster/`, meant to keep roster data out of git, matched every folder named roster, including the route's own folder. A Vercel build from main would have failed the same way. The rule now reads `/roster/` and `**/roster/*.json`, which still covers roster data, and the route is committed. I checked everything else git ignores; only generated files remain. Before pushing I ran the whole CI sequence on this Mac with CI's environment, and every step passed.

## 2026-10-05, Work order 01: lossless archive and descriptive measures

Branch: fix/lossless-descriptive, from main at 5690d6b and the two CI fixes after it. Pipeline version 1.1.0, registry version 1.1.0. The branch is not merged.

Sections done: 0 through 8, in four commits (sections 0 to 3 with 6 and 7, then 4, then 5, then this log).

Checks on this Mac before pushing: lint; vitest with and without VIVA_MOCK_ASR=1 (893 passed, 1 skipped, both ways); coverage with the 90 percent gate on lib/analysis; build; the contrast check; feature-coverage (all 47 tier 1 features have a function and a non-null fixture value); check-fixtures; pytest (12 passed); and Playwright (7 passed, 1 skipped on macOS as before). The golden test now checks 744 expected values across the three fixtures, and every one matches.

What changed:

- Turns close only when the partner's floor speech starts, so no silence disappears. A within-turn pause at or above turnThresholdMs counts in long_pause_count and goes into the session record as a long_pause event with its pass.
- The pipeline returns every word it receives with six labels (removedAsCrosstalk, inWindow, inGap, isFiller, isRepetition, isBackchannel), and the stored pass-one transcript is that labelled list. A backchannel-token word leaves the pruned list only when it is a backchannel. The research layer follows the same rule, and its separate "okay" handling is gone.
- Fifteen new tier 1 features: the raw twins articulation_rate_raw_wpm, mean_length_of_run_raw, and mattr_raw; pause rates and means by clause location; long_pause_count; uh_count and um_count; fillers by location and the silence after each; acoustic_pause_rate from the energy frames; and asr_acoustic_pause_agreement. docs/OPERATIONAL_DEFINITIONS.md states each rule, and the fixture script computes each value on its own.
- The composite uses the mid-clause pause rate at 350 ms (weights version 1.1).
- The WAV keeps every captured sample. Capture time now counts from the first sample, so new sessions record wavOffsetMs 0. Every live recognizer message goes verbatim to transcripts/{id}/pass1-raw.jsonl.
- The student document, review screen, and setup screen use plain descriptions, and a unit test fails if any banned word appears in a generated document.
- research/viva/verbatim.py and phones.py run their models only when someone has installed them, and they never write a score.
- The fixtures gain the seven cases in section 7.

A bug this work order exposed: when capture stopped, the downsample worklet still held up to 100 ms of raw audio that never reached the WAV. The new end-to-end check that the WAV runs past the Stop marker caught it (the WAV ended at 12.000 s, the marker at 12.085 s). Capture now asks the worklet to flush its partial chunk and waits for it before disconnecting.

Departures, each with its reason:

- Backchannels needed a rule the work order does not give. Once silence stops closing turns, the partner turn on each side of a lone "okay" merges, the "okay" lands inside it, and the old containment test calls it a backchannel, which contradicts case 4. The rule now reads: a backchannel-token run is a backchannel only while the partner holds the floor, meaning it overlaps the partner's speech or sits in a partner silence shorter than turnThresholdMs. A partner silence of turnThresholdMs or more leaves the floor open, and a token there is an answering one-word turn. To keep case 1 intact, I moved the gappy fixture's "mhmm" from the 2,500 ms pause to a 600 ms pause; under this rule a "mhmm" inside a 2,500 ms silence would answer and split the turn. Please confirm this rule or give me another; it changes backchannel_count, turn_count, and latency whenever a partner falls silent for 1.5 seconds or more.
- A pass-one transcriber gap still closes a turn. A gap is missing data rather than an observed silence, so treating it as a pause would invent one.
- The four new word labels are optional in schemas/words.schema.json. Words arrive from the recognizer without them, and the same schema validates those words; every transcript the pipeline stores carries all six labels, and a unit test checks that for every fixture and both passes.
- The config keeps the weight name silent_pause_rate, and in weights version 1.1 that weight applies to the mid-clause rate. Renaming the key would make every stored session record fail its schema. Baselines now record their weights version, and the composite returns null against a baseline from another version (or with no version, which means 1.0), so a baseline built on the total pause rate can never standardise the mid-clause rate. The next pass two starts a fresh baseline. No real baseline exists yet.
- asr_acoustic_pause_agreement uses the word-gap pauses at the lowest configured threshold (200 ms) and records that threshold. long_pause_count records no threshold, since its cutoff is turnThresholdMs.
- An acoustic frame counts as voiced when the student's channel reaches speechFloorDbfs and is not quieter than the partner's by gatingMarginDb or more. That makes the partner's bleed during a pause count as silence.
- The upload limit rises from 120 MB to 2 GB, because Principle 1 keeps the whole capture, including any wait before Start. This overrides build-plan P6.1, and RESEARCH_PRINCIPLES.md wins.
- Principle 4 says no output uses the banned words, while the work order names three outputs. The rendered-text check also covers the live display and the import page, and the "error" icon and "weak match" wording are gone from the login and import screens too.
- Principle 1 asks for audio after Stop. Capture keeps running after Stop until the session saves its local copy, usually well under a second, then stops. Keeping the microphone open longer needs a decision about how long to record once the window ends.
- The display labels live in lib/output/labels.ts, because features.json has no label field and the work order did not change the schema. A unit test confirms every tier 1 id has a label and a section.
- The live mock transcriber now sends Deepgram-shaped messages through the raw hook, so the end-to-end test exercises the JSON Lines path.
- scripts/check-fixtures.mjs now accepts whatever threshold a threshold-less feature records, since asr_acoustic_pause_agreement records 200.
- Three fixture windows grew to fit the new cases: balanced stays at 60 s, asymmetric goes to 48 s, and gappy to 43 s.
- In the research layer, pause_before_low_frequency_word_ratio and pause_function_profile are recorded as skipped, because both need a word frequency list. The verbatim counting rules ([UH] and [UM] for fillers, a trailing hyphen for a partial word) are my reading of CrisperWhisper's output format, and the module's docstring says to check them against real output. phones.py stores phone strings but does not yet code variants against the dictionary form.

Requests for Joe:

- Confirm or replace the floor-holding rule for backchannels above.
- Decide whether capture should keep recording for a set time after Stop.

Commit: recorded after CI.
