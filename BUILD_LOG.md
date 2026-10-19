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

Commits on the branch: a5273bf, b3765c4, dad9288, and 9b4be64. GitHub Actions passed on 9b4be64: 893 unit tests, 12 Python tests, and 8 browser tests, including the fake-microphone test on Linux.

## 2026-10-05, Floor-holding rule kept, with its own key, labels, and a count

Branch: fix/lossless-descriptive. Commit 6b91d01. Not merged.

Joe kept the floor-holding rule from work order 01 and asked for four changes, all done:

- config.floorLapseMs, default 1500, now decides when a partner silence leaves the floor open. It is separate from turnThresholdMs, which only defines a long pause. It appears in schemas/session.schema.json, DEFAULT_CONFIG, the fixture config, the research layer, and docs/OPERATIONAL_DEFINITIONS.md. A unit test confirms that changing turnThresholdMs leaves the classification alone, while changing floorLapseMs moves it.
- Every backchannel candidate word in a stored transcript carries overlapsPartner, partnerSilenceMs, partnerResumesNext, and floorClass. Words that are not candidates carry none of the four. schemas/words.schema.json lists them.
- New tier 1 feature open_floor_response_count, in features.json, lib/registry/features.json, the pipeline, the fixture script, and the student document (under Conversation, labelled "Short responses (such as okay) given after your partner had stopped talking"). I regenerated FEATURE_INVENTORY.md with scripts/gen-inventory.py.
- Fixture case: in gappy, a lone "Okay." from B sits in a 2,000 ms silence of A's (860 ms, the 260 ms word, then 880 ms), and A resumes. It counts as an answering turn, partnerResumesNext is true, and open_floor_response_count for B is 1.

Acceptance: lint, vitest with and without VIVA_MOCK_ASR=1 (907 passed, 1 skipped), coverage, build, contrast, feature-coverage (48 tier 1 features), check-fixtures, pytest (13 passed), and Playwright (7 passed, 1 skipped on macOS) all passed on this Mac. GitHub Actions passed on 6b91d01 with 907 unit tests, 13 Python tests, and 8 browser tests. The golden test checks 756 expected values, and every one matches.

Choices I made, each with its reason:

- Floor words for the labels are the first-pass floor words, which leave every candidate out. That keeps the definition from depending on its own answer.
- partnerSilenceMs is null when the candidate overlaps partner speech or the partner has no floor word on one side.
- The rule refines one edge: a candidate that touches the partner's next word now counts as overlapping, where the old check looked only at the previous word. No fixture changes because of it.
- floorLapseMs is optional in the session schema, so session records written before it existed still validate, and the pipeline then uses 1500.
- The registry version stays 1.1.0 even though it gained one feature, because I did not want to set registry versions on my own. If you want 1.1.1 or 1.2.0, the change is one line in both copies of features.json.

Finding for Joe: as the instruction defines it, open_floor_response_count also counts backchannel-token words that open or sit inside the student's own turn while the partner is silent. In the asymmetric fixture, student A scores 3 from "Yeah," "right," and "really" inside A's own turn, while B's lone answering "Okay." scores 1. The labels make it possible to separate the two readings later: a standalone answer has floorClass "turn" and is not part of a longer run of the student's own speech.

Request for Joe: decide whether open_floor_response_count should count only standalone answers, or keep the literal definition.

GitHub Actions then failed on 3df8242, the commit that added only the entry above. The archive test found the WAV ending 2.7 ms before the Stop marker, which is one audio render block of 128 samples. The Stop marker comes from the browser's main-thread clock, which can run a block or two ahead of the audio the worklet has processed, and with the instant mock transcriber the final flush could arrive before the audio caught up. The session screen now keeps capturing for 500 ms after Stop before it flushes and closes, which also gives every recording half a second of audio after the window, as Principle 1 asks. The archive test passed three runs in a row locally, the full acceptance sequence passed again, and the branch CI result for this fix follows below.

