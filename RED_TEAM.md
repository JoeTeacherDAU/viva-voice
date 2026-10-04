# Viva Voice: red team report

Date: 2026-10-04. Inputs: Paired_Speaking_Measurement_Plan v5.0, Build_Instructions v3.1, the seven locked decisions, vendor documentation read on 2026-10-04 (Deepgram, Vercel, BOYA), and the research literature listed in MEASUREMENT_FRAMEWORK.md.

Each finding states the problem, the evidence, and the ruling I wrote into PLAN.md and build-plan.json. A finding marked RULING NEEDED waits for Joe.

## A. Findings that break the design

### A1. The transmitters run AGC and a limiter with no documented off switch

The BOYAMIC 2 manual lists "AGC & limiter for distortion-free audio" as a feature and gives no control to disable either one. Noise cancellation has a button (press once to toggle). Plan v5.0 section 4.4 assumed all three switch off. Build v3.1 Phase 1 blocks a session when "any of the three processing flags reads true," but those flags belong to the browser, so the check never sees the transmitter's own processing.

Consequence. Energy gating (plan section 7.2) compares amplitude across the two channels. An AGC on each transmitter raises gain on a quiet channel, so when student A speaks, student B's transmitter amplifies the bleed of A's voice. The measured level difference shrinks, and the gating margin from the bleed test stops meaning anything. Talk-time share, the headline display item, depends on this gate.

Ruling. Transcript alignment becomes the primary cross-talk method and energy becomes secondary evidence. Deepgram returns word timings per channel. When the same word sequence appears on both channels within a timestamp tolerance, the channel whose transmitter is closer to the speaker shows earlier onset and higher confidence. The pipeline keeps the earlier, higher-confidence instance. Energy comparison runs per 20 ms frame as a tie-breaker only, and the pipeline counts and reports unattributed frames. Verification task V2 now records a known two-level signal through each transmitter and measures the recorded level ratio, so we learn how strong the AGC is before writing a single gating constant. If the 32-bit float onboard recording turns out to bypass the AGC, pass two uses it.

### A2. Nobody has confirmed that the receiver works as a two-channel USB audio device on a Mac

The manual lists a USB-C output and Mono, Stereo, and Safety Track modes, and says nothing about USB audio class behaviour. Chrome's `getUserMedia` with `channelCount: 2` fails silently if the device enumerates as mono, and macOS may expose the receiver as a single-channel input.

Ruling. Verification task V1 is now a hard gate on the build. If the receiver fails, the fallback is the receiver's 3.5 mm TRS output into a stereo USB audio interface. Joe does not own one, so V1 decides a purchase.

### A3. Browser WebSockets cannot send an Authorization header

Build v3.1 Phase 3 assumed a token adapter posts a key and "connects with that token." Deepgram's token endpoint (`POST /v1/auth/grant`) returns a JWT with a 30 second default TTL and documents `Authorization: Bearer` for the WebSocket. A browser `WebSocket` object exposes no header API. Deepgram's documented browser route is the `Sec-WebSocket-Protocol` subprotocol: `token, KEY` for an API key, and the same mechanism with `bearer` for a JWT (confidence: high for `token`, moderate for `bearer`; verification task V6 confirms the second form).

Ruling. One server route `POST /api/asr/grant` mints a JWT with `ttl_seconds` set to 60. The browser opens the socket with `new WebSocket(url, ['bearer', jwt])`. The 30 to 60 second TTL only needs to cover the handshake, because the connection stays open after it. Bring-your-own-key mode and the `localStorage` key field are gone. One user runs this system, and his key stays in Vercel environment variables.

### A4. The plan assumed two speech providers and the lock names one

Build v3.1 plans two adapters, a provider selector, and a Phase 7 second provider. Decision 3 names Deepgram. Every extra adapter doubles the verification work and the fixture work.

Ruling. One adapter, `lib/asr/providers/deepgram.ts`, behind a `Transcriber` interface that keeps the door open. I deleted Phase 7's "second provider" task. The interface stays because the research use (FEATURE_INVENTORY.md) will want a robustness check against a second recognizer later.

