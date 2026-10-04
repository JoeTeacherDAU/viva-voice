export type Tier = 1 | 2 | 3 | 4;

export type Construct =
  | "speed"
  | "breakdown"
  | "repair"
  | "interaction"
  | "lexical"
  | "composite"
  | "quality"
  | "syntax"
  | "morphology"
  | "pragmatics"
  | "code-switching"
  | "rhythm"
  | "prosody"
  | "segmental"
  | "voice"
  | "nonverbal"
  | "perceived";

export type FeatureInput = "words" | "energy" | "audio" | "alignment" | "roster" | "instructor";

export interface FeatureDef {
  id: string;
  tier: Tier;
  construct: Construct;
  unit: string;
  inputs: FeatureInput[];
  formula: string;
  params: Record<string, unknown>;
  reference: string;
  caveats: string[];
}

export interface Registry {
  registryVersion: string;
  generated: string;
  tiers: Record<string, string>;
  inputs: Record<string, string>;
  features: FeatureDef[];
}
