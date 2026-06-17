import type { SignalKind } from "./signals";

/**
 * A physical connector standard. Kept as a string id (not an enum) so the
 * registry stays open for extension and serializes cleanly into saved diagrams
 * and the future community database.
 */
export type ConnectorId = string;

export type ConnectorDef = {
  id: ConnectorId;
  label: string;
  /** Signal kinds this connector can plausibly carry. */
  signals: SignalKind[];
  /** Optional grouping for adapters/variants, e.g. "HDMI", "BNC", "XLR". */
  family?: string;
};

/**
 * Starter set of connectors. Representative, not exhaustive — the community
 * library will extend this over time. Order is roughly by how common each is.
 */
export const CONNECTORS: Record<ConnectorId, ConnectorDef> = {
  hdmi: { id: "hdmi", label: "HDMI", signals: ["av"], family: "HDMI" },
  "mini-hdmi": { id: "mini-hdmi", label: "Mini HDMI", signals: ["av"], family: "HDMI" },
  dp: { id: "dp", label: "DisplayPort", signals: ["av"], family: "DisplayPort" },
  "usb-c": { id: "usb-c", label: "USB-C", signals: ["av", "network", "control", "power"], family: "USB" },
  sdi: { id: "sdi", label: "BNC (SDI)", signals: ["video"], family: "BNC" },
  vga: { id: "vga", label: "VGA", signals: ["video"] },
  xlr3: { id: "xlr3", label: "XLR-3", signals: ["audio"], family: "XLR" },
  "trs-6.35": { id: "trs-6.35", label: 'TRS 1/4"', signals: ["audio"], family: "TRS" },
  "trs-3.5": { id: "trs-3.5", label: "3.5 mm", signals: ["audio"], family: "TRS" },
  rca: { id: "rca", label: "RCA", signals: ["audio", "video"], family: "RCA" },
  toslink: { id: "toslink", label: "TOSLINK", signals: ["audio"] },
  rj45: { id: "rj45", label: "RJ45", signals: ["network", "audio", "control"] },
  rs232: { id: "rs232", label: "RS-232 (DB9)", signals: ["control"] },
  iec: { id: "iec", label: "IEC C13/C14", signals: ["power"], family: "IEC" },
};

export function getConnector(id: ConnectorId): ConnectorDef | undefined {
  return CONNECTORS[id];
}