### A5. The plan's pass two and the build's pass two use different audio

Plan v5.0 section 10 runs pass two from the transmitters' onboard recordings. Build v3.1 Phase 6 runs pass two from the archived USB WAV files and never mentions onboard files. Onboard files need a USB cable and a manual copy per transmitter, which breaks Phase 8's "no manual step" acceptance test.

Ruling. Pass two runs from the archived USB capture by default. Onboard recordings become an optional import for research use and for a day when the USB feed failed. The import screen (Phase 7) accepts two mono WAV files, aligns them to the USB capture by cross-correlation, and labels the run `source: onboard`.

### A6. Pass two in the browser cannot authenticate a 29 MB upload cleanly

A five-minute 48 kHz 16-bit mono WAV is about 28.8 MB per channel. Build v3.1 uploads these to Deepgram from the browser. The JWT route in A3 works for REST too, but a 30 to 60 second token and two large uploads over office Wi-Fi is a fragile pair. Vercel Functions cap request bodies at 4.5 MB, so a function cannot proxy the audio either.

Ruling. Pass two runs in a Vercel Function, and the function sends Deepgram a URL. The browser uploads one stereo 48 kHz WAV to the private Blob store through `handleUpload`. The function calls Vercel Blob's presigned GET URL API to create a short-lived read URL, posts `{ url }` to Deepgram's pre-recorded endpoint with `multichannel=true`, receives words for both channels, runs the same pipeline code, and writes the pass-two record back to Blob. Deepgram's documented upload limit is 2 GB, and a URL request has no body. Function duration default is 300 seconds on Pro. Deepgram batch on five minutes of audio returns in seconds (confidence: moderate; task V7 measures it).

### A7. Storing student audio at a public URL

Build v3.1 made private storage conditional on a verification result. Vercel Blob now ships private stores (SDK 2.3 and later, GA). Private blobs are readable only through `get()` from a Function or a presigned URL. Store creation fixes the access mode for good.

Ruling. Create the store as private on day one. I deleted the AES-GCM fallback. One route `GET /api/file?pathname=` authenticates Joe and streams the blob. Authentication for one user is a single shared secret in a cookie, set by `POST /api/login` against an environment variable. Nothing else in the app needs a user model.

## B. Findings against the locked decisions

### B1. Decision 4 contradicts plan sections 1 and 9

Plan v5.0 section 1 says the system "captures no instructor input." Section 9 says the display "collects nothing." Decision 4 has Joe tap his own score to reveal the fluency index. A tap is input.

Ruling. The tap is a live instructor score on a scale Joe sets in configuration (default 1 to 5). The session record stores it as `instructorLiveScore`, with a timestamp, under a field the student document never reads. Plan sections 1 and 9 now say the display collects one item: Joe's score.

Decided (docs/rulings.md R1): store it. Storing the tap gives section 8.6 the data it needs to refit composite weights against instructor scores after one administration. It also edges toward the shelved grade merge. My default: store it, exclude it from every student-facing output, and treat the refit as research work in the Python layer.

### B2. The cold-start hole and decision 4

Below `baselineMinSessions` (default 10) the composite index does not exist, so build v3.1 shows raw speech rate and pause rate instead. Decision 4 hides "the fluency index" until the tap.

Ruling. Everything in the index slot stays hidden until the tap, whether it is the index or the two raw numbers. One slot, one rule.

### B3. Decision 6 and the three extra outputs

Both documents produce a cohort CSV, a zip bundle, and a session log inside the DOCX beyond the three items in decision 6.

Ruling. The CSV and the bundle stay, because the research use (FEATURE_INVENTORY.md) needs them, and neither one reaches a student. The session log stays in the DOCX, because it documents faults and gaps that explain a strange number. The sentence in plan section 12.1 that sends the document to Markomatic "for analysis and scoring" loses "and scoring." Joe assigns every grade.

