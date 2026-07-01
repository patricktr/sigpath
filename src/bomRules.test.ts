import { describe, it, expect } from "vitest";
import {
  roundUpToStockMeters,
  computeSpares,
  computeCableBom,
  skuName,
  DEFAULT_SPARE_RULE,
  type SpareRule,
  type CableRun,
} from "./bomRules";

const M_PER_FT = 0.3048;
const rule = (over: Partial<SpareRule>): SpareRule => ({ ...DEFAULT_SPARE_RULE, ...over });

describe("bomRules — stock rounding (p3-bomrules)", () => {
  it("rounds a run up to the nearest metric rung", () => {
    expect(roundUpToStockMeters(1.5, "metric")).toBe(2); // 1.5 → 2 m
    expect(roundUpToStockMeters(2, "metric")).toBe(2); // exact rung stays
    expect(roundUpToStockMeters(3.1, "metric")).toBe(5); // 3.1 → 5 m
  });

  it("rounds a run up to the nearest imperial rung (returned in meters)", () => {
    expect(roundUpToStockMeters(5 * M_PER_FT, "imperial")).toBeCloseTo(6 * M_PER_FT, 6); // 5 ft → 6 ft
    expect(roundUpToStockMeters(6 * M_PER_FT, "imperial")).toBeCloseTo(6 * M_PER_FT, 6);
  });
});

describe("bomRules — spare math", () => {
  it("flat + ratio + percent add, min is a floor", () => {
    expect(computeSpares(6, rule({ percent: 10 }))).toBe(1); // ceil(0.6)
    expect(computeSpares(6, rule({ ratioPerN: 8 }))).toBe(0); // floor(6/8)
    expect(computeSpares(1, rule({ minSpares: 1 }))).toBe(1); // floor kicks in
    expect(computeSpares(20, rule({ ratioPerN: 8, percent: 10 }))).toBe(4); // floor(2.5)=2 + ceil(2)=2
    expect(computeSpares(0, rule({ minSpares: 3 }))).toBe(0); // no base, no spares
  });
});

describe("bomRules — SKU grouping", () => {
  const runs: CableRun[] = [
    { connector: "sdi", grade: "sdi-3g", lengthMeters: 1.5 }, // → 2 m
    { connector: "sdi", grade: "sdi-3g", lengthMeters: 2.0 }, // → 2 m (same SKU)
    { connector: "sdi", grade: "sdi-3g", lengthMeters: 4.0 }, // → 5 m (different SKU)
    { connector: "sdi" }, // ungraded, no length → its own SKU
    { connector: "hdmi", lengthMeters: 1.5 }, // → 2 m
  ];

  it("groups by connector + grade + stock length and counts base", () => {
    const bom = computeCableBom(runs, () => DEFAULT_SPARE_RULE, "metric");
    const line = (name: string) => bom.find((l) => skuName(l.sku, "metric") === name);
    expect(line("3G-SDI · 2 m")?.base).toBe(2);
    expect(line("3G-SDI · 5 m")?.base).toBe(1);
    expect(line("HDMI · 2 m")?.base).toBe(1);
    expect(line("BNC (SDI)")?.base).toBe(1); // ungraded, unspecified length
  });

  it("applies the spare rule per SKU line", () => {
    const bom = computeCableBom(runs, () => rule({ minSpares: 1 }), "metric");
    const sdi2 = bom.find((l) => skuName(l.sku, "metric") === "3G-SDI · 2 m")!;
    expect(sdi2.base).toBe(2);
    expect(sdi2.spares).toBe(1);
    expect(sdi2.order).toBe(3);
  });
});
