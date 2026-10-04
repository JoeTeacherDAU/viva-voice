# Viva Voice: feature inventory

Every speech feature this system can measure now or later, grouped by tier. scripts/gen-inventory.py generates this file from `features.json` (registry version 1.1.0, 2026-10-05). Edit the JSON and regenerate; never edit this file by hand.

## How to read this file

RESEARCH_PRINCIPLES.md governs every entry: the archive keeps everything, every pruned measure has a raw twin, pauses and fillers are described by location and kind, and L1 influence appears as counted variants with no native-speaker score.

Tier 1 features ship in the app and appear in the student document and the cohort CSV. Tier 2 features run in the Python research layer from stored transcripts. Tier 3 features need the archived audio, a phone recognizer, forced alignment, or an acoustic toolkit. Tier 4 features need people: annotation, stimulated recall, or listener studies.

A reference marked "none verified" means I did not open a supporting paper, so treat that feature as a candidate.

## What the archive keeps

words: Word-level transcript with start, end, confidence, punctuated_word, channel, isFinal, pass.

energy: Per-channel dBFS frames at 20 ms.

audio: Archived 48 kHz 16-bit stereo WAV.

alignment: Phone- and syllable-level timings from a forced aligner run on the archive.

roster: Pseudonymous participant IDs, consent status, course and unit metadata.

instructor: Instructor live score and later rubric scores, stored apart from student outputs.

rawAsr: Every Deepgram message, interim and final, both passes, stored verbatim.

verbatim: CrisperWhisper verbatim transcript per channel with word timestamps (research layer).

phones: Free phone recognition per channel (wav2vec2 eSpeak phone model) aligned to dictionary forms.

## Research questions this inventory supports

1. How Korean university students distribute silent pauses and fillers across clause boundaries, turn boundaries, and positions before low-frequency words in paired conversation, and how that distribution changes between midterm and final sessions (tiers 1 and 2).
2. Whether "uh" and "um" precede different delay lengths in L2 dialogue, testing Clark and Fox Tree (2002) with two-channel timing (tier 1).
3. Whether follow-up questions draw longer partner answers than new-topic questions (Study 2 Plan A, tier 2).
4. How pair asymmetry relates to each partner's speaking patterns (tier 1).
5. Which Korean-influenced segmental variants (epenthesis, nasalization, consonant realisations) each speaker produces, how stable they are within a speaker, and which ones listeners find hard to understand (tiers 3 and 4).
6. How much disfluency a general recognizer normalises away compared with a verbatim recognizer, by speaker (tier 2 quality measures).
7. Rhythm, vowel reduction, and pitch range in Korean L1 speakers' spontaneous English, described against each speaker's own sessions (tier 3).

## Tier 1: in the app

Ships in the TypeScript app. Computed in pass one and pass two. Appears in the student DOCX and the cohort CSV.

### breakdown

**silent_pause_rate**. Unit: pauses per minute of phonation time. Inputs: words. Formula: pauseCount(threshold) / (phonationMs / 60000). Parameters: pauseThresholdMs=[200, 350]. Reference: Gao, Sun & Li 2025; Gao & Sun 2025. Caveats: within-turn gaps only.

**silent_pause_mean_ms**. Unit: ms. Inputs: words. Formula: mean(pauseDurations(threshold)). Parameters: pauseThresholdMs=[200, 350]. Reference: Suzuki et al. 2021. Caveats: none.

**silent_pause_max_ms**. Unit: ms. Inputs: words. Formula: max(pauseDurations(threshold)). Parameters: pauseThresholdMs=[200, 350]. Reference: Suzuki et al. 2021. Caveats: none.

**silent_pause_mid_clause_count**. Unit: count. Inputs: words. Formula: count(pauses where previous punctuated_word has no clause-final punctuation). Parameters: pauseThresholdMs=[200, 350], boundaryMethod="punctuation". Reference: Gao, Sun & Li 2025; Matsuura et al. 2022. Caveats: punctuation boundary is a proxy for AS-unit boundary.

**silent_pause_end_clause_count**. Unit: count. Inputs: words. Formula: count(pauses where previous punctuated_word ends with . ? ! , ;). Parameters: pauseThresholdMs=[200, 350], boundaryMethod="punctuation". Reference: Gao, Sun & Li 2025. Caveats: punctuation boundary is a proxy for AS-unit boundary.

