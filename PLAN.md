# Viva Voice: project plan

Version 6.0, 2026-10-04. Replaces Paired_Speaking_Measurement_Plan v5.0 and Build_Instructions v3.1. Companion files: MEASUREMENT_FRAMEWORK.md (what we measure and why), FEATURE_INVENTORY.md and features.json (every feature by tier), RED_TEAM.md (findings and rulings), build-plan.json (the machine-readable build for Claude Code), CLAUDE.md (repository rules), VERIFICATION_CHECKLIST.md (Joe's hands-on tasks).

## 1. Purpose

Two students hold a timed conversation on a prompt in Joe's office. Viva Voice records each student on a separate channel, transcribes both channels live, shows Joe four things while they talk, and after the session produces one DOCX per student with the transcript and that student's utterance fluency measurements. Markomatic analyses the document against the course rubric. Joe assigns every grade.

A Python research layer reads the same archive and computes that computes the extended feature set in FEATURE_INVENTORY.md for dissertations and articles.

## 2. Locked decisions

1. The exam stays face to face in Joe's office.
2. Each pair has a timed 4 to 6 minute conversation from a prompt. Joe does not speak during the timed window. Two student channels only.
3. Capture: two BOYAMIC 2 transmitters, one dual-channel receiver, Deepgram with `multichannel=true`. Audio only.
4. Live display: talk-time bar, one composite fluency index per student, one target-structure counter per student, a fault indicator. The index slot stays hidden until Joe taps his own score.
5. A live pass drives the display. A batch pass after the session produces the record of account.
6. Output: one DOCX per student with the interleaved transcript, that student's raw measurements, and a configuration block. Per-student feedback rules and a grade merge stay shelved.
7. Stack: Next.js on Vercel Pro, Vercel Blob as the only durable datastore, no Supabase, deploys to viva.weevillabs.dev. Repository outside Google Drive and outside iCloud.

## 3. Session format

Joe reads the prompt, presses Start, and stays silent. The timer runs for the configured duration (default 300 seconds). Joe presses Stop, or the timer ends the window. Every measurement comes from speech inside the window. The session record stores both markers and the configured duration.

During the window Joe can tap one of five score buttons. The tap reveals the index slot for the rest of the session and stores `instructorLiveScore` with a timestamp. Nothing else on the screen takes input.

## 4. Hardware

### 4.1 Topology

Each student wears one BOYAMIC 2 transmitter with an external lavalier capsule in the transmitter's 3.5 mm TRS input. The receiver, set to Stereo mode, connects to the MacBook over USB-C. Chrome opens it as a two-channel input device. Verification task V1 confirms this; if the receiver enumerates as mono, the fallback is the receiver's 3.5 mm TRS output into a two-input USB audio interface.

### 4.2 Device processing

Noise cancellation: off, by pressing the NC button once on each transmitter, and confirmed in the BOYA Central app before every session. AGC and limiter: the manual lists both as always-on features with no off switch. The design assumes they stay on. Energy gating is therefore a secondary method (section 7). Task V2 measures the AGC's effect by recording a known two-level signal through each transmitter, and task V2b tests whether the 32-bit float onboard recording bypasses it.

### 4.3 Gain and room

Receiver gain stays at one value per room (default 0 dB, range -12 to +12). The session record stores it. Before the first graded session Joe runs the bleed test (task V4) at exam seating distance and records the separation in dB per direction.

### 4.4 Onboard recording

Both transmitters record onboard in 32-bit float as a safety copy. The USB feed is the default source for both passes. Onboard files import through the Phase 7 screen when the USB capture failed or when the research layer wants pre-AGC audio (pending V2b).

## 5. Capture (browser)

`getUserMedia` with `deviceId: { exact }`, `channelCount: 2`, `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`, `sampleRate: 48000`. Read back `track.getSettings()` and block the session if any of the three flags reads true or `channelCount` reads below 2.

An `AudioContext` at 48 kHz connects to a `ChannelSplitterNode` and one `AudioWorkletNode` per channel. The worklet frames 20 ms blocks, computes RMS, converts to dBFS (`20 * log10(rms)`, floor -100), and posts frames to the main thread. A second worklet path downsamples each channel to 16 kHz and interleaves 16-bit stereo PCM for the Deepgram socket. Raw 48 kHz PCM for both channels appends to IndexedDB every two seconds. `navigator.storage.persist()` runs at session start.

IndexedDB is a crash buffer, never a store of record. At session end the browser builds one 48 kHz 16-bit stereo WAV and uploads it to Blob.

## 6. Transcription (Deepgram)

### 6.1 Live pass

One WebSocket to `wss://api.deepgram.com/v1/listen` with:

```
model=nova-3
encoding=linear16
sample_rate=16000
channels=2
multichannel=true
interim_results=true
punctuate=true
filler_words=true
vad_events=true
utterance_end_ms=1000
endpointing=300
keyterm=<unit target vocabulary, repeated per term>
```

No `smart_format` (it rewrites numerals and dates), no `diarize` (multichannel replaces it). Each result message includes `channel_index: [n, 2]`; the adapter maps channel 0 and 1 to student A and B from the setup screen's assignment.

Authentication: the browser calls `POST /api/asr/grant`. The route reads `DEEPGRAM_API_KEY` from Vercel environment variables, calls Deepgram's `POST /v1/auth/grant` with `ttl_seconds: 60`, and returns the JWT. The browser opens the socket with `new WebSocket(url, ['bearer', jwt])`. Task V6 confirms the subprotocol form against a live key.

Session clock: zero at the Start marker. Every Deepgram timestamp rebases by the audio duration already sent on the current connection. On a dropped socket the client reopens, writes a gap event with session-clock start and end, excludes the gap from pass-one measures, and continues. `KeepAlive` messages go out every 5 seconds during silence. `CloseStream` closes cleanly at Stop.

### 6.2 Batch pass

A Vercel Function (`POST /api/pass2`, `maxDuration: 300`) receives a session id, creates a presigned GET URL for `audio/{sessionId}/stereo.wav` in the private store, posts `{ url }` to `https://api.deepgram.com/v1/listen` with `model=nova-3&multichannel=true&punctuate=true&filler_words=true&utterances=true&paragraphs=true`, receives per-channel words with confidence, runs the shared pipeline, and writes `transcripts/{sessionId}/pass2.json` and `measurements/{sessionId}/pass2.json`. Pass two is the record of account.

## 7. Cross-talk rejection

Each capsule hears the partner at a lower level. Transcript alignment is primary: when a word sequence of two or more tokens appears on both channels within 300 ms, the pipeline keeps the instance with the earlier onset and higher mean confidence and deletes the other, logging every removed span. Energy is secondary: for a single duplicated token, or when confidence ties, the channel with the higher dBFS in the overlapping frames wins. A frame where neither channel exceeds the other by `gatingMarginDb` counts as unattributed; the pipeline counts these and reports the ratio as a capture-quality flag. `gatingMarginDb` defaults to the smaller measured separation from task V4 minus 3 dB.

## 8. Measurements

MEASUREMENT_FRAMEWORK.md explains each measure. features.json defines every one. The pipeline computes tier 1 for each student over the full window and over rolling 10-second windows, at both pause thresholds (200 and 350 ms), on pruned and raw word counts, and stores pass one and pass two separately.

The composite index uses pass-one values live and pass-two values in the record. Below `baselineMinSessions` (10) sessions for the course, the index is null.

## 9. Live display

One screen, no scrolling, no tabs, no charts, readable from across a desk. Four elements:

A horizontal bar split between A and B for talk-time share, updated from interim results.

An index slot per student. Hidden (grey block) until Joe taps a score. After the tap it shows the composite index, or the three raw components when the index is null. Updates every 10 seconds from final words.

A target-structure counter per student, incrementing on final-word matches.

A fault strip: red on channel drop, socket disconnect, or 10 seconds at the noise floor on either channel; amber during a reconnect.

Plus the five score buttons, the timer, and Start/Stop.

## 10. Storage

One private Vercel Blob store. Paths:

```
exams/{examId}.json                      prompt, unit, targetPatterns, keyterms, duration, scale
roster/{examId}.json                     name -> participantId, consentStatus   (never exported)
sessions/{sessionId}.json                config, markers, events, instructorLiveScore, pipeline version
audio/{sessionId}/stereo.wav             48 kHz 16-bit stereo, USB capture
audio/{sessionId}/onboard-A.wav          optional import
audio/{sessionId}/onboard-B.wav          optional import
energy/{sessionId}.json                  20 ms dBFS frames, both channels
transcripts/{sessionId}/pass1.json       final words, rebased, with channel
transcripts/{sessionId}/pass2.json       batch words with confidence, utterances, paragraphs
measurements/{sessionId}/pass1.json      tier 1 features, long format
measurements/{sessionId}/pass2.json
documents/{sessionId}/A.docx
documents/{sessionId}/B.docx
exports/{examId}/wide.csv                one row per student per session
exports/{examId}/long.csv                one row per feature per student per session per pass
```

Reads go through `GET /api/file?pathname=` after cookie authentication. Uploads from the browser go through `POST /api/upload` (`handleUpload`, `access: 'private'`, pathname restricted to the session prefix, `maximumSizeInBytes` 120 MB). The function layer reads with `get()`.

Authentication: one shared secret in `VIVA_PASSWORD`. `POST /api/login` sets an HttpOnly cookie. Middleware checks it on every route except `/login`.

Retention (docs/rulings.md R2): audio, transcripts, and the roster deleted 24 months after the term ends; measurements and the long CSV kept indefinitely under participant IDs. A scheduled Vercel cron route runs the deletion monthly and logs what it removed.

## 11. Outputs

### 11.1 Student document

One DOCX per student via the `docx` package. Header: course, unit, date, pair id, student label. Transcript: interleaved, chronological, one paragraph per turn, speaker label and timestamp at the paragraph start, the recipient's turns in bold, an inline marker at every removed span. Measurements: that student's tier 1 values as labeled lists, each with threshold or window, pass one and pass two side by side. Session log: markers, duration, faults, gaps, unattributed ratio, removed spans. Configuration block: gain, thresholds, gating margin, weights and weights version, model string, pipeline version, pass number. No partner measurement. No instructor score.

### 11.2 Cohort exports

`wide.csv` for Markomatic and spreadsheets. `long.csv` for R and Python, with columns `examId, sessionId, participantId, pass, featureId, window, threshold, value, unit, pipelineVersion`.

### 11.3 Evidence bundle

A zip per session: both documents, the stereo WAV, both transcripts, the energy file, the session record.

## 12. Research layer

`research/` in the same repository. Python 3.12, `uv` for environments. Reads the archive through the file route or from a local sync. Modules: `asunit.py` (segmentation over spaCy parse), `syntax.py` (L2SCA-style indices), `lexis.py` (MATTR, MTLD, frequency), `disfluency.py`, `interaction.py`, `align.py` (Montreal Forced Aligner wrapper), `acoustics.py` (parselmouth, openSMILE), `export.py`. Each module reads `features.json` and computes the features whose `inputs` it can satisfy. Output: `research-export/{examId}/long.csv` plus a `manifest.json` with every tool version. Nothing in `research/` deploys to Vercel.

## 13. Architecture summary

Browser: capture, worklets, Deepgram live socket, pass-one pipeline, display, WAV build, upload.
Vercel Functions: `/api/login`, `/api/asr/grant`, `/api/upload`, `/api/file`, `/api/pass2`, `/api/export`.
Blob: everything durable.
Python: tiers 2 and 3, offline.

The pipeline (`lib/analysis/`) is pure TypeScript with no browser or Node API, so the browser and the function run the same code on pass one and pass two, and the golden fixtures test it once.

## 14. Verification before Phase 1

VERIFICATION_CHECKLIST.md lists tasks V1 to V9 with the exact procedure and what to record. V1 (USB stereo), V2 (AGC effect), V4 (room bleed), and V6 (browser JWT subprotocol) gate the build. The others gate the first graded session.

## 15. Build phases

build-plan.json is the authority. Summary:

Phase 0 (Joe, by hand): accounts, keys, repository, Blob store, hardware checks V1, V2, V6.
Phase 1 (Claude Code): repository skeleton, CI, auth, schemas, feature registry loader, mock transcriber, synthetic fixtures.
Phase 2: analysis pipeline, all tier 1 features, golden tests.
Phase 3: device setup screen, capture, worklets, IndexedDB buffer, WAV builder.
Phase 4: Deepgram live adapter, grant route, session clock, reconnection.
Phase 5: live display.
Phase 6: Blob upload, pass-two function, DOCX, CSVs, bundle.
Phase 7: onboard import, replication screen, research export, REPLICATION.md.
Phase 8 (Joe): rehearsal with volunteer pairs.

Each agent phase ends with `npm run lint && npm run test` green, a commit, and a line in BUILD_LOG.md. A phase that needs a live key or hardware marks itself blocked and the build stops there.

## 16. Cost

Deepgram per-channel-minute rates reported by a third party on 2026-08-24: $0.0048 streaming and $0.0043 pre-recorded for Nova-3 (RED_TEAM.md F; low confidence until Joe reads deepgram.com/pricing). A five-minute session: about $0.09, or roughly ₩125 at 1,385 KRW per dollar. Ninety sessions: about $8, or roughly ₩11,000. Blob: about 5.2 GB per term of audio. Vercel Pro: already paid. Hardware: owned, plus two lavalier capsules if the kit shipped without them, and possibly a two-input USB interface pending V1.

## 17. Rulings

docs/rulings.md records the five decisions from RED_TEAM.md section G.
