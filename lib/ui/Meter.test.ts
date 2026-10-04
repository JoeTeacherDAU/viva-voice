import { describe, expect, it } from "vitest";
import { meterPercent } from "./Meter";

describe("meterPercent", () => {
  it("maps the floor to 0 and 0 dBFS to 100", () => {
    expect(meterPercent(-60)).toBe(0);
    expect(meterPercent(0)).toBe(100);
    expect(meterPercent(-30)).toBe(50);
  });
  it("clamps out-of-range and non-finite levels", () => {
    expect(meterPercent(-100)).toBe(0);
    expect(meterPercent(6)).toBe(100);
    expect(meterPercent(-Infinity)).toBe(0);
  });
});
