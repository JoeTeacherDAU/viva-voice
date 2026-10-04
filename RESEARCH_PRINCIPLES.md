# Viva Voice: research principles

Version 1.0, 2026-10-05. These principles govern every file in this project. Where PLAN.md, MEASUREMENT_FRAMEWORK.md, features.json, or the code disagrees with this file, this file wins and the other file changes.

Viva Voice is a research instrument first. It records how two students speak to each other and keeps that record whole. The live display and the student document are two views of the record. Neither view decides what the archive keeps.

## Principle 1. Keep everything

The archive keeps every signal the system captures, at full resolution, for the retention period in docs/rulings.md.

1. Audio: the full 48 kHz stereo capture from the first sample to the last, including the time before Start and after Stop. The Start and Stop markers mark the measurement window inside the recording. No step trims audio.
2. Recognizer output: every message Deepgram returns, interim and final, for both passes, stored verbatim as received (pass one as JSON Lines, pass two as the full response body). Parsed word lists live beside the raw files and never replace them.
3. Energy: every 20 ms frame for both channels.
4. Events: every fault, gap, reconnect, score tap, and long pause, with timestamps.
5. Words: no step deletes a word. Cross-talk rejection, windowing, pruning, and backchannel classification each add a label to a word. Every word stays in the stored transcript with all its labels.

## Principle 2. Label every word and delete none

Every measure that leaves words out of a count reports a twin that keeps them in. The system reports pruned speech rate and raw speech rate together, and pruned and raw mean length of run together. A filler, a repetition, or a backchannel is a coded event with its own count and its own timing. It is never missing data.

## Principle 3. Pauses and fillers are behaviour to describe

A silent pause or an "um" can plan the next idea, hold the floor, signal a coming delay, mark emphasis, or give a partner room. The research literature supports reading them by location and kind:

1. Kahng (2014) compared Korean learners of English with L1 English speakers and found the clearest group difference in silent pauses inside clauses. de Jong (2016) found L1 and L2 speakers paused alike between utterances and differed inside them, and found both groups paused more before lower-frequency words. Révész et al. (2026) linked mid-clause pauses to language-related brain activity and end-clause pauses to conceptualisation.
2. Clark and Fox Tree (2002) analysed "uh" and "um" in spontaneous English and argued that speakers use them as words that signal an upcoming delay, with "um" signalling a longer one. (I know this paper well; I did not open it in this session.)

So the system records every pause and filler with its location (inside a clause, at a clause boundary, at a turn boundary), its duration, its kind (silent, "uh", "um", other filler), and what follows it. The student document reports these as patterns. It never labels a pause or a filler as a fault.

The composite index changes to match: it uses the mid-clause silent pause rate, because end-clause pauses look alike in L1 and L2 speech in both Kahng (2014) and de Jong (2016).

## Principle 4. Describe L1 influence without a native-speaker yardstick

The project studies cross-linguistic influence from Korean. It describes what each speaker produces. It does not score distance from British or American English.

1. Vocabulary. Every output uses "variant", "realisation", and "cross-linguistic influence". No output uses "error", "deficit", "accent score", "nativelike", "accuracy", "breakdown", or "interference". The research export may keep construct names from the literature (for example "breakdown fluency") inside column metadata, with a citation.
2. Reference forms are coordinates. The CMU Pronouncing Dictionary gives a canonical phone sequence for each word. The system uses that sequence to locate where a speaker's realisation differs, the way a map uses a grid. A difference becomes a counted variant with a type (for example vowel epenthesis after a final stop, or [p] for /f/). The system never converts a variant count into a score.
3. Self-reference first. Every speaker's variant rates and temporal patterns compare first to that speaker's own other sessions, then to the cohort. Suzuki et al. (2024) found that L1 fluency predicts L2 fluency, so an optional one-minute Korean warm-up recording (tier 4, l1_utterance_fluency) would let a study separate a person's speaking style from their L2 processing. That task changes the exam protocol, so it waits for Joe's decision.
4. Intelligibility is an outcome to study. Barrass et al. (2020) found that some Korean-English features (epenthesis, nasal-for-plosive substitution, [wʊ]) affected intelligibility for L1 Mandarin listeners and others did not. Which variants matter, and to whom, is a research question for listener studies (tier 4).

## Principle 5. State what the system cannot hear

A general speech recognizer normalises speech toward standard spelling. Deepgram transcribes only seven filler and backchannel tokens, drops word fragments, maps an L1-influenced pronunciation to the dictionary word it guesses, and does not transcribe Korean fillers such as "eo" or "eum" as Korean. The live and batch passes therefore undercount disfluency and hide phonetic variation by design.

The system closes those gaps in layers, and labels each layer's coverage:

1. Tier 1 adds pause detection from the energy frames, independent of the recognizer, and reports where the two methods disagree.
2. Tier 2 adds a verbatim recognition pass with CrisperWhisper, an English model fine-tuned to transcribe fillers, false starts, and repetitions with word timestamps (Wagner, Thallinger, and Zusag, 2024, arXiv 2408.16589, CC BY 4.0). It runs offline in the research layer and stores its raw output as a third transcript.
3. Tier 3 adds a free phone recognition pass (a wav2vec2 model fine-tuned on eSpeak phone labels, such as facebook/wav2vec2-xlsr-53-espeak-cv-ft) aligned against the dictionary form, plus acoustic detection of filled pauses, elongation, laughter, and breath. A free phone recognizer reports the phones it hears without forcing them into English words.
4. Tier 4 is human: annotation of a validation subset, stimulated recall, and listener studies.

Every measure records which layer produced it. No measure claims coverage its layer lacks.

## Principle 6. The assessment views stay downstream

Decisions 4 and 6 keep a live index for Joe and a document for Markomatic. Both read from the archive and write nothing back to it. The index label on the student document reads "speed and pausing index, relative to this class", and the document explains each number in descriptive terms. The research export never reads an assessment view.

## References

Barrass, J. P., et al. (2020). Intelligibility and comprehensibility of Korean English speakers' phonological features in lingua franca listening contexts. The Journal of AsiaTEFL. https://consensus.app/papers/details/503b2dfc44e156ad833c21c6d7c86d4f/

Clark, H. H., & Fox Tree, J. E. (2002). Using uh and um in spontaneous speaking. Cognition, 84(1), 73–111.

de Jong, N. H. (2016). Predicting pauses in L1 and L2 speech: The effects of utterance boundaries and word frequency. IRAL. https://consensus.app/papers/details/c65173da5a255dfba5234cea84d4204c/

Kahng, J. (2014). Exploring utterance and cognitive fluency of L1 and L2 English speakers: Temporal measures and stimulated recall. Language Learning. https://consensus.app/papers/details/7e1c775de61e5821b77278dada2e995f/

Révész, A., et al. (2026). The neural correlates of mid- and end-clause silent pauses in L1 and L2 speech. Bilingualism: Language and Cognition. https://consensus.app/papers/details/3df1949b9e735254928fd79b4d941acb/

Suzuki, S., et al. (2024). The moderating role of L2 proficiency in the predictive power of L1 fluency on L2 utterance fluency. Language Testing. https://consensus.app/papers/details/7f9777cc63c65b04a795436a133ef6a1/

Wagner, L., Thallinger, B., & Zusag, M. (2024). CrisperWhisper: Accurate timestamps on verbatim speech transcriptions. arXiv:2408.16589. https://arxiv.org/abs/2408.16589