**mean_length_of_run**. Unit: pruned words between pauses. Inputs: words. Formula: mean(prunedWordsPerRun(threshold)). Parameters: pauseThresholdMs=[200, 350]. Reference: Kormos & Dénes 2004; Préfontaine et al. 2016. Caveats: pruned view; a raw twin reports the same measure with every word kept.

**mean_length_of_run_raw**. Unit: raw words between pauses. Inputs: words. Formula: mean(rawWordsPerRun(threshold)). Parameters: pauseThresholdMs=[200, 350]. Reference: RESEARCH_PRINCIPLES.md principle 2. Caveats: raw twin of mean_length_of_run.

**silent_pause_mid_clause_rate**. Unit: mid-clause pauses per minute of phonation time. Inputs: words. Formula: silent_pause_mid_clause_count / (phonationMs / 60000). Parameters: pauseThresholdMs=[200, 350], boundaryMethod="punctuation". Reference: Kahng 2014; de Jong 2016; Révész et al. 2026. Caveats: punctuation proxy for clause boundary.

**silent_pause_end_clause_rate**. Unit: end-clause pauses per minute of phonation time. Inputs: words. Formula: silent_pause_end_clause_count / (phonationMs / 60000). Parameters: pauseThresholdMs=[200, 350], boundaryMethod="punctuation". Reference: Kahng 2014; de Jong 2016. Caveats: planning pauses; similar in L1 and L2 speech in both studies.

**silent_pause_mid_clause_mean_ms**. Unit: ms. Inputs: words. Formula: mean(mid-clause pause durations). Parameters: pauseThresholdMs=[200, 350]. Reference: de Jong 2016. Caveats: none.

**silent_pause_end_clause_mean_ms**. Unit: ms. Inputs: words. Formula: mean(end-clause pause durations). Parameters: pauseThresholdMs=[200, 350]. Reference: de Jong 2016. Caveats: none.

**long_pause_count**. Unit: count. Inputs: words. Formula: count(within-turn pauses >= turnThresholdMs). Parameters: turnThresholdMs=1500. Reference: RED_TEAM fix 2026-10-05. Caveats: each one also logged as a long_pause event.

**acoustic_pause_rate**. Unit: per minute of window time. Inputs: energy. Formula: count of own-channel silent runs >= threshold inside own speech regions, from energy frames. Parameters: pauseThresholdMs=[200, 350], speechFloorDbfs=-60. Reference: RESEARCH_PRINCIPLES.md principle 5. Caveats: independent of the recognizer; AGC can raise bleed above the floor.

### composite

**composite_fluency_index**. Unit: z-score mean. Inputs: words. Formula: 0.5*(-z(silent_pause_mid_clause_rate@350)) + 0.25*z(speech_rate_wpm) + 0.25*z(mean_length_of_run@350). Parameters: baselineMinSessions=10, weightsVersion="1.1". Reference: Suzuki et al. 2021; Gao & Sun 2025; Kahng 2014; de Jong 2016. Caveats: null below baselineMinSessions; hidden on display until instructor tap; uses mid-clause pauses only; end-clause pauses look alike in L1 and L2 speech (Kahng 2014; de Jong 2016); student document label: speed and pausing index, relative to this class.

### interaction

**turn_count**. Unit: count. Inputs: words. Formula: count(turns on this channel). Parameters: turnThresholdMs=1500. Reference: Galaczi 2014; Gao & Sun 2025. Caveats: participation measure; stays out of the index.

**mean_turn_length_words**. Unit: pruned words. Inputs: words. Formula: mean(prunedWordsPerTurn). Parameters: none. Reference: Galaczi 2014. Caveats: none.

**talk_time_share**. Unit: ratio. Inputs: words, energy. Formula: thisPhonationMs / (thisPhonationMs + partnerPhonationMs). Parameters: none. Reference: Ortaçtepe Hart 2020. Caveats: pair-level; depends on cross-talk rejection.

**response_latency_mean_ms**. Unit: ms. Inputs: words. Formula: mean(thisFirstWordStart - partnerLastWordEnd) over transitions. Parameters: none. Reference: Eskin 2026. Caveats: negative values are overlaps; reported separately.

**response_latency_median_ms**. Unit: ms. Inputs: words. Formula: median(...). Parameters: none. Reference: Eskin 2026. Caveats: none.