That fix went out with a process error of mine: my command pushed 3acdc92 even though the local acceptance run had failed one browser test, and CI failed on the same test. The live-display test read the session record from IndexedDB after Stop, but the session archives itself and then clears its local copy, and the 500 ms tail changed the timing enough that the copy was sometimes already gone. The test now waits for the archive to confirm and reads the record from the archive, which checks more than the local copy did. The full acceptance sequence passed before this commit, and from here the push runs only if every step passes.

GitHub Actions passed on d047757: 907 unit tests, 13 Python tests, and 8 browser tests.

## 2026-10-05, Three floor classes; open_floor_response_count counts standalone answers only

Branch: fix/lossless-descriptive. Not merged.

Joe's instruction, done:

- floorClass now takes three values. "backchannel" means the partner held the floor. "standalone_turn" means the candidate run is the student's entire turn. "turn_part" means the run opens or sits inside a longer turn by the same student. The pipeline settles the last two once the final turns exist. schemas/words.schema.json lists the three values.
- open_floor_response_count counts standalone_turn runs only, and only in a partner silence at or above floorLapseMs. In the fixtures, asymmetric student A drops from 3 to 0, because "Yeah," "right," and "really" inside A's own turn are now turn_part. B's lone answering "Okay." still counts 1 in asymmetric and in gappy.
- docs/OPERATIONAL_DEFINITIONS.md, the fixture script (whose own count now requires the run to be the whole authored turn), and the research layer follow the new rule. research/viva/archive.py has a classify_candidates function that returns the same four facts and three classes as the app, and a pytest case checks one example of each class.
- The student document now reads "One-word answers (such as okay) given as a whole turn after your partner had stopped talking".
- registryVersion is 1.2.0 in both copies of features.json, with generated 2026-10-05, and the feature's formula and caveats describe the narrower count. FEATURE_INVENTORY.md is regenerated with scripts/gen-inventory.py.
- I copied features.json, FEATURE_INVENTORY.md, and schemas/features.schema.json into ~/Library/Mobile Documents/com~apple~CloudDocs/Viva Voice Dev/. Before overwriting, I confirmed that the three iCloud copies still matched what I had copied from there at the start of work order 01, so no edit of Joe's was lost. After copying, each file compares byte for byte with the repository.

Acceptance on this Mac, all passing before the push: lint; vitest without VIVA_MOCK_ASR and with it (908 passed, 1 skipped, both ways); coverage; build; contrast; feature-coverage (48 tier 1 features); check-fixtures; pytest (14 passed); Playwright (7 passed, 1 skipped on macOS).

GitHub Actions passed on 779dd8e: 908 unit tests, 14 Python tests, and 8 browser tests.

## 2026-10-05, Merge of fix/lossless-descriptive into main

Joe approved the merge. Before merging I ran git fetch origin and confirmed that origin/fix/lossless-descriptive pointed to a9fcd38 and that its latest CI run, on a9fcd38, had passed. I then checked out main, pulled origin main (main stood at 521d486), and ran git merge --no-ff fix/lossless-descriptive. The merge produced commit 17a1bdb with no conflicts.

On main, after npm ci, the full acceptance sequence passed: lint; vitest without VIVA_MOCK_ASR and with it (908 passed, 1 skipped, both ways); coverage; build; contrast (11 pairings); feature-coverage (48 tier 1 features); check-fixtures; Playwright (7 passed, 1 skipped on macOS); and pytest (14 passed). I pushed main only after every check passed. GitHub Actions passed on 17a1bdb: 908 unit tests, 14 Python tests, and 8 browser tests.

Main now carries pipeline version 1.1.0 and registry version 1.2.0. The branch fix/lossless-descriptive stays on GitHub, as Joe asked.

## 2026-10-05, P0 Vercel setup (Joe's authorization, this task only)

Joe authorized the Vercel CLI setup that CLAUDE.md otherwise forbids, for this task only. docs/verification/P0-vercel.md records every step. In short:

