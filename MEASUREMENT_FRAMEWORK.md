# Viva Voice: measurement framework

What the system measures, why each measure earns a place, and how the numbers support a judgement of conversational fluency. Version 1.0, 2026-10-04. This file governs `features.json`; when the two disagree, fix `features.json`.

## 1. The construct

Fluency in second language research splits into three senses (Segalowitz, 2010, as applied by Suzuki et al., 2021 and Gao et al., 2025):

Utterance fluency is what a recording contains: how fast a speaker talks, where and how long they pause, and how often they repair. A machine can measure it.

Perceived fluency is a listener's judgement. Raters produce it. Viva Voice never produces it.

Cognitive fluency is the efficiency of the speaker's planning and retrieval. Nobody measures it from a recording.

Viva Voice measures utterance fluency and reports it as evidence. Joe judges perceived fluency and assigns the grade. The composite index on the live display is a utterance-fluency summary, calibrated against a cohort, and the plan treats it as a pointer to what Joe should listen for, never as a score.

## 2. Why these measures predict what a rater hears

Suzuki, Kormos, and Uchihara (2021) meta-analysed 263 effect sizes from 22 studies. Perceived fluency correlated strongly with speed and pause frequency (r between .59 and .62), moderately with pause duration (r = .46), and weakly with repair (r = .20). Composite measures correlated most strongly (r between .72 and .76). So the live index combines speed and pause frequency and leaves repair out.

Gao and Sun (2025) tested 136 Chinese university learners in monologic and dialogic tasks. In dialogue, breakdown fluency (pausing) alone predicted perceived fluency, and speed and repair lost their predictive power. A temporal measure of turn-taking did not predict fluency ratings. So the composite weights pausing above speed in a paired conversation, and turn-taking measures describe participation and never enter the index.

Gao, Sun, and Li (2025) tested silent-pause thresholds from 100 to 1000 ms. For dialogic speaking, 200 ms best predicted proficiency and 350 ms best predicted perceived fluency. The system computes every pause measure at both thresholds and labels each value with its threshold.

Kormos and Dénes (2004) found speech rate, mean length of run, and phonation-time ratio predicted teacher fluency scores, and pause counts did not. Préfontaine, Kormos, and Johnson (2016) found mean length of run and articulation rate predicted ratings in French. Mean length of run goes into the index for both reasons.

Matsuura et al. (2022) built an automated fluency scorer for L2 dialogue and found that pruning disfluency words and classifying pauses by syntactic location raised agreement with human raters, and that dialogue-level scoring beat turn-level scoring. The pipeline therefore computes a pruned word count (fillers and repetitions removed) alongside the raw count, and classifies pauses by boundary location.

Takizawa et al. (2025) found that multiword sequence use explained a small, significant share of fluency ratings with utterance fluency held constant in the model. Bigram proportion belongs to tier 2 of FEATURE_INVENTORY.md.

Fraser et al. (2026) found rhythm measures and fluency measures predicted comprehensibility independently, and vowel reduction ratios predicted ratings better than durational variability metrics. Rhythm belongs to tier 3, because it needs audio analysis the TypeScript layer does not do.

## 3. What a paired task adds

May (2011), Galaczi (2014), and Borger (2019) studied raters of paired speaking tests. Raters attended to topic development, turn-taking management, and interactive listening (backchannels, confirmations, follow-up questions). Galaczi found that these features separated proficiency levels. Ortaçtepe Hart (2020) found that low-high pairs produced asymmetric interaction in which the stronger student dominated, which matches Joe's concern about a strong student losing points for a weak partner. Roever and Kasper (2018) argued that interactional competence belongs in the speaking construct and that an examiner can induce a disfluency that looks like a deficit.

Viva Voice measures the parts of interaction a two-channel recording shows: turn count, turn length, talk-time share, response latency, overlap, backchannel tokens, and question count. It reports them as participation evidence. Vo (2024) found nonverbal communication predicted interactional competence scores in paired tasks, and audio captures none of it. Joe is in the room and sees it.

## 4. Measures, by tier

Tier 1 ships in the app and appears in the DOCX. Tier 2 runs in the Python research layer from the archive. Tier 3 needs audio analysis or forced alignment. FEATURE_INVENTORY.md lists every feature with its formula and reference; this section explains the tier 1 set.

### 4.1 Speed

Speech rate: pruned words per minute of window time. Window time includes silence.

