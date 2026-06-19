import type { CableTypeId } from "./cables";
import type { Port } from "./device";
import { CONNECTORS } from "./connectors";

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
  label?: string;
};

export type CompatStatus = "ok" | "warn" | "error";

export type CompatResult = {
  status: CompatStatus;
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
export function checkPortCompatibility(output: Port, input: Port): CompatResult {
  if (output.connector === input.connector) {
    return { status: "ok" };
  }

  const a = CONNECTORS[output.connector];
  const b = CONNECTORS[input.connector];
  if (!a || !b) {
    return { status: "warn", reason: "Unknown connector type" };
  }

  // Same family (HDMI ↔ Mini HDMI) → a passive adapter mates them.
  if (a.family && a.family === b.family) {
    return { status: "warn", reason: `${a.label} → ${b.label} needs an adapter` };
  }
  // Same conversion domain, different family → an active converter is needed.
  if (domain(a.group) === domain(b.group)) {
    return { status: "warn", reason: `${a.label} → ${b.label} needs a converter` };
  }

  return {
    status: "error",
    reason: `${a.label} (${a.group}) is incompatible with ${b.label} (${b.group})`,
  };
}