### B4. Decision 7 and the plan's batch worker

Plan v5.0 section 11 describes a queue and a batch worker on "any platform." The lock names Vercel. Finding A6 puts pass two in a Vercel Function with no queue. Vercel Workflows exist for longer jobs, and the plan reserves them for a later research batch (re-running fifty sessions through a new pipeline version).

### B5. IndexedDB and "Blob as the only datastore"

IndexedDB buffers audio in the browser during capture so a dropped connection loses nothing. It is a cache. Blob stays the only durable store. PLAN.md says so in one sentence.

## C. Findings on the measurement design

### C1. Pause location needs a segmentation the recognizer does not give

Plan section 8.2 classifies pauses as mid-utterance or end-utterance "by whether the recognizer placed a sentence boundary." Gao et al. (2025) and Matsuura et al. (2022) classify pause location by Analysis of Speech Unit (AS-unit) or clause boundaries, and Matsuura et al. found that pause location and disfluency pruning matter for dialogic scoring. Deepgram's `punctuate=true` gives sentence-final punctuation, which is a proxy.

Ruling. Pass one and pass two classify pause location by `punctuated_word` boundaries and label the method `boundary: punctuation`. The Python research layer adds AS-unit segmentation later (FEATURE_INVENTORY.md tier 2), and the schema includes a `boundaryMethod` field so both methods can coexist in one dataset.

### C2. Articulation rate in words is a different measure

Plan section 8.1 states the substitution of words for syllables. The research literature reports syllables per second. Korean learners of English produce many monosyllabic function words and few long words, so words per minute under-states articulation rate relative to published norms.

Ruling. Pass one keeps words. Pass two adds an estimated syllable count per word from a dictionary lookup (CMU Pronouncing Dictionary) with an orthographic fallback, and stores both. The DOCX reports both with labels. The research layer (tier 2) replaces the estimate with forced-alignment syllable timing.

### C3. Filler words need a flag the plan never set

Deepgram strips "uh" and "um" by default. Plan section 8.3 counts filled pauses. Without `filler_words=true` every filler count reads zero.

Ruling. `filler_words=true` on both passes. Deepgram transcribes seven tokens: uh, um, mhmm, mm-mm, uh-uh, uh-huh, nuh-uh. The last five are backchannels, so the pipeline splits the list: `uh` and `um` count as filled pauses, and the other five count as backchannel tokens for the interaction measures. Korean fillers ("eum", "eo") do not appear in Deepgram's list, so the configuration keeps a `fillerTokens` list that the pipeline matches against transcribed words.

### C4. The target-structure counter will fire on partial matches

A regex list against a live interim transcript matches fragments of words. `targetPatterns` needs word-boundary anchoring and a rule that counts matches on final results only, while the display shows a provisional count from interims.

Ruling. The counter increments on `isFinal` words only. Deepgram's `keyterm` parameter (Nova-3) gets the unit's target vocabulary, which raises recognition of the words the counter looks for.

### C5. Interim timestamps drift from final timestamps

Interim results update word timings when the final arrives. A display that computes pause measures from interims shows numbers that jump.

Ruling. Live measurements use final words only. Interims drive the talk-time bar and the fault indicator (speech present or absent) and nothing else.

## D. Findings on the research-extensibility goal

### D1. A measurement system designed around one DOCX will not scale

Joe wants dissertations and articles from this data. Build v3.1 computes measurements inside a browser and writes them into a document. Reanalysis means re-opening the app.

Ruling. The system now has two layers. Layer one (TypeScript, in the app) captures and produces the record of account: stereo WAV, word JSON for both passes, energy frames, event log, session metadata, and the core fluency measures. Layer two (Python, in the same repo under `research/`) reads the archive and computes everything in FEATURE_INVENTORY.md tiers 2 and 3. Layer one's output format is the contract between them, and `schemas/session.schema.json` versions it.

### D2. Audio-derived features need audio, so the archive must keep full-rate stereo

