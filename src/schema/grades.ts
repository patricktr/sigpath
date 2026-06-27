/**
 * Bandwidth/grade ladders — the second half of the compatibility primitive.
 *
 * A connector proves two ports can physically mate; a grade proves the link can
 * actually carry the signal (a 3G-SDI cable won't pass a 12G-SDI feed, though
 * both are BNC). Grades are meaningful only WITHIN a family — you never compare
 * an SDI grade to an HDMI one — so each family is an ordered ladder and the only
 * operation is "rank ≥ rank" inside one scale.
 *
 * This module is pure data + pure lookups. The validator layers demand-vs-capability
 * on top of {@link checkPortCompatibility} (the connector check) — see
 * design/SIGNAL-GRADE.html. Added 2026-06-22 as Phase A groundwork; all consumers
 * (Port.grade, Connection.cableGrade/signalGrade, Project.signalProfile) are optional,
 * so an ungraded diagram behaves exactly as before.
 */

/** A family of bandwidth tiers sharing a connector lineage (SDI, HDMI, …). */
export type GradeScaleId = "sdi" | "hdmi" | "displayport" | "usb" | "ethernet";

/**
 * A specific tier, as a globally-unique, scale-prefixed id (e.g. "sdi-3g",
 * "hdmi-2.1"). Self-locating, so a stored grade resolves back to its scale and
 * serializes into saved diagrams and the community catalog without ambiguity.
 */
export type GradeId = string;

export type GradeTier = {
  id: GradeId;
  /** Human label for the picker, legend, and validation messages. */
  label: string;
  /** Position within its scale; higher carries more. The only field compared. */
  rank: number;
  /** Approximate raw line rate in Gbps — for display/sorting, never the compare. */
  gbps: number;
};

export type GradeScale = {
  id: GradeScaleId;
  label: string;
  /** Ascending by capability; each tier's `rank` mirrors its index. */
  tiers: GradeTier[];
};

/** Build a scale, assigning `rank` from order so the ladders stay terse. */
function scale(
  id: GradeScaleId,
  label: string,
  rows: ReadonlyArray<readonly [GradeId, string, number]>,
): GradeScale {
  return {
    id,
    label,
    tiers: rows.map(([gid, glabel, gbps], rank) => ({ id: gid, label: glabel, rank, gbps })),
  };
}

/**
 * The ladders. Rates per SMPTE (SDI), the HDMI/DP/USB-IF specs, and BASE-T —
 * see design/SIGNAL-GRADE.html §4. Add tiers at the top as standards grow; never
 * reorder existing rows (rank is positional and bakes into saved data via grade ids).
 */
export const GRADE_SCALES: Record<GradeScaleId, GradeScale> = {
  sdi: scale("sdi", "SDI", [
    ["sdi-sd", "SD-SDI", 0.27],
    ["sdi-hd", "HD-SDI", 1.485],
    ["sdi-3g", "3G-SDI", 2.97],
    ["sdi-6g", "6G-SDI", 6],
    ["sdi-12g", "12G-SDI", 12],
    ["sdi-24g", "24G-SDI", 24],
  ]),
  hdmi: scale("hdmi", "HDMI", [
    ["hdmi-1.4", "HDMI 1.4", 10.2],
    ["hdmi-2.0", "HDMI 2.0", 18],
    ["hdmi-2.1", "HDMI 2.1", 48],
  ]),
  displayport: scale("displayport", "DisplayPort", [
    ["dp-1.2", "DP 1.2 (HBR2)", 21.6],
    ["dp-1.4", "DP 1.4 (HBR3)", 32.4],
    ["dp-2.0", "DP 2.0 (UHBR20)", 80],
  ]),
  usb: scale("usb", "USB", [
    ["usb-2.0", "USB 2.0", 0.48],
    ["usb-5g", "USB 5 Gbps", 5],
    ["usb-10g", "USB 10 Gbps", 10],
    ["usb-20g", "USB 20 Gbps", 20],
    ["usb-40g", "USB4 / TB 40 Gbps", 40],
    ["usb-80g", "USB4 v2 / TB5 80 Gbps", 80],
  ]),
  ethernet: scale("ethernet", "Ethernet", [
    ["eth-100m", "100BASE-TX", 0.1],
    ["eth-1g", "1GBASE-T", 1],
    ["eth-2.5g", "2.5GBASE-T", 2.5],
    ["eth-5g", "5GBASE-T", 5],
    ["eth-10g", "10GBASE-T", 10],
    ["eth-25g", "25GBASE-T", 25],
  ]),
};

/** Flat index: GradeId → its scale + tier, for O(1) lookup. Built once. */
const TIER_INDEX = new Map<GradeId, { scale: GradeScaleId; tier: GradeTier }>();
for (const s of Object.values(GRADE_SCALES)) {
  for (const tier of s.tiers) TIER_INDEX.set(tier.id, { scale: s.id, tier });
}

export function getGradeScale(id: GradeScaleId | undefined): GradeScale | undefined {
  return id ? GRADE_SCALES[id] : undefined;
}

export function getGradeTier(grade: GradeId | undefined): GradeTier | undefined {
  return grade ? TIER_INDEX.get(grade)?.tier : undefined;
}

