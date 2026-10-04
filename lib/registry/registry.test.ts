import { describe, expect, it } from "vitest";
import raw from "./features.json";
import {
  byConstruct,
  byTier,
  get,
  registry,
  RegistryError,
  thresholdsFor,
  validateRegistry,
} from ".";

const clone = () => JSON.parse(JSON.stringify(raw));

describe("registry loader", () => {
  it("loads the committed features.json", () => {
    expect(registry.registryVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(byTier(1).length).toBeGreaterThan(20);
  });

  it("returns typed accessors", () => {
    expect(get("speech_rate_wpm").construct).toBe("speed");
    expect(byConstruct("composite").map((f) => f.id)).toEqual(["composite_fluency_index"]);
    expect(thresholdsFor("silent_pause_rate")).toEqual([200, 350]);
    expect(thresholdsFor("turn_count")).toBeNull();
    expect(() => get("no_such_feature")).toThrow();
  });

  it("rejects a feature with a missing field", () => {
    const bad = clone();
    delete bad.features[0].formula;
    expect(() => validateRegistry(bad)).toThrow(RegistryError);
  });

  it("rejects an unknown construct and a bad tier", () => {
    const bad = clone();
    bad.features[0].construct = "vibes";
    expect(() => validateRegistry(bad)).toThrow(/construct|allowed/);
    const bad2 = clone();
    bad2.features[0].tier = 7;
    expect(() => validateRegistry(bad2)).toThrow(RegistryError);
  });

  it("rejects an extra property and a repeated id", () => {
    const bad = clone();
    bad.features[0].colour = "red";
    expect(() => validateRegistry(bad)).toThrow(RegistryError);
    const dup = clone();
    dup.features.push({ ...dup.features[0] });
    expect(() => validateRegistry(dup)).toThrow(/repeats/);
  });

  it("rejects a file that is not a registry at all", () => {
    expect(() => validateRegistry({ features: "nope" })).toThrow(RegistryError);
    expect(() => validateRegistry(null)).toThrow(RegistryError);
  });
});
