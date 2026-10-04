import type { Construct } from "@/lib/registry";

/**
 * Words no student-facing or instructor-facing view may contain
 * (RESEARCH_PRINCIPLES.md principle 4; work order 01, section 5).
 */
export const BANNED_WORDS = [
  "error",
  "deficit",
  "accuracy",
  "accent",
  "nativelike",
  "native-like",
  "breakdown",
  "interference",
  "disfluency",
  "weak",
  "poor",
] as const;

/** Returns each banned word that appears in the text as a whole word, ignoring case. */
export function bannedWordsIn(text: string): string[] {
  return BANNED_WORDS.filter((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(text));
}

/**
 * Plain descriptions for every tier 1 feature. The registry id stays the id in
 * code, CSV, and tests; these are what people read.
 */
export const DISPLAY_LABELS: Record<string, string> = {
  speech_rate_wpm: "Words per minute, without fillers or repeated words",
  speech_rate_raw_wpm: "Words per minute, every word counted",
  articulation_rate_wpm: "Words per minute of speaking time, without fillers or repeated words",
  articulation_rate_raw_wpm: "Words per minute of speaking time, every word counted",
  articulation_rate_sps_est: "Syllables per second of speaking time (dictionary estimate)",
  phonation_time_ratio: "Share of the conversation spent speaking",
  silent_pause_rate: "Silent pauses per minute of speaking time",
  silent_pause_mean_ms: "Average silent pause length",
  silent_pause_max_ms: "Longest silent pause",
  silent_pause_mid_clause_count: "Silent pauses inside a sentence",
  silent_pause_end_clause_count: "Silent pauses at a sentence or clause boundary",
  silent_pause_mid_clause_rate: "Silent pauses inside a sentence, per minute of speaking time",
  silent_pause_end_clause_rate: "Silent pauses at a boundary, per minute of speaking time",
  silent_pause_mid_clause_mean_ms: "Average length of pauses inside a sentence",
  silent_pause_end_clause_mean_ms: "Average length of pauses at a boundary",
  long_pause_count: "Long pauses within a turn",
  mean_length_of_run: "Average words between pauses, without fillers or repeated words",
  mean_length_of_run_raw: "Average words between pauses, every word counted",
  acoustic_pause_rate: "Silences per minute, measured from the audio signal",
  filled_pause_count: "Fillers such as uh and um",
  filled_pause_rate: "Fillers per minute of speaking time",
  uh_count: "Times you said uh",
  um_count: "Times you said um",
  filled_pause_mid_clause_count: "Fillers inside a sentence",
  filled_pause_end_clause_count: "Fillers at a boundary or at the start of a turn",
  silence_after_filler_mean_ms: "Average silence after a filler",
  repetition_count: "Repeated words or word pairs",
  false_start_count: "Restarted sentences",
  turn_count: "Turns",
  mean_turn_length_words: "Average words per turn",
  talk_time_share: "Share of the pair's speaking time",
  response_latency_mean_ms: "Average wait before starting a turn after your partner",
  response_latency_median_ms: "Typical (median) wait before starting a turn after your partner",
  overlap_count: "Moments when both of you spoke at once",
  overlap_duration_ms: "Total time both of you spoke at once",
  backchannel_count: "Short listening responses (such as mhmm) during your partner's turns",
  question_count: "Turns that ended in a question",
  open_floor_response_count:
    "Short responses (such as okay) given after your partner had stopped talking",
  mattr: "Variety of words (MATTR), without fillers or repeated words",
  mattr_raw: "Variety of words (MATTR), every word counted",
  mtld: "Variety of words (MTLD)",
  target_structure_hits: "Uses of this unit's target expressions",
  composite_fluency_index: "Speed and pausing index, relative to this class",
  unattributed_frame_ratio: "Share of speech the system could not assign to one microphone",
  crosstalk_removed_words: "Partner's words picked up by your microphone and set aside",
  mean_word_confidence: "Average transcription confidence",
  pass_agreement_speech_rate:
    "Difference in words per minute between the live and final transcripts",
  asr_acoustic_pause_agreement: "Share of pauses that the audio signal confirms",
};

/** Document sections, in order, with the sentence that opens each one. */
export const SECTIONS: { constructs: Construct[]; title: string; intro: string }[] = [
  {
    constructs: ["speed"],
    title: "Speed",
    intro: "These numbers count the words you said and how much of the time you spent speaking.",
  },
  {
    constructs: ["breakdown"],
    title: "Pauses",
    intro:
      "These numbers count the silences inside your turns: how often they came, how long they lasted, and where in a sentence they fell.",
  },
  {
    constructs: ["repair"],
    title: "Fillers, repetitions, and restarts",
    intro:
      "These numbers count words such as uh and um, repeated words, and restarted sentences in your turns, and the silence after each filler.",
  },
  {
    constructs: ["interaction"],
    title: "Conversation",
    intro:
      "These numbers count how you and your partner shared the conversation: turns, timing, questions, and listening responses.",
  },
  {
    constructs: ["lexical"],
    title: "Vocabulary",
    intro:
      "These numbers count how varied your words were and how often you used this unit's target expressions.",
  },
  {
    constructs: ["composite"],
    title: "Speed and pausing index, relative to this class",
    intro:
      "This number combines your speaking speed, your pauses inside sentences, and your words between pauses, compared with other students in this class.",
  },
  {
    constructs: ["quality"],
    title: "Recording",
    intro:
      "These numbers describe how clearly the system heard you, so you can judge the numbers above.",
  },
];

export function displayLabel(id: string): string {
  return DISPLAY_LABELS[id] ?? id;
}
