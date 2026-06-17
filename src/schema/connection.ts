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

/**
 * Pure compatibility check between an output port and an input port. Lives in
 * the schema (not the UI) because compatibility is a property of the connector/
 * signal model. This is the primitive the future "Signal Check" validation and
 * connection-time guards will call.
 *
 *  - ok:    same connector — a straight cable works.
 *  - warn:  same signal kind, different connector — needs an adapter/converter.
 *  - error: different signal kind — physically/electrically incompatible.
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

  if (output.signal === input.signal) {
    return { status: "warn", reason: `${a.label} → ${b.label} needs an adapter` };
  }

  return {
    status: "error",
    reason: `${a.label} (${output.signal}) is incompatible with ${b.label} (${input.signal})`,
  };
}