- I updated the Vercel CLI from 50.37.3 to 62.2.0. The account is joeteacherdonga-6540, and the team (team_8vfs2QbstUiFmFKdeDSdbPZu) is on the Pro plan.
- I created the project viva-voice (prj_BOPdR6fdLvs7KT0Ud8hm1ThO9Wxj), linked this folder, and connected JoeTeacherDAU/viva-voice with production branch main. I set the framework to Next.js and Node to 22.x, because the project came up as "Other" on Node 24.x, which contradicts build-plan P0.3 and the Node 22 stack. The default function region is icn1, set through the API.
- I created the Blob store viva-voice-archive (store_h0h2NLXBxDk0D0Z1), private, in icn1, connected for Production, Preview, and Development.
- I generated VIVA_SESSION_SECRET and CRON_SECRET (32 random bytes each) and a four-word VIVA_PASSWORD, and added all three to the three environments as encrypted config variables, since Vercel keeps its sensitive type out of Development. DEEPGRAM_API_KEY stays for Joe.
- `vercel env pull .env.local` wrote the variables. The file is gitignored by `.env*`, and its three generated values match Vercel's.

No secret value appears in this log, in the verification file, or in any commit.

First production build: the push of 000dd1c to main started it through the Git integration. Deployment dpl_AYHNJgnBQMwP1bJprpRrXiGLnbc6 built in 25 seconds and reached Ready. Production URL https://viva-voice.vercel.app; deployment URL https://viva-voice-3darop8ny-joeteacherdonga-6540s-projects.vercel.app. A smoke test without credentials passed: login page 200, home redirects to login, API 401, wrong password 401, served from icn1. Two settings await Joe's decision: the turbo build machine, and DEEPGRAM_API_KEY, which live transcription needs.

## 2026-10-19, Work order 02: session file import

Branch: feat/session-file-import, from main at 8eada3d. Not merged.

RESEARCH_PRINCIPLES.md and the work order agree on every point I found. The import keeps the untouched session file, every 20 ms energy frame over it, every slice byte for byte, and every excluded pair's audio, which Principle 1 asks for. The work order's "no pass-one transcript" takes nothing away, because an imported pair never had a live pass. The recompute that now saves new target counts keeps the previous measurements in a dated file, so Principle 1 still holds.

What I built:

- /import/session. It takes an exam id, a session label, a date, the WAV, and a manifest typed into a table or loaded as CSV (order,left_id,right_id). When the exam does not exist, it creates one from an id, a title, and a duration. The page offers that only when the archive answers 404, so a failed request never invites an overwrite.
- lib/import/. wavfile.ts reads the header through Blob.slice, accepts two channels of 16-bit PCM, 24-bit PCM, or 32-bit float (plain or WAVE_FORMAT_EXTENSIBLE), and names what a rejected file holds, for example "This file contains 1 channel, 48000 Hz, 24-bit PCM." scan.ts reads the file once in 8 MB chunks and computes the SHA-256, the 20 ms energy frames, and the zero runs of at least 500 ms on both channels. segments.ts proposes the segments and handles move, merge, split, and delete. manifest.ts parses and checks the manifest and holds the upload gate. records.ts builds one session record per pair and the upload plan.
- The review step shows each segment's start, end, duration, two-channel waveform, and matched manifest row, plus any consent exclusion. Joe can drag boundaries on the whole-session strip or on each segment's own strip, type times, play a segment, merge, split, delete, and set a measurement window. The upload stays blocked and shows both numbers while the segment count differs from the row count.
- The upload goes from the browser straight to the private store through the existing /api/upload route. The session file goes to sessions-raw/{label}.wav, then the session energy, then per pair the slice, its energy, and its record, then the import record. Every file shows its own progress bar and a Retry button.
- Pass two runs pair by pair from one button, with a status line per pair. GET /api/pass2 reports whether pass two can run, and the page stops with "DEEPGRAM_API_KEY is not set..." before its first request when the key is missing. I did not add the key.
- /review lists every session, groups imported pairs by session label, and labels each row "file import" or "live". Each label has a "Download all" zip with every pair's two documents, the label's wide and long CSV rows, and a pairs.csv.
- docs/replay-mode.md holds the replay design, with no code.