**overlap_count**. Unit: count. Inputs: words. Formula: count(intervals where both channels carry attributed words). Parameters: none. Reference: Galaczi 2014. Caveats: none.

**overlap_duration_ms**. Unit: ms. Inputs: words. Formula: sum(overlapIntervals). Parameters: none. Reference: Galaczi 2014. Caveats: none.

**backchannel_count**. Unit: count. Inputs: words. Formula: count(token in backchannelTokens inside partner's turn). Parameters: backchannelTokens=["mhmm", "mm-mm", "uh-huh", "uh-uh", "nuh-uh", "yeah", "right", "okay", "really"]. Reference: Galaczi 2014; Borger 2019. Caveats: interactive listening proxy; a token counts as a backchannel only inside a partner turn; elsewhere it is an ordinary word.

**open_floor_response_count**. Unit: count. Inputs: words. Formula: count(backchannel candidates whose partnerSilenceMs >= floorLapseMs). Parameters: floorLapseMs=1500. Reference: Joe's ruling on the floor-holding rule, 2026-10-05; docs/OPERATIONAL_DEFINITIONS.md. Caveats: a candidate is any run of backchannel tokens, so a token that opens or sits inside the student's own turn counts when the partner is silent that long; each candidate word carries overlapsPartner, partnerSilenceMs, partnerResumesNext, and floorClass labels.

**question_count**. Unit: count. Inputs: words. Formula: count(turns whose last punctuated_word ends with ?). Parameters: none. Reference: Galaczi 2014. Caveats: punctuation proxy.

### lexical

**mattr**. Unit: ratio. Inputs: words. Formula: mean(types/tokens over sliding window of 50 tokens). Parameters: window=50. Reference: Kyle et al. 2023. Caveats: needs 50 or more pruned tokens; else null; pruned view; a raw twin reports the same measure with every word kept.

**mtld**. Unit: factor length. Inputs: words. Formula: MTLD at TTR threshold 0.72, forward and backward mean. Parameters: ttrThreshold=0.72. Reference: Kyle et al. 2023. Caveats: none.

**target_structure_hits**. Unit: count and spans. Inputs: words. Formula: matches of targetPatterns (word-boundary anchored) over final words. Parameters: targetPatterns="per unit". Reference: course design. Caveats: live counter uses finals only.

**mattr_raw**. Unit: ratio. Inputs: words. Formula: MATTR over every attributed token, window 50. Parameters: window=50. Reference: Kyle et al. 2023. Caveats: raw twin of mattr.

### quality

**unattributed_frame_ratio**. Unit: ratio. Inputs: energy. Formula: unattributedFrames / totalFramesWithSpeech. Parameters: none. Reference: system. Caveats: capture quality flag.

**crosstalk_removed_words**. Unit: count. Inputs: words. Formula: count(words removed as cross-talk from this channel). Parameters: none. Reference: system. Caveats: none.

**mean_word_confidence**. Unit: 0-1. Inputs: words. Formula: mean(confidence) over final words. Parameters: none. Reference: Yu 2026. Caveats: pass two includes per-word confidence.

**pass_agreement_speech_rate**. Unit: absolute difference. Inputs: words. Formula: abs(speech_rate_wpm.pass1 - speech_rate_wpm.pass2). Parameters: none. Reference: system. Caveats: none.

**asr_acoustic_pause_agreement**. Unit: ratio. Inputs: words, energy. Formula: share of word-gap pauses that overlap an acoustic silent run by at least 50 percent. Parameters: none. Reference: RESEARCH_PRINCIPLES.md principle 5. Caveats: promoted from tier 3 pause_acoustic_vs_asr_agreement.

### repair

**filled_pause_count**. Unit: count. Inputs: words. Formula: count(word in fillerTokens). Parameters: fillerTokens=["uh", "um"], deepgramFlag="filler_words=true". Reference: Suzuki et al. 2021. Caveats: Deepgram transcribes uh and um only; add Korean fillers to fillerTokens if they appear as words.

**filled_pause_rate**. Unit: per minute of phonation time. Inputs: words. Formula: filled_pause_count / (phonationMs / 60000). Parameters: none. Reference: Gao & Sun 2025. Caveats: none.

**repetition_count**. Unit: count. Inputs: words. Formula: count(word[i] == word[i-1]) + count(bigram[i] == bigram[i-1]). Parameters: none. Reference: Suzuki et al. 2021. Caveats: final words only.

**false_start_count**. Unit: count. Inputs: words. Formula: count(1-3 word fragment followed by restart sharing no token, before a boundary). Parameters: maxFragmentWords=3. Reference: Gao & Sun 2025. Caveats: pass two only; heuristic; tier 2 adds a parsed version.

**uh_count**. Unit: count. Inputs: words. Formula: count(token == 'uh'). Parameters: none. Reference: Clark & Fox Tree 2002. Caveats: recognizer coverage only; tier 2 verbatim pass adds more.

**um_count**. Unit: count. Inputs: words. Formula: count(token == 'um'). Parameters: none. Reference: Clark & Fox Tree 2002. Caveats: um and uh signal different expected delays in Clark & Fox Tree.

**filled_pause_mid_clause_count**. Unit: count. Inputs: words. Formula: fillers whose previous non-filler word has no clause-final punctuation. Parameters: boundaryMethod="punctuation". Reference: de Jong 2016. Caveats: none.

**filled_pause_end_clause_count**. Unit: count. Inputs: words. Formula: fillers after clause-final punctuation or at turn start. Parameters: boundaryMethod="punctuation". Reference: de Jong 2016. Caveats: none.

**silence_after_filler_mean_ms**. Unit: ms. Inputs: words. Formula: mean gap from each filler's end to the next word's start, within turn. Parameters: none. Reference: Clark & Fox Tree 2002. Caveats: tests the delay-signal reading of uh and um.

### speed

**speech_rate_wpm**. Unit: pruned words per minute of window time. Inputs: words. Formula: prunedWordCount / (windowMs / 60000). Parameters: none. Reference: Kormos & Dénes 2004; Suzuki et al. 2021. Caveats: counts words; tier 3 gives syllables; pruned view; a raw twin reports the same measure with every word kept.

**speech_rate_raw_wpm**. Unit: raw words per minute of window time. Inputs: words. Formula: rawWordCount / (windowMs / 60000). Parameters: none. Reference: Kormos & Dénes 2004. Caveats: none.

**articulation_rate_wpm**. Unit: pruned words per minute of phonation time. Inputs: words. Formula: prunedWordCount / (phonationMs / 60000). Parameters: pauseThresholdMs=[200, 350]. Reference: Préfontaine et al. 2016. Caveats: counts words; tier 3 gives syllables; pruned view; a raw twin reports the same measure with every word kept.

**articulation_rate_sps_est**. Unit: estimated syllables per second of phonation time. Inputs: words. Formula: sum(dictSyllables(word)) / (phonationMs / 1000). Parameters: dictionary="cmudict", fallback="orthographic vowel-group count". Reference: Préfontaine et al. 2016. Caveats: pass two only; dictionary estimate; tier 3 replaces with aligned syllables.

**phonation_time_ratio**. Unit: ratio. Inputs: words. Formula: phonationMs / windowMs. Parameters: pauseThresholdMs=[200, 350]. Reference: Kormos & Dénes 2004. Caveats: none.

**articulation_rate_raw_wpm**. Unit: raw words per minute of phonation time. Inputs: words. Formula: rawWordCount / (phonationMs / 60000). Parameters: pauseThresholdMs=[200, 350]. Reference: RESEARCH_PRINCIPLES.md principle 2. Caveats: raw twin of articulation_rate_wpm.

## Tier 2: transcript-based research features

Python research layer. Computed from the archived transcript JSON. Appears in the research export only.

### breakdown

**silent_pause_mid_as_unit_count**. Unit: count. Inputs: words. Formula: pauses inside an AS-unit. Parameters: boundaryMethod="as-unit". Reference: Gao, Sun & Li 2025. Caveats: replaces the punctuation proxy.

**silent_pause_end_as_unit_count**. Unit: count. Inputs: words. Formula: pauses at an AS-unit boundary. Parameters: boundaryMethod="as-unit". Reference: Gao, Sun & Li 2025. Caveats: none.

**pause_before_low_frequency_word_ratio**. Unit: ratio. Inputs: words. Formula: share of mid-clause pauses followed by a word below a frequency cutoff. Parameters: frequencyList="SUBTLEX-US or COCA spoken". Reference: de Jong 2016. Caveats: lexical-retrieval reading of a pause.

**pause_function_profile**. Unit: proportions. Inputs: words. Formula: each pause classed as AS-unit boundary, pre-content-word, pre-low-frequency-word, after filler, or other; report proportions. Parameters: none. Reference: de Jong 2016; Kahng 2014. Caveats: descriptive categories; stimulated recall (tier 4) validates function.

### code-switching

**korean_token_count**. Unit: count. Inputs: words. Formula: words Deepgram returns outside the English lexicon that match a Korean romanisation list, or words from a Korean-language second pass. Parameters: none. Reference: none verified. Caveats: Deepgram English model will mis-transcribe Korean; a Korean batch pass on flagged spans is the honest method.

### interaction

**topic_initiation_count**. Unit: count. Inputs: words. Formula: turns that introduce a new noun-phrase topic absent from the previous five turns. Parameters: none. Reference: Galaczi 2014; Borger 2019. Caveats: lexical proxy for topic development; human coding is the standard.

**follow_up_question_count**. Unit: count. Inputs: words. Formula: questions whose content words overlap the partner's previous turn. Parameters: none. Reference: Study 2 Plan A. Caveats: shares a definition with Joe's Study 2.

**new_topic_question_count**. Unit: count. Inputs: words. Formula: questions with no content-word overlap with the partner's previous turn. Parameters: none. Reference: Study 2 Plan A. Caveats: none.

**partner_answer_length_after_question**. Unit: pruned words. Inputs: words. Formula: length of the partner's turn following each question, by question type. Parameters: none. Reference: Study 2 Plan A. Caveats: pair-level.

### lexical

**bigram_proportion**. Unit: ratio. Inputs: words. Formula: share of adjacent word pairs found in a reference bigram list. Parameters: referenceCorpus="COCA spoken, or BNC spoken". Reference: Takizawa et al. 2025. Caveats: needs a licensed or open reference list.

**trigram_mutual_information**. Unit: mean MI. Inputs: words. Formula: mean association strength of trigrams against a reference corpus. Parameters: none. Reference: Takizawa et al. 2025. Caveats: none.

**word_frequency_mean_log**. Unit: log frequency. Inputs: words. Formula: mean log frequency of content words. Parameters: tool="TAALES or equivalent". Reference: Kyle & Crossley 2015. Caveats: none.

**academic_word_ratio**. Unit: ratio. Inputs: words. Formula: AWL tokens / pruned tokens. Parameters: none. Reference: Kyle & Crossley 2015. Caveats: none.

**content_word_ratio**. Unit: ratio. Inputs: words. Formula: content tokens / pruned tokens. Parameters: tagger="spaCy en_core_web_trf". Reference: Kyle & Crossley 2015. Caveats: none.

### morphology

**kolmogorov_complexity_morphology**. Unit: compression ratio. Inputs: words. Formula: compressed size of token stream / compressed size of lemma stream. Parameters: none. Reference: Alzahrani 2024. Caveats: none.

**inflectional_morpheme_rate**. Unit: per 100 words. Inputs: words. Formula: count(-s, -ed, -ing, -er, -est, 's) / pruned words * 100. Parameters: tagger="spaCy morphology". Reference: general L2 morphology practice. Caveats: no L2 speech citation verified in this session.

**third_person_s_supplied_ratio**. Unit: ratio. Inputs: words. Formula: supplied / obligatory contexts, from parse. Parameters: none. Reference: suppliance-in-obligatory-contexts tradition. Caveats: obligatory-context detection from ASR text is error-prone.

**past_tense_supplied_ratio**. Unit: ratio. Inputs: words. Formula: supplied / obligatory contexts, from parse and temporal adverbs. Parameters: none. Reference: suppliance-in-obligatory-contexts tradition. Caveats: heuristic.

**article_omission_rate**. Unit: per noun phrase. Inputs: words. Formula: singular count nouns with no determiner / singular count noun phrases. Parameters: none. Reference: Korean L1 interference literature, unverified here. Caveats: heuristic.

### pragmatics

**discourse_marker_rate**. Unit: per 100 words. Inputs: words. Formula: count(discourseMarkers) / pruned words * 100. Parameters: discourseMarkers=["so", "well", "actually", "I mean", "you know", "like", "anyway"]. Reference: general discourse-marker practice. Caveats: no L2 speech citation verified in this session.

**hedge_rate**. Unit: per 100 words. Inputs: words. Formula: count(hedges) / pruned words * 100. Parameters: hedges=["maybe", "I think", "kind of", "sort of", "probably", "a little"]. Reference: general pragmatics practice. Caveats: none.

**agreement_token_rate**. Unit: per turn. Inputs: words. Formula: count(agreement tokens at turn start) / turns. Parameters: none. Reference: Galaczi 2014. Caveats: none.

### quality

**word_error_rate_vs_human**. Unit: ratio. Inputs: words. Formula: WER against a hand-corrected transcript for a validation subset. Parameters: none. Reference: Yu 2026; Qiao et al. 2021. Caveats: needs human transcription of a sample.

**asr_verbatim_word_disagreement**. Unit: ratio. Inputs: words, verbatim. Formula: word-level edit distance between Deepgram pass two and the verbatim pass / verbatim word count. Parameters: none. Reference: Principle 5. Caveats: measures what the main recognizer normalised away.

### repair

**false_start_count_parsed**. Unit: count. Inputs: words. Formula: abandoned constituents from a disfluency-aware parse. Parameters: none. Reference: Matsuura et al. 2022. Caveats: none.

**self_repair_count**. Unit: count. Inputs: words. Formula: reparandum-editing-repair patterns (same-turn correction). Parameters: none. Reference: Matsuura et al. 2022. Caveats: heuristic.

**verbatim_filler_count**. Unit: count. Inputs: verbatim. Formula: fillers in the CrisperWhisper transcript. Parameters: model="CrisperWhisper". Reference: Wagner et al. 2024. Caveats: English model; Korean fillers may appear as uh/um or drop.

**verbatim_partial_word_count**. Unit: count. Inputs: verbatim. Formula: word fragments in the verbatim transcript. Parameters: none. Reference: Wagner et al. 2024. Caveats: none.

**verbatim_repetition_count**. Unit: count. Inputs: verbatim. Formula: repetitions in the verbatim transcript. Parameters: none. Reference: Wagner et al. 2024. Caveats: none.

### syntax

**mean_length_as_unit**. Unit: words. Inputs: words. Formula: pruned words / AS-units. Parameters: segmenter="rule-based AS-unit over dependency parse". Reference: Kim et al. 2024. Caveats: AS-unit segmentation of ASR output needs validation.

**mean_length_clause**. Unit: words. Inputs: words. Formula: pruned words / clauses. Parameters: none. Reference: Kim et al. 2024; Lu 2017. Caveats: none.

**clauses_per_as_unit**. Unit: ratio. Inputs: words. Formula: clauses / AS-units. Parameters: none. Reference: Kim et al. 2024. Caveats: none.

**dependent_clauses_per_clause**. Unit: ratio. Inputs: words. Formula: dependent clauses / clauses. Parameters: none. Reference: Kim et al. 2024. Caveats: none.

**complex_nominals_per_clause**. Unit: ratio. Inputs: words. Formula: complex nominals / clauses. Parameters: none. Reference: Kim et al. 2024; Lu 2017. Caveats: none.

**coordinate_phrases_per_clause**. Unit: ratio. Inputs: words. Formula: coordinate phrases / clauses. Parameters: none. Reference: Lu 2017. Caveats: none.

**verb_phrases_per_as_unit**. Unit: ratio. Inputs: words. Formula: verb phrases / AS-units. Parameters: none. Reference: Lu 2017. Caveats: none.

**mean_dependency_distance**. Unit: tokens. Inputs: words. Formula: mean |head index - dependent index| over tokens. Parameters: none. Reference: general dependency-complexity practice. Caveats: no L2 speech citation verified in this session.

**kolmogorov_complexity_syntax**. Unit: compression ratio. Inputs: words. Formula: compressed size of POS sequence / compressed size of shuffled POS sequence. Parameters: none. Reference: Alzahrani 2024. Caveats: language-general, no parser needed.

## Tier 3: audio-based research features

Python research layer. Needs the archived 48 kHz audio, forced alignment, or an acoustic toolkit. Appears in the research export only.

### code-switching

**korean_filler_candidates**. Unit: count and spans. Inputs: audio, phones. Formula: voiced non-word segments whose phone string matches a Korean filler list (eo, eum, geu, jeo, mwo). Parameters: fillers=["eo", "eum", "geu", "jeo", "mwo", "geunikka"]. Reference: none verified. Caveats: candidates for human confirmation.

### interaction

**laughter_and_nonspeech_events**. Unit: count and spans. Inputs: audio. Formula: audio event detection for laughter, breath, coughs. Parameters: none. Reference: none verified. Caveats: no tool validated in this session.

### prosody

**f0_range_semitones**. Unit: semitones. Inputs: audio. Formula: 12*log2(f0_p95 / f0_p05) per speaker. Parameters: tool="Praat via parselmouth". Reference: Kang 2010. Caveats: pitch survives AGC; use per-speaker channel.

**f0_sd_semitones**. Unit: semitones. Inputs: audio. Formula: sd of f0 in semitones. Parameters: none. Reference: Zhou et al. 2018; Saito et al. 2022. Caveats: none.

**f0_slope_per_utterance**. Unit: semitones per second. Inputs: audio, words. Formula: linear fit of f0 over each AS-unit. Parameters: none. Reference: Kallio et al. 2023. Caveats: none.

**intensity_variation_db**. Unit: dB. Inputs: audio. Formula: sd of intensity in voiced frames. Parameters: none. Reference: Saito et al. 2022. Caveats: transmitter AGC distorts this; prefer onboard 32-bit recording if V2b shows it bypasses AGC.

**stressed_words_per_minute**. Unit: per minute. Inputs: audio, alignment. Formula: count of syllables above pitch and intensity prominence thresholds / minutes. Parameters: none. Reference: Kormos & Dénes 2004; Kang 2010. Caveats: prominence detection needs validation.

**egemaps_feature_set**. Unit: 88 features. Inputs: audio. Formula: openSMILE eGeMAPS v02 per speaker. Parameters: tool="openSMILE". Reference: Dong et al. 2024; Dong et al. 2025. Caveats: loudness features inherit the AGC caveat.

### quality

**pause_acoustic_vs_asr_agreement**. Unit: ratio. Inputs: audio, words. Formula: overlap between energy-detected silences and ASR-timestamp gaps. Parameters: none. Reference: system. Caveats: validates the word-timestamp pause method; superseded by tier 1 asr_acoustic_pause_agreement; kept for audio-level validation.

### repair

**filled_pause_acoustic**. Unit: count. Inputs: audio. Formula: voiced segments with flat f0 and stable formants longer than 200 ms outside any word. Parameters: none. Reference: none verified. Caveats: candidate detector; validate on annotated subset.

**word_final_elongation_count**. Unit: count. Inputs: alignment. Formula: word-final segments longer than speaker mean + 2 sd for that phone. Parameters: none. Reference: none verified. Caveats: elongation can act as a filled pause.

### rhythm

**syllable_duration_sd_normalised**. Unit: ratio. Inputs: alignment. Formula: sd(syllable durations) / mean(syllable durations). Parameters: none. Reference: Kallio et al. 2023. Caveats: none.

**npvi_vocalic**. Unit: index. Inputs: alignment. Formula: normalised pairwise variability index over vocalic intervals. Parameters: none. Reference: Zhou et al. 2018; Fraser et al. 2026. Caveats: none.

**percent_v**. Unit: percent. Inputs: alignment. Formula: vocalic interval duration / total speech duration. Parameters: none. Reference: Fraser et al. 2026. Caveats: none.

**varco_v**. Unit: index. Inputs: alignment. Formula: 100 * sd(vocalic intervals) / mean(vocalic intervals). Parameters: none. Reference: Fraser et al. 2026. Caveats: none.

**vowel_reduction_ratio**. Unit: ratio. Inputs: alignment, audio. Formula: duration of unstressed vowels / duration of stressed vowels. Parameters: none. Reference: Fraser et al. 2026. Caveats: Fraser found this the strongest rhythm predictor.

### segmental

**vowel_space_area**. Unit: Hz^2 or Bark^2. Inputs: audio, alignment. Formula: area of the F1-F2 polygon over corner vowels. Parameters: none. Reference: Mairano et al. 2019. Caveats: none.

**vowel_pair_pillai_score**. Unit: 0-1. Inputs: audio, alignment. Formula: Pillai score separating F1-F2 distributions of a vowel pair (e.g. /i/-/ɪ/). Parameters: pairs=["i-ɪ", "ɛ-æ", "u-ʊ"]. Reference: Mairano et al. 2019. Caveats: intrinsic contrast measure; no native reference needed.

**vot_voiceless_stops_ms**. Unit: ms. Inputs: audio, alignment. Formula: voice onset time for /p t k/ in stressed onsets. Parameters: none. Reference: Mairano et al. 2019. Caveats: Korean has a three-way stop contrast; VOT patterns are a known L1 transfer site.

**f1_derivative_sd**. Unit: Hz per second. Inputs: audio. Formula: sd of the first derivative of the F1 track. Parameters: none. Reference: Fontan et al. 2018. Caveats: coarticulation fluidity proxy.

**gop_phone_scores**. Unit: log posterior. Inputs: audio, alignment. Formula: goodness-of-pronunciation per phone from an acoustic model. Parameters: tool="Kaldi GOP or wav2vec2-based scorer". Reference: Saito et al. 2022; Dong et al. 2025. Caveats: heaviest tooling in the inventory.

**realized_phone_sequence**. Unit: phone strings. Inputs: phones. Formula: free phone recognition per word, aligned to the CMU dictionary form. Parameters: model="facebook/wav2vec2-xlsr-53-espeak-cv-ft". Reference: Principle 4. Caveats: dictionary form is a coordinate, not a norm.

**vowel_epenthesis_rate**. Unit: per eligible context. Inputs: phones. Formula: inserted vowels after final stops or inside clusters / eligible contexts. Parameters: none. Reference: Barrass et al. 2020; de Jong et al. 2012. Caveats: variant, not error.

**nasalization_variant_rate**. Unit: per eligible context. Inputs: phones. Formula: nasal realisations of stops before nasals / eligible contexts. Parameters: none. Reference: Ha 2022; Barrass et al. 2020. Caveats: variant, not error.

**coda_stop_release_rate**. Unit: per eligible context. Inputs: audio, alignment. Formula: released word-final stops / word-final stops. Parameters: none. Reference: Ha 2022. Caveats: none.

**consonant_variant_inventory**. Unit: counts by type. Inputs: phones. Formula: counts of realisations for /f/, /v/, /θ/, /ð/, /r/, /l/, /z/ by realised phone. Parameters: none. Reference: Principle 4. Caveats: descriptive inventory per speaker.

### speed

**articulation_rate_syllables_aligned**. Unit: syllables per second of phonation time. Inputs: audio, alignment. Formula: aligned syllable count / phonation seconds. Parameters: aligner="Montreal Forced Aligner or WhisperX". Reference: Kallio et al. 2023. Caveats: replaces the dictionary estimate.

### voice

**voice_quality_hnr_jitter_shimmer**. Unit: dB, percent. Inputs: audio. Formula: Praat HNR, jitter, shimmer on sustained voiced frames. Parameters: none. Reference: none verified for L2 assessment. Caveats: unrelated to fluency; useful for speaker-state or clinical questions.

**speaking_f0_mean**. Unit: Hz. Inputs: audio. Formula: mean f0. Parameters: none. Reference: none needed. Caveats: speaker characteristic; covariate.

## Tier 4: human data

Needs people: annotation of a validation subset, stimulated recall, listener studies, or an extra task such as an L1 recording. Listed so the archive keeps what those studies need.

### breakdown

**stimulated_recall_pause_function**. Unit: coded reasons. Inputs: people. Formula: students explain selected pauses while replaying audio. Parameters: none. Reference: Kahng 2014. Caveats: validates pause_function_profile.

### interaction

**interactional_pattern_type**. Unit: category. Inputs: words. Formula: human coding: collaborative, parallel, asymmetric, blended. Parameters: none. Reference: Ortaçtepe Hart 2020. Caveats: talk_time_share and latency give a quantitative hint.

### nonverbal

**gaze_and_gesture**. Unit: coded events. Inputs: people. Formula: human coding from video. Parameters: none. Reference: Vo 2024; Eskin 2026. Caveats: no video in this system by decision 3.

### perceived

**rater_perceived_fluency**. Unit: scale. Inputs: instructor. Formula: Joe's live score and any later rater panel. Parameters: none. Reference: Suzuki et al. 2021. Caveats: stored apart from student outputs; RULING NEEDED B1.

**listener_intelligibility**. Unit: transcription accuracy by listeners. Inputs: people. Formula: listener transcription task on excerpts. Parameters: none. Reference: Barrass et al. 2020. Caveats: needs a listener study.

### speed

**l1_utterance_fluency**. Unit: same as tier 1. Inputs: people. Formula: tier 1 measures on a Korean L1 recording of the same speaker. Parameters: none. Reference: Suzuki et al. 2024. Caveats: needs an L1 task; the archive format already supports it.