Articulation rate: pruned words per minute of phonation time. Phonation time excludes silent pauses at or above the threshold. Pass two also reports an estimated syllables-per-second figure from a dictionary lookup, because the research literature reports syllables.

Phonation-time ratio: phonation time divided by window time.

### 4.2 Breakdown (pausing)

Silent pause: a gap between one word's end and the next word's start on the same channel, at or above the threshold, inside one speaker's turn. A gap that spans a turn change is response latency and never counts as a pause.

Silent pause rate: pauses per minute of phonation time, at 200 ms and at 350 ms.

Mean and maximum silent pause duration, at both thresholds.

Mid-clause and end-clause pause counts, classified by punctuation boundary in pass one and two, with the boundary method recorded. Gao et al. (2025) classified by AS-unit; the research layer adds that.

Mean length of run: mean pruned word count between consecutive pauses at the threshold.

### 4.3 Repair

Filled pause count: `uh` and `um` from Deepgram's `filler_words=true` output, plus any token in the configured `fillerTokens` list.

Repetition count: an immediately repeated word or bigram.

False start count: a word sequence of one to three words followed by a restart that shares no token, before a punctuation boundary. Pass two only, because interims make this unstable.

Repair measures stay out of the index. Suzuki et al. (2021) report r = .20.

### 4.4 Interaction

Turn: a contiguous run of attributed words on one channel, closed by the other channel's attributed speech or by silence longer than `turnThresholdMs`.

Turn count, mean turn length in pruned words, talk-time share (this student's phonation time over both students' phonation time), response latency (partner's last word end to this student's first word start, per transition), overlap count and overlap duration (both channels attributed at once), backchannel count (Deepgram's five backchannel tokens plus a configured list, when they occur inside the partner's turn), and question count (turns ending in `?`).

### 4.5 Lexical

Moving-average type-token ratio over a 50-token window, because Kyle et al. (2023) found optimised MATTR and MTLD reliable across text lengths in L2 oral data where raw TTR and D were not. MTLD as a second index.

Target-structure hits: count and spans of matches against the unit's `targetPatterns`, final words only.

### 4.6 Composite index

Inputs: speech rate, silent pause rate at 350 ms, mean length of run at 350 ms. Each standardised against the cohort baseline (mean and standard deviation of the stored sessions for the same course). Pause rate inverted so a higher index reads as more fluent. Default weights: pause rate 0.5, speech rate 0.25, mean length of run 0.25, following Gao and Sun (2025) for dialogue. Below `baselineMinSessions` sessions the index does not exist, and the slot shows the three raw components. The weighting version and the baseline session count go into every record.

## 5. From numbers to a judgement

The DOCX gives Joe and Markomatic the transcript and the student's numbers with thresholds. The intended reading order:

1. Read the session log. A gap event, a high unattributed-frame count, or a fault means the numbers need checking against the audio.
2. Read talk-time share and turn count. These describe who held the floor. Ortaçtepe Hart (2020) shows that an asymmetric pair depresses the weaker student's opportunity, so a low share with a high response latency on the partner's side reads differently from a low share with long partner turns.
3. Read the pause measures at 350 ms. Gao and Sun (2025) found these carry the fluency signal in dialogue.
4. Read speed and mean length of run. They refine the pause reading.
5. Read repair counts as feedback material, never as a fluency deduction.
6. Read lexical range and target-structure hits against the unit's goals.

Markomatic receives the same document and applies the course rubric. Joe reads both and assigns the grade.

## 6. Validity limits

The system measures delivery and utterance fluency. It produces no pronunciation score, no grammatical accuracy score, and no holistic band. Wang et al. (2026) meta-analysed 67 automated speech evaluation studies and found human-machine correlation highest for delivery (r = .784) and fluency (r = .618) and lowest for grammar and vocabulary (r = .499).

Recognition error on L2 speech runs high and uneven. Yu (2026) reported a median word error rate near .232 on 627 L2 English recordings with differences across speaker groups. Bailey et al. (2025) frame that pattern as a fairness problem. Every measurement keeps its transcript and its audio so a human can check it. Qiao et al. (2021) found that ASR error affects complexity measures unevenly by measure type, which is why tier 2 features record the transcript source.

A paired conversation is co-constructed. May (2011) notes that raters saw some features as mutual achievements. Talk-time share and latency describe the pair as much as the person. The document reports them with the partner's identity removed and the partner's numbers absent.

## References

