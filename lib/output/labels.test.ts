import { describe, expect, it } from "vitest";
import { byTier, registry } from "@/lib/registry";
import { BANNED_WORDS, bannedWordsIn, DISPLAY_LABELS, SECTIONS } from "./labels";

describe("descriptive labels (work order 01, section 5)", () => {
  it("gives every tier 1 feature a plain label and a section", () => {
    for (const f of byTier(1)) {
      expect(DISPLAY_LABELS[f.id], f.id).toBeTruthy();
      expect(
        SECTIONS.some((s) => s.constructs.includes(f.construct)),
        f.id,
      ).toBe(true);
    }
    expect(new Set(Object.values(DISPLAY_LABELS)).size).toBe(Object.keys(DISPLAY_LABELS).length);
  });

  it("keeps every label, section title, and section opening free of banned words", () => {
    const text = [
      ...Object.values(DISPLAY_LABELS),
      ...SECTIONS.flatMap((s) => [s.title, s.intro]),
    ].join("\n");
    expect(bannedWordsIn(text)).toEqual([]);
    // The jargon construct names stay out of section titles ("speed" is plain English).
    const titles = SECTIONS.map((s) => s.title.toLowerCase()).join(" ");
    for (const c of ["breakdown", "repair", "composite"]) expect(titles).not.toContain(c);
    expect(registry.features.some((f) => f.construct === "breakdown")).toBe(true);
  });

  it("detects banned words as whole words only", () => {
    expect(bannedWordsIn("An Error here and a Breakdown there")).toEqual(["error", "breakdown"]);
    expect(bannedWordsIn("errorless? no: weakness is a different word")).toEqual([]);
    expect(BANNED_WORDS).toContain("native-like");
    expect(bannedWordsIn("very native-like")).toEqual(["native-like"]);
  });
});