Choices I made, each with its reason:

- Each pair's slice goes to audio/{id}/stereo.wav, the path the live WAV uses, so pass two, the bundle, and retention work on imported pairs unchanged. The slice keeps the session file's 24-bit samples. Deepgram reads 24-bit WAV and the energy code decodes it, so no pair needed a converted copy, and the import record says so in derivedCopies.
- Channel 0 (left) is always student A and channel 1 (right) is always student B in an imported record. The manifest's left and right IDs fill participantIds.A and participantIds.B, so a swapped pair shows up as swapped IDs, and channelMap stays {"0": "A", "1": "B"}.
- A pair's session id is the label plus the order, for example C1_26_MIDS_S1-P03.
- A participant with "pending" consent, a participant missing from the roster, and a missing roster all count as unknown consent, so the pair goes in excluded. The page warns before upload when the exam has no roster.
- The page refuses a session label that already has an import record, because a second import would overwrite the first pair records and their pass-two results. The import record uploads last, so an interrupted upload leaves no import record and the label stays free.
- The exam schema gains an optional title. A created exam has empty course, unit, and prompt, and the student document shows the title where the course would go. The document also prints the session date from the source block and a line naming the session file and pair.
- The session schema gains captureMode, source, and excluded, and the pass source enum gains "file". Live records written before this change still validate.
- In mock mode, pass two on an imported pair transcribes no words, because the mock replays a pass-one transcript and an imported pair has none.
- "Recompute from stored transcript" now uses the exam's current target patterns and keyterms. When they differ from the session's, it shows both lists and a "Save recomputed values" button. POST /api/recompute reruns the pipeline over the stored pass-two transcript, copies the old measurements to measurements/{id}/pass2-before-{time}.json, rewrites the measurements, record, documents, and CSV rows, and leaves the transcript untouched.
- Retention now also deletes sessions-raw/{label}.wav and bundles/{label}/ for an exam past its term.
- I added @noble/hashes (version 2.4) because the browser has no streaming SHA-256 and the session file must never sit in memory whole.
- The live path stays as it was. Its shared code changed in three places: pass two moved its measuring half into a function that the recompute reuses, the uploader takes an optional progress callback, and /api/file stops declaring a length it does not know. Every live-path test still passes.
- TEST_GUIDE.md lives only in Viva Voice Dev on iCloud, and it holds the site password, so I added Stage 7 there instead of copying the guide into the repository.

Incident: test files reached the real Blob store. On this Mac, `next start` reads .env.local, which holds the real BLOB_READ_WRITE_TOKEN since the P0 `vercel env pull`. The Playwright config set VIVA_MOCK_ASR but not VIVA_STORE, so the store code chose Vercel Blob. My first run of the new browser test at 01:18 UTC and a debugging run at 01:19 UTC wrote 28 files to the private store viva-voice-archive. Every file is synthetic: two exams (e2e-import-mvekfnf4 and e2e-import-mvekgvi1), their rosters of invented "Tone S0n" names, two session files of sine tones (E2E_S1_mvekfnf4 and E2E_S1_mvekgvi1), and their pair audio, energy, and records. A read-only listing on 2026-10-19 showed these 28 files as the store's entire contents, so no other data shared the store. playwright.config.ts now sets VIVA_STORE=memory and an empty BLOB_READ_WRITE_TOKEN for the test server. After the fix, the full browser suite ran and the store still held 28 files. I have not deleted the 28 files, because CLAUDE.md forbids changes in Vercel without Joe's say.

Request for Joe: decide whether I delete those 28 test files from the Blob store. They show up in the live site's review list until someone removes them.

