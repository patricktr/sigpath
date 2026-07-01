import { describe, it, expect } from "vitest";
import { distanceSuffix, fromMeters, toMeters, formatLength } from "./units";

describe("units — distance conversion", () => {
  it("metric is an identity (rounded to 0.1)", () => {
    expect(fromMeters(12.5, "metric")).toBe(12.5);
    expect(toMeters(12.5, "metric")).toBe(12.5);
    expect(fromMeters(12.34, "metric")).toBe(12.3);
  });

  it("imperial converts meters ↔ feet", () => {
    expect(fromMeters(12.192, "imperial")).toBe(40); // 40 ft exactly
    expect(toMeters(40, "imperial")).toBeCloseTo(12.192, 5);
    expect(fromMeters(1, "imperial")).toBe(3.3); // 3.2808 → 3.3
  });

  it("suffix + formatting match the unit", () => {
    expect(distanceSuffix("metric")).toBe("m");
    expect(distanceSuffix("imperial")).toBe("ft");
    expect(formatLength(12.5, "metric")).toBe("12.5 m");
    expect(formatLength(12.192, "imperial")).toBe("40 ft");
  });

  it("entry round-trips stably (what the inspector input relies on)", () => {
    // A value typed in the display unit, stored as meters, re-displayed, is unchanged.
    for (const typed of [5, 10, 25, 40.5, 100]) {
      const stored = toMeters(Math.round(typed * 10) / 10, "imperial");
      expect(fromMeters(stored, "imperial")).toBe(typed);
    }
  });
});
