import type { SignalKind } from "./signals";

/**
 * A physical connector standard — the PORT TYPE, and the source of truth for the
 * model. Whether two ports connect is decided by their connectors mating; color,
 * cable identity, validation, and the legend all key off the connector. The
 * coarse `group` (video/audio/…) is derived metadata for filtering, never set
 * per-port.
 *
 * Kept as a string id (not an enum) so the registry stays open for extension and
 * serializes cleanly into saved diagrams and the future community database.
 */
export type ConnectorId = string;

export type ConnectorDef = {
  id: ConnectorId;
  label: string;
  /** Family-grouped hue, used for port dots, cables, and the legend. */
  color: string;
  /** Coarse bucket, derived — for filtering and validation severity. */
  group: SignalKind;
  /** Adapter grouping, e.g. "HDMI", "BNC", "XLR" — same family mates via a passive adapter. */
  family?: string;
};

/** Ordered by group (A/V, video, audio, data, network, control, power) for the picker. */
export const CONNECTORS: Record<ConnectorId, ConnectorDef> = {
  hdmi: { id: "hdmi", label: "HDMI", color: "#3b82f6", group: "av", family: "HDMI" },
  "mini-hdmi": { id: "mini-hdmi", label: "Mini HDMI", color: "#60a5fa", group: "av", family: "HDMI" },
  dp: { id: "dp", label: "DisplayPort", color: "#6366f1", group: "av", family: "DisplayPort" },
  sdi: { id: "sdi", label: "BNC (SDI)", color: "#8b5cf6", group: "video", family: "BNC" },
  vga: { id: "vga", label: "VGA", color: "#a78bfa", group: "video" },
  xlr3: { id: "xlr3", label: "XLR-3", color: "#22c55e", group: "audio", family: "XLR" },
  "trs-6.35": { id: "trs-6.35", label: 'TRS 1/4"', color: "#16a34a", group: "audio", family: "TRS" },
  "trs-3.5": { id: "trs-3.5", label: "3.5 mm", color: "#4ade80", group: "audio", family: "TRS" },
  rca: { id: "rca", label: "RCA", color: "#84cc16", group: "audio", family: "RCA" },
  toslink: { id: "toslink", label: "TOSLINK", color: "#10b981", group: "audio" },
  "usb-c": { id: "usb-c", label: "USB-C", color: "#ec4899", group: "data", family: "USB" },
  thunderbolt: { id: "thunderbolt", label: "Thunderbolt", color: "#db2777", group: "data", family: "USB" },
  "usb-a": { id: "usb-a", label: "USB-A", color: "#f472b6", group: "data", family: "USB" },
  rj45: { id: "rj45", label: "RJ45", color: "#06b6d4", group: "network" },
  rs232: { id: "rs232", label: "RS-232 (DB9)", color: "#f59e0b", group: "control" },
  iec: { id: "iec", label: "IEC C13/C14", color: "#ef4444", group: "power", family: "IEC" },
};

/** Connectors in display order — for the create wizard's port-type picker. */
export const CONNECTOR_LIST: ConnectorDef[] = Object.values(CONNECTORS);

export function getConnector(id: ConnectorId): ConnectorDef | undefined {
  return CONNECTORS[id];
}

/** Default cable/port color when a connector is unknown. */
export const DEFAULT_CABLE_COLOR = "#94a3b8";

/**
 * Legacy cable-type ids (from the pre-connector-primary model) → connector id,
 * so older saved diagrams still resolve a color/label.
 */
const LEGACY_CABLE_ALIAS: Record<string, ConnectorId> = {
  xlr: "xlr3",
  trs: "trs-6.35",
  cat6: "rj45",
  dante: "rj45",
  power: "iec",
};

function resolve(id: string): ConnectorId {
  return LEGACY_CABLE_ALIAS[id] ?? id;
}

/** Color for a connector (or legacy cable-type id) — port dots, cables, legend. */
export function cableColor(connectorId: string | undefined): string {
  if (!connectorId) return DEFAULT_CABLE_COLOR;
  return CONNECTORS[resolve(connectorId)]?.color ?? DEFAULT_CABLE_COLOR;
}

/** Display label for a connector (or legacy cable-type id). */
export function cableLabel(connectorId: string): string {
  return CONNECTORS[resolve(connectorId)]?.label ?? connectorId;
}

/** Coarse group for a connector — derived; drives filtering and validation severity. */
export function groupForConnector(connectorId: string | undefined): SignalKind {
  if (!connectorId) return "av";
  return CONNECTORS[resolve(connectorId)]?.group ?? "av";
}