Finding for Joe: the same incident exposed a bug in production that predates this branch. Vercel Blob serves JSON and CSV compressed and reports their size as 0, and /api/file passed that 0 on as Content-Length, so every JSON file the browser read through /api/file arrived empty. In production that would have broken the review page, loading an exam on the setup screen, and the new exam check. /api/file now omits the length when the store does not know it, and app/api/file/route.test.ts covers that case.

Speed: a scan of 97 MB of 24-bit stereo took 483 ms of computing in Node, about 3.5 seconds for a 700 MB file. Reading the file from disk will take longer than that.

Acceptance on this Mac, all passing before the push: lint; vitest without VIVA_MOCK_ASR and with it (938 passed, 1 skipped, both ways); coverage; build; contrast (12 pairings, with warn on surface added for the exclusion text); feature-coverage (48 tier 1 features); check-fixtures; pytest (14 passed); Playwright (9 passed, 1 skipped on macOS), including the two new session-import tests.

The work order's eight tests live in lib/import/import.test.ts (tests 1 to 7, plus segment edits, manifest parsing, the recompute, and the download zip) and tests/e2e/session-import.spec.ts (test 8, and a second test for the mono rejection). The fixture is generated in code by lib/import/synthetic.ts: 3 s of zeros, then three tone "pairs" separated by 2 s of zeros, each with a 200 ms stretch of zeros inside it that must not split it, and a different tone for each participant so the tests can check which participant each channel carries. No audio file enters the repository.

GitHub Actions passed on a858ab2: 938 unit tests, 14 Python tests, and 10 browser tests.

## 2026-10-19, Test files deleted; merge of feat/session-file-import into main

Joe gave permission to delete the 28 test files from the Blob store, for that deletion only. Before deleting, a fresh listing showed exactly 28 files in viva-voice-archive, all of them the synthetic files the work order 02 entry names. The deletion script matched those names and was set to stop without deleting if either count differed from 28. It deleted the 28, and a second listing showed the store empty.

Joe then approved the merge. I ran git fetch origin and confirmed that origin/feat/session-file-import pointed to 00ebaa5 and that its CI runs on a858ab2 and 00ebaa5 had both passed. I checked out main, pulled origin main (main stood at 8eada3d), and ran git merge --no-ff feat/session-file-import. The merge produced commit dc4b378 with no conflicts.

On main, after npm ci, the acceptance sequence passed: lint; vitest without VIVA_MOCK_ASR and with it (938 passed, 1 skipped, both ways); contrast (12 pairings); check-fixtures; build and feature-coverage (48 tier 1 features), through the Playwright run; Playwright (9 passed, 1 skipped on macOS); and pytest (14 passed). I pushed main only after every check passed.

The push started production deployment viva-voice-21wd4obz4 through the Git integration. It built in 18 seconds and reached Ready, and GitHub records Vercel's "Deployment has completed" status on dc4b378. A headless Chromium check of https://viva-voice.vercel.app then passed. Before login, /import/session redirected to /login. Login returned 200, and /import/session returned 200 and rendered the heading "Import a session file" with sections 1 to 3, the exam id box, and the WAV picker. GET /api/sessions returned an empty list. GET /api/pass2 returned ready false with the missing-key message, because DEEPGRAM_API_KEY stays unset for Joe to add.

## 2026-10-19, Work order 03: pair file import

Branch: feat/pair-file-import, from main at 67be7c8.

RESEARCH_PRINCIPLES.md and the work order agree. The pair files reach the archive byte for byte, header included, and so does the session-wide WAV when Joe attaches it, which Principle 1 asks for. The import record keeps the manifest exactly as loaded.

What I built:

- /import/session now opens in "Pair files" mode, with "Single session file" beside it. The exam, label, and date sit above the switch and survive it. The page locks the mode once an upload starts.
- lib/import/pairfiles.ts. It parses the manifest by column name (order, track, file, left_id, right_id, in any order), matches each chosen file to the row with the same file name after Unicode normalisation, checks each header for two channels of 16-bit or 24-bit PCM, computes the session offsets, gates the upload, and builds the records and the upload plan.
- The upload stays blocked when a row has no file, when a chosen file matches no row, when a file fails the header check, when the manifest has a problem, and until Joe ticks the box under the table. The table shows each pair's order and track, file, duration, left ID with name, right ID with name, consent, and, when the offset check passes, where the pair starts in the session WAV.
- The optional session-wide WAV goes to sessions-raw/{label}.wav unchanged. The page sums the pair durations in manifest order, compares the sum with the session WAV's length, and shows the sum, the length, and the difference.
- Each pair becomes one record with captureMode "file-import" and a source block with mode "pair-file", the file name, the track name, the file's SHA-256 and size, and its format. The upload order is the session WAV, then per pair the file, its energy, and its record, then the import record last.
- To share code between the modes, I moved the session details card, the upload list with Retry, and the pass-two card out of SessionImportClient.tsx into SessionDetails.tsx and shared.tsx. SingleFileImport.tsx holds the work order 02 mode with its logic unchanged.

Choices I made, each with its reason:

- A record carries offsets into the session WAV only when the check passes. When the sum misses by more than 50 ms, or a pair's sample rate differs from the session file's, the session WAV still uploads, the import record keeps the failed check, and no record claims an offset. A wrong offset would point a later reader at the wrong audio.
- The header check accepts 16-bit and 24-bit PCM and rejects 32-bit float, because the work order asks for PCM. The single-file mode still accepts float.
- The page computes each pair file's 20 ms energy frames, as the single-file mode does for each slice, so pass two and the review page find energy/{id}.json for every imported pair.
- The confirmation box under the table is my reading of "for me to confirm". Changing the manifest or the chosen files clears it.
- When the session-wide WAV is chosen with the pair files and also attached in its own box, the block message says it belongs in its own box.
- The schema's source block is now a choice between the session-file shape and the pair-file shape. Session-file records now carry mode "session-file", and records without mode still validate.
- The student document and the review page name the pair file for a pair-file record.

A local check against the real folder, with nothing uploaded or transcribed: I ran the new parser, matcher, header check, and offset check in Node over the files in My Drive/_Research/AI-Assisted Speaking Assessment/Audio Input Data/C1_26_MIDS on this Mac. They read the manifests and the WAV headers only and printed no participant IDs.

- The manifest inside C1_26_02_S1 has the columns order,left_id,right_id, so the page refuses it and says that without a file column it cannot tell which WAV belongs to which pair. The five-column manifest sits one level up, in C1_26_MIDS, under the same name C1_26_02_S1_manifest.csv. It parses with no problems and 6 rows.
- The six pair files all pass the header check (48 kHz, 24-bit PCM, plain fmt chunk), and each matches its row by name: row 1 is track Audio 2, row 2 is Audio 1, and rows 3 to 6 are Audio 3 to Audio 6.
- "C1_26_02 - Session 1.wav" sits inside C1_26_02_S1, not in the parent folder as the work order says, so choosing every WAV in the folder blocks the upload until Joe leaves it out.
- The pair files sum to 69,399,509 frames and the session WAV holds 69,399,512, a difference of 3 frames (0.0625 ms), so the offset check passes.

Tests, all synthetic: lib/import/pairfiles.test.ts covers manifest parsing, matching by file name in any order, the missing-file block, the extra-file block, the header block, the confirmation, the offset sum at exactly 2,400 and 2,401 frames either way, offsets only on a passing check, byte-for-byte storage, valid records, and pass two with a consent exclusion. tests/e2e/pair-import.spec.ts runs the mode end to end with three 24-bit pair files cut from one synthetic session WAV. The work order 02 browser tests now pick "Single session file" first. lib/import/synthetic.ts builds every fixture in code, so no audio file enters the repository.

TEST_GUIDE.md in Viva Voice Dev on iCloud gains Stage 8 for this mode, and Stage 7 now says to pick "Single session file" first.

