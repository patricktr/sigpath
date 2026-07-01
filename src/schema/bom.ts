/**
 * BOM spare/overage rules (p3-bomrules) — persisted project state. The math and the
 * SKU grouping live in src/bomRules.ts; the persisted *shape* lives here in the schema
 * so {@link Project} can carry it and it round-trips through serialize.
 */

/** How many spares/overage to add per BOM line, and whether to round runs to stock lengths.
 *  flat + ratio + percent add; min is a floor. */
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

/** Project BOM policy: a default rule plus optional per-connector overrides (p3-bomrules). */
export type BomRules = {
  default: SpareRule;
  /** Per-connector override, keyed by connector id (e.g. "sdi"). Absent ⇒ use the default. */
  byType?: Record<string, SpareRule>;
};

export const DEFAULT_BOM_RULES: BomRules = { default: DEFAULT_SPARE_RULE };
