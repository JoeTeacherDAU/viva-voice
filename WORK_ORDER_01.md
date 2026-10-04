# Work order 01: lossless archive and descriptive measures

Date: 2026-10-05. Branch: `fix/lossless-descriptive`. Pipeline version after this work order: 1.1.0. Registry version: 1.1.0. This work order replaces the `fix/turns-and-pruning` prompt from the night of 2026-10-04.

Read RESEARCH_PRINCIPLES.md before starting. Where this work order and RESEARCH_PRINCIPLES.md disagree, RESEARCH_PRINCIPLES.md wins. Log the disagreement in BUILD_LOG.md.

## 0. Setup

1. Create the branch `fix/lossless-descriptive` from main. Commit only to it.
2. Copy these files from `~/Library/Mobile Documents/com~apple~CloudDocs/Viva Voice Dev/` into the repository root, replacing the old copies: RESEARCH_PRINCIPLES.md, WORK_ORDER_01.md, features.json, FEATURE_INVENTORY.md, MEASUREMENT_FRAMEWORK.md, schemas/features.schema.json, scripts/gen-inventory.py. Copy features.json to lib/registry/features.json as well.
3. Add RESEARCH_PRINCIPLES.md to the "Read before you write" list in CLAUDE.md as item 0.

## 1. Turns: no pause disappears

1. `buildTurns` in lib/analysis/turns.ts closes a turn only when a partner floor word starts after the turn's last word. A same-channel silence of any length inside a turn is a pause.
2. `turnThresholdMs` stops splitting turns. Every within-turn pause at or above it writes a `long_pause` event (startMs, endMs, participant) into the session record and counts toward `long_pause_count`.
3. Remove the fixture-script asserts that forbid pauses over `turnThresholdMs` and that force same-channel turns apart.

## 2. Pruning: label every word and delete none

1. A word in `backchannelTokens` leaves the pruned list only when it belongs to a backchannel, meaning a candidate run inside a partner turn. Everywhere else it is an ordinary word. A lone backchannel-token run outside every partner turn stays a one-word floor turn.
2. research/viva/archive.py follows the same rule. Remove its separate "okay" handling.
3. Every word in every stored transcript has these labels, and no step removes a word: `removedAsCrosstalk`, `inWindow`, `isFiller`, `isRepetition`, `isBackchannel`, `inGap`. Add the four new boolean labels to schemas/words.schema.json. The pipeline computes counts by filtering on labels. The stored transcript keeps every word.
4. Implement the raw twins in features.json: `articulation_rate_raw_wpm`, `mean_length_of_run_raw`, `mattr_raw`. `speech_rate_raw_wpm` already exists.

## 3. Pauses and fillers by location and kind

Implement these tier 1 features from features.json: `silent_pause_mid_clause_rate`, `silent_pause_end_clause_rate`, `silent_pause_mid_clause_mean_ms`, `silent_pause_end_clause_mean_ms`, `long_pause_count`, `uh_count`, `um_count`, `filled_pause_mid_clause_count`, `filled_pause_end_clause_count`, `silence_after_filler_mean_ms`, `acoustic_pause_rate`, `asr_acoustic_pause_agreement`. Write each rule into docs/OPERATIONAL_DEFINITIONS.md in the same commit as its code. The fixture script implements each one separately from the pipeline, as that file already requires.

Change the composite to the registry's formula (mid-clause pause rate at 350 ms), weights version 1.1.

## 4. Archive keeps everything

1. Remove the pre-roll trim in lib/storage/archive.ts. The stored WAV runs from the first captured sample to the last. Keep `wavOffsetMs` at 0 for new sessions and keep the field so older records still align.
2. Store every Deepgram live message, interim and final, verbatim as JSON Lines at `transcripts/{id}/pass1-raw.jsonl`, with the session-clock offset of the connection that received it. Add the path to lib/storage/paths.ts and to `uploadPathAllowed`.
3. Pass two already stores the raw response. Confirm a test checks that the stored `raw` equals the response body byte for byte after JSON parsing.
4. Add `verbatim` and `phones` slots to the archive layout (`transcripts/{id}/verbatim-A.json`, `verbatim-B.json`, `phones/{id}/A.json`, `phones/{id}/B.json`) for the research layer to fill. The app never writes them.
5. Write a test that runs one mock session end to end and asserts that the archive's word count equals the transcriber's final word count, with no word missing.

## 5. Descriptive language

1. Student document labels: replace every label that names a construct with a plain description. "Breakdown" becomes "Pauses". "Repair" becomes "Fillers, repetitions, and restarts". The composite reads "Speed and pausing index, relative to this class". Each section opens with one sentence that says what the numbers count. The document never contains: error, deficit, accuracy, accent, nativelike, native-like, breakdown, interference, disfluency, weak, poor. Add a unit test that fails when any of those words appears in a generated document.
2. Apply the same word list to the review page and the setup page.
3. The research export keeps construct names in column metadata only, with the reference from features.json.

## 6. Research layer stubs

1. research/viva/verbatim.py: a module that runs CrisperWhisper on each channel of the archived WAV when someone has installed the model, and writes the verbatim slots. When it is missing, the manifest records the four tier 2 verbatim features as skipped with the reason "CrisperWhisper not installed". Do not download the model in CI.
2. research/viva/phones.py: the same pattern for `facebook/wav2vec2-xlsr-53-espeak-cv-ft` and the tier 3 segmental features.
3. Neither module ever writes a score. Each writes counts, spans, and phone strings.

## 7. Fixtures

Add these cases to the golden fixtures and regenerate expected.json from the fixture script's own arithmetic:

1. A 2,500 ms pause inside one student's turn.
2. "Yeah, I think that's right" at the start of a turn.
3. "really good" inside a turn.
4. A lone "okay" that answers the partner after the partner's turn ends.
5. A single "yeah" that appears on both channels within 300 ms.
6. An "uh" followed by 600 ms of silence and an "um" followed by 1,200 ms of silence.
7. A mid-clause pause and an end-clause pause of equal length in the same turn.

## 8. Finish

1. Set PIPELINE_VERSION to 1.1.0.
2. Run lint, test, build, the contrast check, the feature-coverage script, e2e, and pytest. Run the vitest suite with and without VIVA_MOCK_ASR=1.
3. Push the branch. Wait for the GitHub CI result on the branch. Fix and repeat until green.
4. Append a BUILD_LOG.md entry. List every departure with its reason.
5. Do not merge. Tell Joe the branch is ready and give him the GitHub compare link.
