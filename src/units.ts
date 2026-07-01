/**
 * Distance units for showing + entering cable run lengths. Storage is always
 * metric (`lengthMeters` on the edge) — the unit is purely a display/entry
 * choice, toggled in Preferences and persisted per-user (see userPrefs
 * `loadDistanceUnit`). Keep meters as the source of truth so saved diagrams and
 * the community DB stay unit-agnostic; convert only at the UI edge.
 */
export type DistanceUnit = "metric" | "imperial";

/** Exact International-foot definition. */
const METERS_PER_FOOT = 0.3048;

/** Unit suffix shown next to a value ("m" / "ft"). */
export function distanceSuffix(unit: DistanceUnit): string {
  return unit === "imperial" ? "ft" : "m";
}

/** Stored meters → a display number in `unit`, rounded to 0.1 (the pack-list precision). */
export function fromMeters(meters: number, unit: DistanceUnit): number {
  const value = unit === "imperial" ? meters / METERS_PER_FOOT : meters;
  return Math.round(value * 10) / 10;
}

/** A value entered in `unit` → stored meters. */
export function toMeters(value: number, unit: DistanceUnit): number {
  return unit === "imperial" ? value * METERS_PER_FOOT : value;
}

/** Format a stored-meters length for display, e.g. "12.5 m" or "41 ft". */
export function formatLength(meters: number, unit: DistanceUnit): string {
  return `${fromMeters(meters, unit)} ${distanceSuffix(unit)}`;
}