Acceptance on this Mac, all passing before the push: lint; vitest with coverage and with VIVA_MOCK_ASR=1 (949 passed, 1 skipped, both ways); build; check-fixtures; contrast (12 pairings); feature-coverage (48 tier 1 features); pytest (14 passed); Playwright (10 passed, 1 skipped on macOS). The Playwright server ran with VIVA_STORE=memory, so nothing reached the Blob store.

GitHub Actions passed on 474efb5: 949 unit tests, 14 Python tests, and 11 browser tests. The work order asks for the merge, so I merged feat/pair-file-import into main with --no-ff. Main stood at 67be7c8, so the merge met no conflicts. This paragraph rides in the merge commit, so main gets one push and one production deploy.

## 2026-10-19, Work order 03 correction: pair files only

Branch: feat/pair-files-only, from main at f22fb31.

Joe confirmed that the latest copy of work order 03 changes the input. Each session folder now holds only the pair WAVs and one five-column manifest, and the session-wide WAV no longer comes in. Merge f22fb31 had built an optional box for it, so this run removes that box.

What I removed:

- The "Session-wide WAV" card, its file picker, the offset line, and the "Starts in session" column on /import/session. Pair files mode now has two file inputs: the manifest CSV and the pair WAVs. The sections renumber to 1 Session, 2 Manifest and pair files, 3 Check the pairs, 4 Upload, and 5 Pass two.
- From lib/import/pairfiles.ts: OFFSET_TOLERANCE_MS, OffsetCheck, sessionOffsets, the session input to the gate, the import input, and the upload plan, the session-WAV block message, the sessionFile block of the import record, and the upload of sessions-raw/{label}.wav in this mode.
- The optional session block from PairFileSource in lib/analysis/types.ts and from the pair-file shape in schemas/session.schema.json. No record in the archive carries it, because the real files never went up.
- The session bytes from makePairFixture in lib/import/synthetic.ts, the two offset tests and the session-WAV block case from lib/import/pairfiles.test.ts, and the session-WAV steps from tests/e2e/pair-import.spec.ts. The extra-file test now uses a stray pair file, and the browser test checks that the mode shows exactly two file inputs.

The single-file mode keeps sessions-raw/{label}.wav, its energy file, and its zero-run segmentation. Both modes still write the import record at sessions-raw/{label}.json.

A local read of both real folders, with nothing uploaded or transcribed. I ran the page's own parser, matcher, header check, and upload gate in Node over My Drive/_Research/AI-Assisted Speaking Assessment/Audio Input Data/C1_26_MIDS on this Mac and printed no participant IDs.

- C1_26_02_S1 holds C1_26_02_S1_manifest.csv and six WAVs, and nothing else. The manifest names the five columns, parses into 6 rows with no problems, and lists 12 distinct IDs. Every row matched one file by name, and no file was left over. All six files hold two channels of 48 kHz 24-bit PCM and run from 229.3 to 253.0 seconds, 24.1 minutes in all. The files now carry their track number in the name, so row 1 (track Audio 2) is C1_26_02_S1.02.Audio 2.wav and row 2 (track Audio 1) is C1_26_02_S1.01.Audio 1.wav.
- C1_26_03_S1 holds C1_26_03_S1_manifest.csv and nine WAVs, and nothing else. The manifest parses into 9 rows with no problems and lists 18 distinct IDs. Every row matched one file by name, and no file was left over. All nine files hold two channels of 48 kHz 24-bit PCM and run from 235.8 to 254.1 seconds, 36.6 minutes in all. Row 1 is track Audio 9, file C1_26_03_S1.09.Audio 9.wav, and rows 2 to 9 are Audio 1 to Audio 8.
- With an exam, a label, and the box ticked, the upload gate cleared for both sessions.

PLAN.md section 19, docs/OPERATIONAL_DEFINITIONS.md, and Stage 8 of TEST_GUIDE.md in Viva Voice Dev on iCloud now describe the mode without the session-wide WAV. Stage 8b now covers both sessions.

