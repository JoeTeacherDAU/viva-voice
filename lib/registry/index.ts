import raw from "./features.json";
import { validateRegistry } from "./validate";
import type { Construct, FeatureDef, Registry, Tier } from "./types";

export type { Construct, FeatureDef, FeatureInput, Registry, Tier } from "./types";
export { RegistryError, validateRegistry } from "./validate";

// Validation runs when the module loads, so `next build` fails on a malformed registry.
export const registry: Registry = validateRegistry(raw);

const byId = new Map(registry.features.map((f) => [f.id, f]));

export function get(id: string): FeatureDef {
  const f = byId.get(id);
  if (!f) throw new Error(`No feature with id ${id} in the registry`);
  return f;
}

export function has(id: string): boolean {
  return byId.has(id);
}

export function byTier(tier: Tier): FeatureDef[] {
  return registry.features.filter((f) => f.tier === tier);
}

export function byConstruct(construct: Construct): FeatureDef[] {
  return registry.features.filter((f) => f.construct === construct);
}

/** Pause thresholds a feature runs at, or null when it takes none. */
export function thresholdsFor(id: string): number[] | null {
  const t = get(id).params.pauseThresholdMs;
  return Array.isArray(t) ? (t as number[]) : null;
}
