# Operational definitions for tier 1

RESEARCH_PRINCIPLES.md governs this file. Pipeline version 1.1.0 and registry version 1.1.0 follow work order 01.

features.json gives each formula in one line. This file pins down the choices the one-line formulas leave open, so the fixture script (scripts/make-fixtures.mjs) and the pipeline (lib/analysis/) compute the same number. The fixture script and the pipeline implement these rules separately. When this file changes, both change in the same commit.

## Words and tokens

A token is the word lowercased with every character except letters, digits, apostrophes, and hyphens removed. Punctuation tests use punctuatedWord.

A word is attributed when the cross-talk step keeps it. Every measure below counts attributed words only.

No step deletes a word. The pipeline returns every word it receives and sets six labels on each: removedAsCrosstalk (the other microphone's copy), inWindow (start and end inside the window), inGap (overlaps a pass-one gap), isFiller (token in config.fillerTokens), isRepetition (pruned as a repetition), and isBackchannel (classified as a backchannel). A count filters on labels; the stored transcript keeps every word with its labels.

Clause-final punctuation means a punctuatedWord that ends with a full stop, question mark, exclamation mark, comma, or semicolon.

## Window and gaps

The window runs from markers.startMs to markers.stopMs. A word belongs to the window when its start and end both fall inside it.

In pass one, a gap event (type "gap", detail.startMs and detail.endMs) removes its span from the window time, drops any word inside it, closes any turn it interrupts, and removes any pause or transition that overlaps it. Pass two ignores gap events, because the batch pass reads the whole WAV.

## Cross-talk

A match is a run of two or more consecutive tokens that appears on both channels with every paired onset within 300 ms. The copy with the earlier first onset and the higher mean confidence stays. When onset and confidence disagree, the copy with the higher mean dBFS on its own channel over the run stays. A single matching token within 300 ms is removed from the quieter channel only when the louder channel exceeds it by at least gatingMarginDb.

## Fillers, repetitions, backchannels, and pruning

A filler is a word whose token appears in config.fillerTokens.

Repetitions run inside one turn over the non-filler words. A word repetition is a token equal to the token before it. A bigram repetition is a pair of tokens equal to the pair just before it, counted only when the position is not already a word repetition. Each counts once.

A backchannel candidate is a run of words on one channel, with no partner word starting inside it, made only of tokens in config.backchannelTokens. A candidate is a backchannel only while the partner holds the floor: it falls inside a partner turn (computed without candidates), and it either overlaps a partner word or sits in a partner silence shorter than turnThresholdMs, measured from the partner's word before it to the partner's word after it. A partner silence of turnThresholdMs or more leaves the floor open, so a token there answers the partner and counts as a one-word floor turn. Every other candidate is an ordinary floor word. A backchannel-token word that opens or sits inside a speaker's own turn, such as "yeah" in "Yeah, I think that's right" or "really" in "really good", is an ordinary word.

The pruned word list removes fillers, the repeated word of each word repetition, and both words of the second pair of each bigram repetition. Backchannels never enter a turn, so they never reach the pruned list; a backchannel-token word inside a turn stays in it.

The raw word count counts every attributed word in the window, including fillers and backchannels.

Every pruned measure has a raw twin that keeps every word (RESEARCH_PRINCIPLES.md principle 2). articulation_rate_raw_wpm divides the raw word count by phonation time at each threshold. mean_length_of_run_raw averages the full word count of every run, fillers and repetitions included. mattr_raw runs MATTR over every attributed token in time order, backchannels included.

## Turns and transitions

Turns use floor words only, meaning attributed words that are not backchannels. Floor words from both channels sort by start time. A turn continues while the next floor word sits on the same channel. A floor word on the other channel closes the turn, and in pass one so does a gap event between two words. A same-channel silence of any length stays inside the turn as a pause; turnThresholdMs never splits a turn.

A long pause is a within-turn pause at or above turnThresholdMs. long_pause_count counts them per student, and each one goes into the session record as a long_pause event with its start, end, participant, and pass.

A transition is a pair of consecutive turns on different channels. Its latency is the second turn's first word start minus the first turn's last word end. A negative latency is an overlap. The latency measures for a student average or take the median over transitions into that student's turns, keeping the sign.

## Pauses, phonation, and runs

A silent pause at threshold T is a gap of at least T ms between consecutive floor words inside one turn. The gap that separates two turns is never a pause.

Phonation time at threshold T is the sum of turn durations (last word end minus first word start) minus every pause at threshold T. Backchannels add nothing to phonation.

A pause is end-clause when the word before it carries clause-final punctuation, and mid-clause otherwise.

A run is the stretch of a turn between pauses at threshold T, or between a pause and a turn edge. Mean length of run is the mean pruned word count over runs that contain at least one pruned word.

Pause rates and means by location: silent_pause_mid_clause_rate and silent_pause_end_clause_rate divide the mid-clause and end-clause pause counts at each threshold by phonation time at the same threshold, per minute. silent_pause_mid_clause_mean_ms and silent_pause_end_clause_mean_ms average the durations of those pauses, and an empty set gives null.

Acoustic pauses come from the energy frames alone. Inside each of a student's own turns, a 20 ms frame is voiced when the student's channel reaches speechFloorDbfs and is not quieter than the partner's channel by gatingMarginDb or more; every other frame is silent, which covers room noise and the partner's voice bleeding in. acoustic_pause_rate counts the student's runs of consecutive silent frames lasting at least the threshold, per minute of window time (gap time removed in pass one). asr_acoustic_pause_agreement takes the word-gap pauses at the lowest configured threshold and reports the share that acoustic silence covers for at least half their duration; it records that threshold and gives null without pauses or without energy frames.

Three features take no threshold in features.json but use phonation time: talk_time_share, filled_pause_rate, and articulation_rate_sps_est. Each uses phonation at 350 ms and records thresholdMs 350.

## Repair

uh_count and um_count count the attributed words whose token is "uh" and "um".

A filler is end-clause when no non-filler word precedes it in its turn, or when the previous non-filler word in the turn carries clause-final punctuation; otherwise it is mid-clause. filled_pause_mid_clause_count and filled_pause_end_clause_count count each kind. silence_after_filler_mean_ms averages, over every filler that is not the last word of its turn, the gap from the filler's end to the next word's start in the same turn, whatever its length.

False starts count in pass two only. A false start begins at a clause start, meaning the first non-filler word of a turn or a word whose previous non-filler word carries clause-final punctuation. It is a fragment of one to three non-filler words with no punctuation, followed directly by one or more fillers, then a restart whose first words (as many as the fragment had) share no token with the fragment.

## Interaction

Overlap intervals are the intersections of the two channels' attributed word intervals, backchannels included. Overlap count and duration describe the pair, so both students receive the same values.

A question is a turn whose last word's punctuatedWord ends with a question mark.

A backchannel count for a student counts that student's backchannel words.

## Lexical

MATTR slides a 50-token window over the pruned tokens one token at a time and averages the type-token ratios. Fewer than 50 pruned tokens gives null.

MTLD follows McCarthy and Jarvis (2010) at a type-token ratio threshold of 0.72: count a factor each time the running ratio falls to 0.72 or below and restart, add the partial factor (1 minus the final ratio) divided by 0.28, divide the token count by the factor count, and average the forward and backward passes. A factor count of zero gives null.

Target-structure hits match each pattern in config.targetPatterns, anchored at word boundaries and case-insensitive, over the student's attributed tokens joined by single spaces. Each match records the start of its first word and the end of its last.

## Composite and quality

The composite (weights version 1.1) takes z-scores against the course baseline for speech_rate_wpm, silent_pause_mid_clause_rate at 350 ms, and mean_length_of_run at 350 ms, negates the pause-rate z-score, and sums them with config.compositeWeights. The weight named silent_pause_rate in the config applies to the mid-clause rate. A baseline records the weights version it was built under; one built under another version, or with no version (which means 1.0, when the pause component was the total pause rate), gives null, and the next pass two starts a new baseline. A baseline with fewer than baselineMinSessions sessions gives null.

A 20 ms energy frame counts as speech when either channel reaches speechFloorDbfs (default -60). A speech frame is unattributed when neither channel exceeds the other by gatingMarginDb. The unattributed ratio divides unattributed speech frames by speech frames inside the window. It describes the session, so both students receive the same value.

Mean word confidence averages confidence over the student's attributed final words.

Pass agreement for speech rate is the absolute difference between the pass-one and pass-two speech rates, stored with pass two.

A rate or ratio with a zero denominator gives null. A mean or maximum over an empty set gives null.
