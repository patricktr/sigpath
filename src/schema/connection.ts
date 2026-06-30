import type { CableTypeId } from "./cables";
import type { Port } from "./device";
import { CONNECTORS } from "./connectors";
import type { GradeId } from "./grades";

/** Reference to a specific port on a specific placed device. */
export type PortRef = {
  instanceId: string;
  portId: string;
};

/** A cable run between two ports. Maps to a React Flow edge plus domain data. */
export type Connection = {
  id: string;
  /** Output side. */
  from: PortRef;
  /** Input side. */
  to: PortRef;
  cableTypeId: CableTypeId;
  /** Human cable id/number, e.g. "VID-001". */
  number?: string;
  lengthMeters?: number;
  /**
   * The cable's *supported* bandwidth rating (e.g. "sdi-3g") — the "supported" side
   * of the grade gate. Omitted ⇒ unrated, so this cable hop isn't grade-checked.
   */
  cableGrade?: GradeId;
  /**
   * Per-run demand override — pins what this run actually carries, regardless of the
   * project show format (the lone 12G feed in an HD show, or an HD feed in a 4K show).
   * Omitted ⇒ demand falls back to the project profile clamped by the source. See grades.ts.
   */
  signalGrade?: GradeId;
  label?: string;
  /**
   * Manual routing override (px): the cable's vertical jog X relative to the run's
   * midpoint, set when the user nudges it off the auto-router's track. Omitted ⇒ the
   * crossing-minimizer places it; present ⇒ it's pinned and the auto pass routes
   * around it.
   */
  jogOffset?: number;
};

export type CompatStatus = "ok" | "warn" | "error";

/** What kind of link a connector pair forms — drives messaging and the BOM. */
export type LinkKind = "straight" | "adapter" | "psu" | "converter" | "incompatible" | "unknown";

export type CompatResult = {
  status: CompatStatus;
  /** Finer classification for messaging + the cables/adapters list. */
  kind?: LinkKind;
  reason?: string;
};

// Video-only and embedded A/V interconvert (scalers, SDI↔HDMI), so they share a
// conversion domain; every other group stands alone.
const DOMAIN: Record<string, string> = { video: "image", av: "image" };
const domain = (g: string) => DOMAIN[g] ?? g;

/**
 * Compatibility between an output port and an input port, decided by their
 * connectors — the port type is the source of truth. Lives in the schema
 * because it's a property of the connector model.
 *
 *  - ok:    same connector — a straight cable works.
 *  - warn:  same family (passive adapter) or same coarse group, different
 *           family (active converter).
 *  - error: different group — physically/electrically incompatible.
 */
/** DC-side power connectors — an AC↔DC transition is a device PSU, not a stock cable. A device
 *  with one as an INPUT ships with its own external brick (drives the pack list's PSU lines). */
export const DC_POWER = new Set<string>(["dc-barrel", "xlr4-dc", "euroblock-dc"]);

/**
 * Beyond same-`family`, sets of connectors that are all mutually bridgeable by a single
 * PASSIVE cable/adapter — no active electronics. Analog audio is the big one: XLR, TRS, TS,
 * RCA and Euroblock all carry the same line/mic-level analog signal, so any pairing is just
 * a cable (balanced↔unbalanced is a wiring choice, not a converter — e.g. a TRS 1/4" → XLR
 * cable). Speaker-level connectors form their own group. Digital audio (AES3, TOSLINK) is
 * deliberately excluded — bridging it to analog needs an active A/D–D/A converter.
 */
const PASSIVE_GROUPS: readonly string[][] = [
  ["xlr3", "trs-6.35", "trs-3.5", "ts-6.35", "rca", "euroblock"], // analog line / mic level
  ["speakon", "banana"], // speaker level
];
const PASSIVE_GROUP_OF = new Map<string, number>();
PASSIVE_GROUPS.forEach((g, i) => g.forEach((id) => PASSIVE_GROUP_OF.set(id, i)));

/** True when two connectors sit in the same passive-cable group (e.g. TRS ↔ XLR). */
function samePassiveGroup(a: string, b: string): boolean {
  const ga = PASSIVE_GROUP_OF.get(a);
  return ga !== undefined && ga === PASSIVE_GROUP_OF.get(b);
}

/**
 * Compatibility between two specific connector ids (one output, one input),
 * classified into a {@link LinkKind}: a straight cable, a passive adapter/transition
 * cable (same signal, different connector — one cable bridges it), a device PSU
 * (AC↔DC power), an active converter (same signal, no passive cable — a real
 * mismatch, flagged as an error), or outright incompatible.
 */
function compatByConnector(outId: string, inId: string): CompatResult {
  if (outId === inId) {
    return { status: "ok", kind: "straight" };
  }

  const a = CONNECTORS[outId];
  const b = CONNECTORS[inId];
  if (!a || !b) {
    return { status: "warn", kind: "unknown", reason: "Unknown connector type" };
  }

  // Power: AC↔DC is the device's own PSU (not a stock cable); AC↔AC is a power cord.
  if (a.group === "power" && b.group === "power") {
    if (DC_POWER.has(outId) !== DC_POWER.has(inId)) {
      return { status: "ok", kind: "psu", reason: "Powered by the device's own PSU" };
    }
    return { status: "ok", kind: "adapter", reason: `${a.label} → ${b.label} power cable` };
  }

  // Same family (HDMI ↔ Mini-HDMI), or two connectors in the same passive-cable group
  // (analog audio TRS ↔ XLR ↔ RCA…, or speaker speakON ↔ banana) → one passive cable.
  if ((a.family && a.family === b.family) || samePassiveGroup(outId, inId)) {
    return { status: "ok", kind: "adapter", reason: `Use a ${a.label} → ${b.label} cable` };
  }

  // Same signal domain, no passive cable → needs an active converter (a real mismatch).
  if (domain(a.group) === domain(b.group)) {
    return {
      status: "error",
      kind: "converter",
      reason: `${a.label} → ${b.label} needs an active converter`,
    };
  }

  return {
    status: "error",
    kind: "incompatible",
    reason: `${a.label} (${a.group}) is incompatible with ${b.label} (${b.group})`,
  };
}

/**
 * Compatibility between an output port and an input port. A combo jack widens the
 * connectors a port mates with via `accepts`; we return the *best* status across
 * every connector pairing — a straight match beats an adapter beats incompatible.
 */
export function checkPortCompatibility(output: Port, input: Port): CompatResult {
  const outs = [output.connector, ...(output.accepts ?? [])];
  const ins = [input.connector, ...(input.accepts ?? [])];
  const rank = (s: CompatStatus) => (s === "ok" ? 0 : s === "warn" ? 1 : 2);
  let best: CompatResult | undefined;
  for (const o of outs) {
    for (const i of ins) {
      const r = compatByConnector(o, i);
      if (r.status === "ok") return r;
      if (!best || rank(r.status) < rank(best.status)) best = r;
    }
  }
  return best ?? { status: "error", kind: "incompatible" };
}