Pitch range, intensity variation, rhythm metrics, and vowel formants (FEATURE_INVENTORY.md tier 3) need 48 kHz audio with no processing. The AGC finding (A1) means the USB capture already contains gain changes. Gain changes damage intensity measures and leave pitch and duration measures intact.

Ruling. Archive 48 kHz 16-bit stereo. Log the transmitter firmware version and the receiver gain setting per session. Mark intensity-based features `caveat: transmitter AGC` in the registry. Test whether the 32-bit float onboard recording bypasses the AGC (task V2b); if it does, the onboard import path (A5) becomes the research-grade audio source.

### D3. Research needs consent and pseudonymous identifiers from session one

Nothing in either document records consent or separates a student's name from a session. A dissertation committee will ask.

Ruling. The roster file maps a student name to a pseudonymous `participantId` and a `consentStatus` field. The archive stores the participant ID only. The name-to-ID map stays in a separate Blob path that the research export never reads. docs/rulings.md R2 gives the consent text and a 24-month retention period.

### D4. A feature registry

Every feature gets one entry in `features.json`: id, tier, construct, unit, inputs, formula, boundary method, literature reference, and caveats. The pipeline reads the registry to decide what to compute and what to label. The DOCX, the CSV, and the research export all read the same registry. Adding a feature means adding one entry and one pure function.

## E. Findings on the build process

### E1. iCloud is the wrong place for a Node repository

Joe asked for the local directory in iCloud. iCloud Drive syncs `node_modules` file by file, evicts files under storage pressure, and corrupts `.git` under concurrent sync. Google Drive has the same problem, which is why the lock keeps the repo outside Drive.

Ruling. `Viva Voice Dev` in iCloud contains the plan, the reference documents, the research outputs, and exported data. The git repository lives at `~/CC Projects/viva-voice`, the Claude Code projects folder. `PLAN.md` says this in Phase 0.

### E2. Claude Code cannot do the account work overnight

Creating a Vercel project, a private Blob store, a Deepgram key, a GitHub repository, DNS at Porkbun, and the hardware tests all need Joe. Porkbun stays locked until the Neo Mail account recovers, so nobody can set the `viva.weevillabs.dev` subdomain until then.

Ruling. build-plan.json has a `human` phase (Phase 0) with a checklist and `agent` phases (1 to 7) that Claude Code runs unattended against a mock transcriber and synthetic fixtures. Phases that need a live Deepgram key or hardware mark themselves `requiresHuman: true` and Claude Code skips them with a note. The app deploys to the default `*.vercel.app` URL first, and Joe adds the subdomain when Porkbun works again.

### E3. Autonomous builds need hard stops

Overnight Claude Code with no acceptance tests will produce a demo that looks done. Every phase in build-plan.json names its test command and the exit condition. CLAUDE.md tells Claude Code to stop at the first failing phase and write `BUILD_LOG.md`.

## F. Pricing

Deepgram's own pricing page refused the fetch. A third-party page dated 2026-08-24 reports Nova-3 streaming at $0.0048 per minute and pre-recorded at $0.0043 per minute, billed per channel-minute, and Deepgram's multichannel documentation confirms per-channel billing. Confidence on the dollar figures: low until Joe opens deepgram.com/pricing. At those rates a five-minute session costs 10 streaming channel-minutes plus 10 batch channel-minutes, about $0.09, or roughly ₩125 at 1,385 KRW per dollar. Ninety sessions per term cost about $8, or roughly ₩11,000. Vercel Pro costs $20 per month (about ₩27,700) and Joe already pays it. Blob storage for ninety stereo WAVs at 57.6 MB each is about 5.2 GB per term.

## G. Rulings

docs/rulings.md (2026-10-04) decides all five: the app stores the live score and keeps it out of every student output; retention is 24 months for audio and transcripts with measurements kept under participant IDs; a failed V1 means a two-input USB interface; the tap scale is 1 to 5; the exam machine is Chrome on the MacBook Air M4.