/** Which scale a grade belongs to — undefined for an unknown/empty id. */
export function scaleOfGrade(grade: GradeId | undefined): GradeScaleId | undefined {
  return grade ? TIER_INDEX.get(grade)?.scale : undefined;
}

/** Display label for a grade id, falling back to the raw id then "". */
export function gradeLabel(grade: GradeId | undefined): string {
  return getGradeTier(grade)?.label ?? grade ?? "";
}

export function gradeRank(grade: GradeId | undefined): number | undefined {
  return getGradeTier(grade)?.rank;
}

/** Tiers of a scale, ascending — for a scale-aware grade picker. */
export function gradesForScale(id: GradeScaleId | undefined): GradeTier[] {
  return id ? GRADE_SCALES[id].tiers : [];
}

/**
 * Can a hop of capability `capability` carry a signal demanding `demand`? True iff
 * both grades share a scale and capability's rank ≥ demand's. Returns `undefined`
 * when it can't tell — either side unknown, or a cross-scale pair — so the validator
 * can treat "can't tell" as "don't flag" and never produce a false positive.
 */
export function meetsDemand(
  capability: GradeId | undefined,
  demand: GradeId | undefined,
): boolean | undefined {
  const cap = capability ? TIER_INDEX.get(capability) : undefined;
  const dem = demand ? TIER_INDEX.get(demand) : undefined;
  if (!cap || !dem || cap.scale !== dem.scale) return undefined;
  return cap.tier.rank >= dem.tier.rank;
}

/**
 * The lower-capability of two grades in the same scale — used to clamp a run's
 * demand to what its source can actually emit. Unknown/cross-scale inputs degrade
 * gracefully (a defined grade wins over undefined; mismatched scales return `a`).
 */
export function minGrade(a: GradeId | undefined, b: GradeId | undefined): GradeId | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const ra = gradeRank(a);
  const rb = gradeRank(b);
  if (ra === undefined || rb === undefined || scaleOfGrade(a) !== scaleOfGrade(b)) return a;
  return ra <= rb ? a : b;
}

/**
 * The higher-capability of two grades in the same scale — the fan-in merge for grade
 * propagation (a device fed by several signals could route the worst onto any output, so
 * its outputs carry the max). Symmetric to {@link minGrade}: undefined/cross-scale inputs
 * degrade gracefully (a defined grade wins over undefined; mismatched scales return `a`).
 */
export function maxGrade(a: GradeId | undefined, b: GradeId | undefined): GradeId | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const ra = gradeRank(a);
  const rb = gradeRank(b);
  if (ra === undefined || rb === undefined || scaleOfGrade(a) !== scaleOfGrade(b)) return a;
  return ra >= rb ? a : b;
}

/**
 * Common production video formats → the *minimum* grade that reliably carries each
 * in the image-domain families (SDI/HDMI/DisplayPort). "Minimum that carries", not
 * "modern default", is deliberate: it's what keeps an HDMI 1.4 link from being
 * false-flagged in a 1080p59.94 show it genuinely handles. Network and USB demands
 * are NOT derived from the video format — they come from SignalProfile.targets.
 *
 * Curated and meant to be edited — this table is the semantic heart of grade
 * validation. Rates cross-checked against SMPTE (SDI) and HDMI/DP 8-bit payload
 * limits. See design/SIGNAL-GRADE.html §3.
 */
export const VIDEO_FORMAT_GRADES: Record<string, Partial<Record<GradeScaleId, GradeId>>> = {
  "720p59.94": { sdi: "sdi-hd", hdmi: "hdmi-1.4", displayport: "dp-1.2" },
  "1080i59.94": { sdi: "sdi-hd", hdmi: "hdmi-1.4", displayport: "dp-1.2" },
  "1080p23.98": { sdi: "sdi-hd", hdmi: "hdmi-1.4", displayport: "dp-1.2" },
  "1080p29.97": { sdi: "sdi-hd", hdmi: "hdmi-1.4", displayport: "dp-1.2" },
  "1080p59.94": { sdi: "sdi-3g", hdmi: "hdmi-1.4", displayport: "dp-1.2" },
  "2160p23.98": { sdi: "sdi-6g", hdmi: "hdmi-1.4", displayport: "dp-1.2" },
  "2160p29.97": { sdi: "sdi-6g", hdmi: "hdmi-1.4", displayport: "dp-1.2" },
  "2160p59.94": { sdi: "sdi-12g", hdmi: "hdmi-2.0", displayport: "dp-1.2" },
  "2160p119.88": { sdi: "sdi-24g", hdmi: "hdmi-2.1", displayport: "dp-2.0" },
};

/** Video formats in ascending-demand order — for the show-format picker. */
export const VIDEO_FORMATS: string[] = Object.keys(VIDEO_FORMAT_GRADES);

/** Demand a video format imposes on an image-domain scale (sdi/hdmi/displayport). */
export function videoFormatToGrade(
  format: string | undefined,
  scale: GradeScaleId,
): GradeId | undefined {
  if (!format) return undefined;
  return VIDEO_FORMAT_GRADES[format]?.[scale];
}
