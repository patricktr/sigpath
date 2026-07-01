import { cableColor, cableLabel, gradeLabel } from "./schema";
import type { GradeId } from "./schema";
import { fromMeters, distanceSuffix, type DistanceUnit } from "./units";

/**
 * Custom BOM / packlist rules — spares & overage (p3-bomrules). The cable BOM is
 * grouped into orderable SKUs (connector + grade + stock length) and each line
 * gets a spare/overage contribution so the count you order isn't the raw run
 * count. Pure — the rule is project state; this module just does the math.
 */
export type SpareRule = {
  /** Round each run's length up to the nearest stock length (creates the length dimension). */
  roundToStock: boolean;
  /** Floor: at least this many spares per line. */
  minSpares: number;
  /** Add a fixed number of spares per line. */
  flatSpares: number;
  /** +1 spare per N units (0 = off). */
  ratioPerN: number;
  /** +X% overage, rounded up (0 = off). */
  percent: number;
};

/** No spares, round-to-stock on — the neutral default that just buckets runs by stock length. */
export const DEFAULT_SPARE_RULE: SpareRule = {
  roundToStock: true,
  minSpares: 0,
  flatSpares: 0,
  ratioPerN: 0,
  percent: 0,
};

const M_PER_FT = 0.3048;
/** Stock ladders in the display unit. Beyond the top rung, ceil to the next whole unit.
 *  A user-editable ladder is later polish; these are sensible defaults. */
const STOCK_LADDER: Record<DistanceUnit, number[]> = {
  imperial: [1, 3, 6, 10, 15, 25, 35, 50, 75, 100], // feet
  metric: [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50], // meters
};

/** Round a run length (meters) UP to the nearest stock length, returned in meters. */
export function roundUpToStockMeters(meters: number, unit: DistanceUnit): number {
  const perUnit = unit === "imperial" ? M_PER_FT : 1;
  const value = meters / perUnit; // length in the display unit
  const ladder = STOCK_LADDER[unit];
  const rung = ladder.find((r) => r >= value - 1e-9) ?? Math.ceil(value - 1e-9);
  return rung * perUnit;
}

/** An orderable cable line: connector + (grade) + (stock length). */
export type CableSku = {
  key: string;
  connector: string;
  label: string;
  color: string;
  grade?: GradeId;
  gradeLabel?: string;
  /** Stock length in meters; undefined ⇒ length unspecified (no length recorded). */
  stockLenM?: number;
};

/** One straight cable run feeding the BOM. */
export type CableRun = { connector: string; grade?: GradeId; lengthMeters?: number };

/** A BOM line: an SKU with the measured count, computed spares, and total to order. */
export type BomLine = { sku: CableSku; base: number; spares: number; order: number };

/** Spares for a line of `base` units under `rule`. Flat + ratio + percent add; min is a floor. */
export function computeSpares(base: number, rule: SpareRule): number {
  if (base <= 0) return 0;
  let extra = rule.flatSpares;
  if (rule.ratioPerN > 0) extra += Math.floor(base / rule.ratioPerN);
  if (rule.percent > 0) extra += Math.ceil((base * rule.percent) / 100);
  return Math.max(extra, rule.minSpares);
}

/**
 * Group straight runs into SKU lines and apply the spare rule. `ruleFor` resolves the
 * effective rule per connector (project default + per-type overrides, p3-bomrules Phase C);
 * pass a constant function for a single project-wide rule.
 */
export function computeCableBom(
  runs: CableRun[],
  ruleFor: (connector: string) => SpareRule,
  unit: DistanceUnit,
): BomLine[] {
  const byKey = new Map<string, { sku: CableSku; base: number }>();
  for (const run of runs) {
    const rule = ruleFor(run.connector);
    const stockLenM =
      rule.roundToStock && run.lengthMeters != null && run.lengthMeters > 0
        ? roundUpToStockMeters(run.lengthMeters, unit)
        : undefined;
    const key = `${run.connector}|${run.grade ?? ""}|${stockLenM ?? ""}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.base += 1;
    } else {
      byKey.set(key, {
        base: 1,
        sku: {
          key,
          connector: run.connector,
          label: cableLabel(run.connector),
          color: cableColor(run.connector),
          grade: run.grade,
          gradeLabel: run.grade ? gradeLabel(run.grade) : undefined,
          stockLenM,
        },
      });
    }
  }
  return [...byKey.values()]
    .map(({ sku, base }) => {
      const spares = computeSpares(base, ruleFor(sku.connector));
      return { sku, base, spares, order: base + spares };
    })
    .sort(
      (a, b) =>
        a.sku.label.localeCompare(b.sku.label) || (a.sku.stockLenM ?? 0) - (b.sku.stockLenM ?? 0),
    );
}

/** Human SKU name, e.g. "3G-SDI · 6 ft" or "HDMI · 10 ft" (unit-aware). */
export function skuName(sku: CableSku, unit: DistanceUnit): string {
  const head = sku.gradeLabel || sku.label;
  return sku.stockLenM != null
    ? `${head} · ${fromMeters(sku.stockLenM, unit)} ${distanceSuffix(unit)}`
    : head;
}
