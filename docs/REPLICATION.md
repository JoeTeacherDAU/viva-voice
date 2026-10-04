# Reproducing a measurement

Every number Viva Voice reports traces back to files in the private Blob store and to a pipeline version recorded beside it. This guide says which files hold what, how to rerun a measurement, and what a rerun proves.

## What the archive keeps for each session

The session record at sessions/{sessionId}.json holds the configuration (thresholds, gating margin, weights and their version, filler and backchannel lists, target patterns), the Start and Stop markers, every event (faults, transcriber gaps, score taps, the archive step, each pass two run), the pipeline version, and the transcription model string. Its archive event also records wavOffsetMs, the capture time of the first sample in the stereo WAV. Sessions recorded from pipeline 1.1.0 on keep every captured sample and count capture time from that first sample, so their wavOffsetMs is 0; older sessions trimmed the audio before Start and record a positive offset.

The audio sits at audio/{sessionId}/stereo.wav (48 kHz, 16-bit, two channels), with audio/{sessionId}/onboard-stereo.wav beside it when you import onboard recordings. The 20 ms energy frames sit at energy/{sessionId}.json.

Pass one's words sit at transcripts/{sessionId}/pass1.json and its measurements at measurements/{sessionId}/pass1.json. Every message the live recognizer sent, interim and final, sits verbatim at transcripts/{sessionId}/pass1-raw.jsonl, one JSON line per message, with the connection's session-clock offset and the capture time of the Start marker, which together put each message on the WAV's timeline. Every word in a stored transcript carries six labels (removedAsCrosstalk, inWindow, inGap, isFiller, isRepetition, isBackchannel); no step deletes a word, and docs/OPERATIONAL_DEFINITIONS.md defines each label.

The research layer adds verbatim transcripts at transcripts/{sessionId}/verbatim-A.json and verbatim-B.json, and free phone strings at phones/{sessionId}/A.json and B.json, when its models are installed. The app never writes these files. Pass two, the record of account, writes transcripts/{sessionId}/pass2.json (with Deepgram's raw response and the model string) and measurements/{sessionId}/pass2.json. The pass-two measurements file also stores the course baseline as it stood when pass two ran, because the baseline file at baselines/{examId}.json grows with every later session.

## Rerunning the pipeline on a stored transcript

Open /review/{sessionId} and press "Recompute from stored transcript". The browser fetches the pass-two transcript, the energy frames, the stored baseline snapshot, and the pass-one measurements, runs the current pipeline over them, and compares every value with measurements/{sessionId}/pass2.json. The screen labels the result "replication run" with the pipeline version and lists every value that differs.

With the pipeline version the session recorded, a replication run shows zero differences. The automated tests check this on the golden fixtures and in the end-to-end session test. A difference after a pipeline change shows exactly which measures the change moved.

To rerun a session under an older pipeline, check out the commit whose lib/analysis/pipeline.ts exports the version the session recorded (git log -S "PIPELINE_VERSION = \"1.0.0\"" finds it), run npm ci and npm run dev, and press the same button.

## Re-transcribing

"Re-transcribe" on the review screen sends the stored WAV to Deepgram again and runs the pipeline on the new words. It writes the result to transcripts/{sessionId}/robustness-{time}.json and measurements/{sessionId}/robustness-{time}.json, adds a robustness_check event to the session record, and shows the differences from the record of account. It never changes the record of account, the baseline, the documents, or the CSVs. A model update at Deepgram shows up here as differences labelled with the new model string and the date.

## Checking the pipeline itself

The three golden fixtures under fixtures/golden carry their own expected values, which scripts/make-fixtures.mjs computes from the authored conversation without calling the pipeline. docs/OPERATIONAL_DEFINITIONS.md states every rule both sides follow. Run npm run test to check all 480 values, and node scripts/make-fixtures.mjs to regenerate the fixtures byte for byte.

## The research export

The research layer reads a local copy of the archive with the same folder layout. From the research folder:

1. uv run viva-research export --exam {examId} --tiers 2 --archive {path to the local copy}
2. Read research-export/{examId}/manifest.json first. It lists the tool version, the Python version, the registry version, every session included, every feature computed, and every feature skipped with the reason.
3. Load research-export/{examId}/long.csv, which has one row per feature per student per session and names the transcript source (pass2, or pass1 where pass two never ran).

To try the export without real data, uv run viva-research fixture-archive --out archive-sync writes the balanced fixture in archive layout, and the export command above then runs with --exam fixture-exam. The research layer refuses to read anything under roster/.