Bailey, A. L., et al. (2025). Addressing bias in spoken language systems. Journal of Educational Measurement. https://consensus.app/papers/details/662db19eb3545ac5ac842dd93acf769d/

Borger, L. (2019). Assessing interactional skills in a paired speaking test. Apples: Journal of Applied Language Studies. https://consensus.app/papers/details/40b4d4bc0d2052caa2774b62720e4842/

Fraser, K., et al. (2026). Examining the relationship between speech rhythm, fluency measures and comprehensibility ratings in L2 English speech. Journal of Second Language Pronunciation. https://consensus.app/papers/details/bed2e15e158a5fddb5c3dc248c9d46a9/

Galaczi, E. (2014). Interactional competence across proficiency levels: How do learners manage interaction in paired speaking tests? Applied Linguistics. https://consensus.app/papers/details/3cb6cee78fdd5904b7fb48f9fdb12b54/

Gao, J., & Sun, P. P. (2025). Unveiling the relationship between L2 utterance fluency and perceived fluency in monologic and dialogic speaking. Language and Speech. https://doi.org/10.1177/00238309251352105

Gao, J., Sun, P. P., & Li, C. (2025). Exploring the optimal thresholds of silent pauses for measuring second language utterance fluency in monologic and dialogic speaking. Language Testing, 42(3), 283–311. https://doi.org/10.1177/02655322251315792

Kormos, J., & Dénes, M. (2004). Exploring measures and perceptions of fluency in the speech of second language learners. System, 32(2), 145–164.

Kyle, K., et al. (2023). Evaluating evidence for the reliability and validity of lexical diversity indices in L2 oral task responses. Studies in Second Language Acquisition. https://consensus.app/papers/details/3ccab01a75db5ec2a43584d0fe62aaac/

Matsuura, R., et al. (2022). Refinement of utterance fluency feature extraction and automated scoring of L2 oral fluency with dialogic features. APSIPA ASC 2022. https://consensus.app/papers/details/6465447dfb6e5f43a32f0e8cf12d1d53/

May, L. (2011). Interactional competence in a paired speaking test: Features salient to raters. Language Assessment Quarterly. https://consensus.app/papers/details/bdf660f5ccc55ef59c014323a8261759/

Ortaçtepe Hart, D. (2020). Interactional competence in paired speaking tests: A study on proficiency-based pairings. System. https://consensus.app/papers/details/0c9d85996bea5600beed2c4711479c57/

Préfontaine, Y., Kormos, J., & Johnson, D. E. (2016). How do utterance measures predict raters' perceptions of fluency in French as a second language? Language Testing. https://consensus.app/papers/details/46b09aa242a45a54997f44c68ae446b7/

Qiao, Y., et al. (2021). The impact of ASR on the automatic analysis of linguistic complexity and sophistication in spontaneous L2 speech. arXiv. https://consensus.app/papers/details/defea2c7c4f15bd0a7bd49593cc9c734/

Roever, C., & Kasper, G. (2018). Speaking in turns and sequences: Interactional competence as a target construct in testing speaking. Language Testing. https://consensus.app/papers/details/b834b843cb6f5b7bb0c07a44127ca702/

Suzuki, S., Kormos, J., & Uchihara, T. (2021). The relationship between utterance and perceived fluency: A meta-analysis of correlational studies. The Modern Language Journal, 105(2), 435–463. https://doi.org/10.1111/modl.12706

Takizawa, K., et al. (2025). The role of multiword sequences in fluent speech. Studies in Second Language Acquisition. https://consensus.app/papers/details/d43e8941bfce58c085b220d63051be89/

Vo, S. (2024). Exploring the construct of interactional competence in different types of oral communication assessment. Interaction Studies. https://consensus.app/papers/details/ed92e20d7394518199be050e270909bb/

Wang, X., et al. (2026). The human-machine correlation in automated speech evaluation: A three-level meta-analysis. Language Testing. https://consensus.app/papers/details/a441398042fe518c8e9c8cc09d053a3b/

Yu, X. (2026). An AI-based spoken English evaluation system using speech recognition technology. https://consensus.app/papers/details/7e04c2fcf93157e098627474bff0fab7/

Note on verification. I confirmed DOIs for Suzuki et al. (2021), Gao, Sun, and Li (2025), and Gao and Sun (2025) in the earlier session. Every other entry gives the Consensus record URL I read on 2026-10-04. Segalowitz (2010) appears only as the source of the three-way fluency distinction, as cited by Suzuki et al. and Gao et al.; I did not open it in this session.
