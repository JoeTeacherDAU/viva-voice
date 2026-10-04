# Operational definitions for tier 1

features.json gives each formula in one line. This file pins down the choices the one-line formulas leave open, so the fixture script (scripts/make-fixtures.mjs) and the pipeline (lib/analysis/) compute the same number. The fixture script and the pipeline implement these rules separately. When this file changes, both change in the same commit.

## Words and tokens

A token is the word lowercased with every character except letters, digits, apostrophes, and hyphens removed. Punctuation tests use punctuatedWord.

A word is attributed when the cross-talk step keeps it. Every measure below counts attributed words only.

Clause-final punctuation means a punctuatedWord that ends with a full stop, question mark, exclamation mark, comma, or semicolon.

## Window and gaps

The window runs from markers.startMs to markers.stopMs. A word belongs to the window when its start and end both fall inside it.

In pass one, a gap event (type "gap", detail.startMs and detail.endMs) removes its span from the window time, drops any word inside it, closes any turn it interrupts, and removes any pause or transition that overlaps it. Pass two ignores gap events, because the batch pass reads the whole WAV.

## Cross-talk

A match is a run of two or more consecutive tokens that appears on both channels with every paired onset within 300 ms. The copy with the earlier first onset and the higher mean confidence stays. When onset and confidence disagree, the copy with the higher mean dBFS on its own channel over the run stays. A single matching token within 300 ms is removed from the quieter channel only when the louder channel exceeds it by at least gatingMarginDb.

## Fillers, repetitions, backchannels, and pruning

A filler is a word whose token appears in config.fillerTokens.

Repetitions run inside one turn over the non-filler words. A word repetition is a token equal to the token before it. A bigram repetition is a pair of tokens equal to the pair just before it, counted only when the position is not already a word repetition. Each counts once.

A backchannel candidate is a run of words on one channel, with no partner word starting inside it, made only of tokens in config.backchannelTokens. A candidate is a backchannel when it falls inside a partner turn, meaning it starts at or after the partner turn's first word start and ends at or before its last word end. A candidate outside every partner turn counts as an ordinary floor word.

The pruned word list removes fillers, the repeated word of each word repetition, both words of the second pair of each bigram repetition, and every token in config.backchannelTokens.

The raw word count counts every attributed word in the window, including fillers and backchannels.

## Turns and transitions

Turns use floor words only, meaning attributed words that are not backchannels. Floor words from both channels sort by start time. A turn continues while the next floor word sits on the same channel and starts no more than turnThresholdMs after the previous word ends. A floor word on the other channel, or a gap longer than turnThresholdMs, closes the turn.

A transition is a pair of consecutive turns on different channels. Its latency is the second turn's first word start minus the first turn's last word end. A negative latency is an overlap. The latency measures for a student average or take the median over transitions into that student's turns, keeping the sign.

## Pauses, phonation, and runs

A silent pause at threshold T is a gap of at least T ms between consecutive floor words inside one turn. The gap that separates two turns is never a pause.

Phonation time at threshold T is the sum of turn durations (last word end minus first word start) minus every pause at threshold T. Backchannels add nothing to phonation.

A pause is end-clause when the word before it carries clause-final punctuation, and mid-clause otherwise.

A run is the stretch of a turn between pauses at threshold T, or between a pause and a turn edge. Mean length of run is the mean pruned word count over runs that contain at least one pruned word.

Three features take no threshold in features.json but use phonation time: talk_time_share, filled_pause_rate, and articulation_rate_sps_est. Each uses phonation at 350 ms and records thresholdMs 350.

## Repair

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

The composite takes z-scores against the course baseline for speech_rate_wpm, silent_pause_rate at 350 ms, and mean_length_of_run at 350 ms, negates the pause-rate z-score, and sums them with config.compositeWeights. A baseline with fewer than baselineMinSessions sessions gives null.

A 20 ms energy frame counts as speech when either channel reaches speechFloorDbfs (default -60). A speech frame is unattributed when neither channel exceeds the other by gatingMarginDb. The unattributed ratio divides unattributed speech frames by speech frames inside the window. It describes the session, so both students receive the same value.

Mean word confidence averages confidence over the student's attributed final words.

Pass agreement for speech rate is the absolute difference between the pass-one and pass-two speech rates, stored with pass two.

A rate or ratio with a zero denominator gives null. A mean or maximum over an empty set gives null.
