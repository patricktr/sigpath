import type { SignalKind } from "./signals";
import type { ConnectorId } from "./connectors";

/** A cable standard (string id for the same extensibility reasons as ConnectorId). */
export type CableTypeId = string;

export type CableTypeDef = {
  id: CableTypeId;
  label: string;
  /** Default color for this cable type; a plan may override per-diagram later. */
  color: string;
  signal: SignalKind;
  /** Connector ids this cable terminates in. */
  connectors: ConnectorId[];
};

/**
 * Starter cable catalog with sensible default colors. These power the "color
 * cables by type" feature and the legend.
 */
export const CABLE_TYPES: Record<CableTypeId, CableTypeDef> = {
  hdmi: { id: "hdmi", label: "HDMI", color: "#3b82f6", signal: "av", connectors: ["hdmi"] },
  sdi: { id: "sdi", label: "SDI", color: "#6366f1", signal: "video", connectors: ["sdi"] },
  dp: { id: "dp", label: "DisplayPort", color: "#0ea5e9", signal: "av", connectors: ["dp"] },
  vga: { id: "vga", label: "VGA", color: "#64748b", signal: "video", connectors: ["vga"] },
  xlr: { id: "xlr", label: "XLR (analog)", color: "#22c55e", signal: "audio", connectors: ["xlr3"] },
  trs: { id: "trs", label: "TRS", color: "#16a34a", signal: "audio", connectors: ["trs-6.35", "trs-3.5"] },
  toslink: { id: "toslink", label: "Optical (TOSLINK)", color: "#14b8a6", signal: "audio", connectors: ["toslink"] },
  dante: { id: "dante", label: "Dante", color: "#a855f7", signal: "network", connectors: ["rj45"] },
  cat6: { id: "cat6", label: "Cat6 / Network", color: "#8b5cf6", signal: "network", connectors: ["rj45"] },
  rs232: { id: "rs232", label: "RS-232", color: "#f59e0b", signal: "control", connectors: ["rs232"] },
  power: { id: "power", label: "Power (IEC)", color: "#ef4444", signal: "power", connectors: ["iec"] },
};

export function getCableType(id: CableTypeId): CableTypeDef | undefined {
  return CABLE_TYPES[id];
}

/** Default cable color when a type is unknown or unset. */
export const DEFAULT_CABLE_COLOR = "#94a3b8";