Acceptance on this Mac before the push: lint, vitest plain and with VIVA_MOCK_ASR=1 (947 passed, 1 skipped, both ways), build, check-fixtures, feature-coverage (48 tier 1 features), and Playwright (10 passed, 1 skipped on macOS) with VIVA_STORE=memory. GitHub Actions passed on 16df874: 947 unit tests, 14 Python tests, and 11 browser tests. I merged feat/pair-files-only into main with --no-ff. Main stood at f22fb31, so the merge met no conflicts. This paragraph rides in the merge commit, so main gets one push and one production deploy.

## 2026-10-19, Work order 04: command-line session import

Branch: feat/cli-import, from main at 8a39b08.

What I built:

- lib/import/remote.ts holds the calls to the app's routes that the pages and the commands share: reading an archive object through /api/file, newExamRecord, postExam, postRoster, pass2Ready, and runPass2For. The import page's exam creation and pass-two loop and the setup page's Import exam JSON and Import roster JSON buttons now call it, so no route call has a second copy.
- lib/import/folderImport.ts runs a folder through the Pair files page's own parser, matcher, header check, upload gate, consent rule, and planPairUpload. It adds the exam check and creation, the store check, the per-pair hash check for re-runs, the uploads with three retries, and pass two through the route.
- scripts/cli/import-session.ts, scripts/cli/import-roster.ts, and scripts/cli/app.ts read the folder or the roster file, load .env.local, log in with VIVA_PASSWORD, and pick the uploader the app reports: the private Blob store with the token from .env.local, or the app's in-memory upload route in local dev and the tests. scripts/run-ts.mjs bundles a command with esbuild, which the project already had, so no package was added.
- npm run import:session and npm run import:roster in package.json.
- VercelBlobStore.put now uploads in parts above 20 MB, as the browser already does.

Choices I made, each with its reason:

- import:roster also takes --exam. The setup page stores a roster under the exam id typed on the page, and roster_F26.json holds only a list of students with no exam id, so the command cannot know where the roster goes without it.
- The command checks that the Blob token's store holds the exam record the app holds before the first upload. The reads go through the deployment and the writes go straight to Blob, so a token from another store would otherwise split one session across two stores.
- The command passes the page's gate with the confirmation box ticked, because it has no table to tick. The printed lines carry the file and both IDs for each pair, so Joe checks them there.
- A pair counts as already uploaded only when its session record exists and names the same file SHA-256. The record goes up after the audio and the energy, so an existing record means all three arrived. A different SHA-256 stops the whole run before any upload, because the archive must not mix two versions of one pair.
- An existing import record stays as it was on a re-run, and a run with a failed pair writes no import record, as on the page.

Tests, all synthetic: lib/import/folderImport.test.ts runs the core against the app's real route handlers on an in-memory store. It covers exam creation, byte-for-byte storage, the page's records, pass two with a consent exclusion, the skip on a re-run, finishing an interrupted import, the stop on a different file, the page's missing-file and extra-file blocks before any exam is created, the missing title and duration, a store mismatch, a missing roster, and the absence of names in the output. tests/e2e/cli-import.spec.ts runs both commands as child processes against the e2e server with a synthetic folder, then checks the archive, the review page, and a re-run. The test skips .env.local and blanks the Blob token, so it can reach only the server's in-memory store.

PLAN.md gains section 20.

Acceptance on this Mac before the push: lint, vitest plain and with VIVA_MOCK_ASR=1 (955 passed, 1 skipped, both ways), build, check-fixtures, contrast (12 pairings), Playwright (11 passed, 1 skipped on macOS) with VIVA_STORE=memory, and pytest (14 passed). GitHub Actions passed on 4eb6764: 955 unit tests, 14 Python tests, and 12 browser tests. I merged feat/cli-import into main with --no-ff. Main stood at 8a39b08, so the merge met no conflicts. This paragraph rides in the merge commit, so main gets one push and one production deploy.
