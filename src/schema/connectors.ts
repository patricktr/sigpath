import { SIGNAL_META } from "./signals";
import type { SignalKind } from "./signals";
import type { PortDirection } from "./device";

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
  /** Colloquial search terms for the connector picker (e.g. "ethernet" → RJ45). */
  aliases?: string[];
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
  rj45: { id: "rj45", label: "RJ45", color: "#06b6d4", group: "network", family: "RJ45" },
  rs232: { id: "rs232", label: "RS-232 (DB9)", color: "#f59e0b", group: "control" },
  iec: { id: "iec", label: "IEC C13/C14", color: "#ef4444", group: "power", family: "IEC" },
  "nema-5-15": { id: "nema-5-15", label: "NEMA 5-15 (Edison)", color: "#b91c1c", group: "power", family: "NEMA" },
  "dc-barrel": { id: "dc-barrel", label: "DC (barrel)", color: "#f87171", group: "power" },
  // — extended vocabulary for catalog scaling (2026-06-20) —
  "micro-hdmi": { id: "micro-hdmi", label: "Micro HDMI", color: "#93c5fd", group: "av", family: "HDMI" },
  "mini-dp": { id: "mini-dp", label: "Mini DisplayPort", color: "#818cf8", group: "av", family: "DisplayPort" },
  dvi: { id: "dvi", label: "DVI-D", color: "#7c3aed", group: "video" },
  bnc: { id: "bnc", label: "BNC (75Ω)", color: "#7e22ce", group: "video", family: "BNC" },
  "f-type": { id: "f-type", label: "F-type (coax)", color: "#a855f7", group: "video" },
  hdbaset: { id: "hdbaset", label: "HDBaseT (RJ45)", color: "#6d28d9", group: "av" },
  euroblock: { id: "euroblock", label: "Euroblock / Phoenix", color: "#15803d", group: "audio" },
  speakon: { id: "speakon", label: "speakON", color: "#166534", group: "audio" },
  banana: { id: "banana", label: "Banana / binding post", color: "#4d7c0f", group: "audio" },
  "ts-6.35": { id: "ts-6.35", label: 'TS 1/4"', color: "#22c55e", group: "audio", family: "TRS" },
  aes3: { id: "aes3", label: "AES3 (XLR)", color: "#15803d", group: "audio", family: "XLR" },
  "usb-b": { id: "usb-b", label: "USB-B", color: "#f9a8d4", group: "data", family: "USB" },
  "usb-micro": { id: "usb-micro", label: "USB Micro-B", color: "#f5a3c7", group: "data", family: "USB" },
  ethercon: { id: "ethercon", label: "etherCON", color: "#0891b2", group: "network", family: "RJ45" },
  "fiber-lc": { id: "fiber-lc", label: "Fiber LC", color: "#0e7490", group: "network" },
  sfp: { id: "sfp", label: "SFP / SFP+", color: "#22d3ee", group: "network" },
  rs422: { id: "rs422", label: "RS-422", color: "#f59e0b", group: "control" },
  rs485: { id: "rs485", label: "RS-485", color: "#d97706", group: "control" },
  ir: { id: "ir", label: "IR (3.5 mm)", color: "#fbbf24", group: "control" },
  xlr5: { id: "xlr5", label: "XLR-5 (DMX)", color: "#f97316", group: "control" },
  "midi-din": { id: "midi-din", label: "MIDI (DIN-5)", color: "#ca8a04", group: "control" },
  "iec-c19": { id: "iec-c19", label: "IEC C19/C20", color: "#dc2626", group: "power" },
  powercon: { id: "powercon", label: "powerCON", color: "#b91c1c", group: "power" },
  // Low-power figure-8 / cloverleaf AC inlets (Apple TV, laptop bricks, small gear).
  "iec-c7": { id: "iec-c7", label: "IEC C7/C8 (figure-8)", color: "#fb7185", group: "power" },
  "iec-c5": { id: "iec-c5", label: "IEC C5/C6 (cloverleaf)", color: "#f43f5e", group: "power" },
  // 4-pin XLR and captive-screw DC inlets (cameras, recorders, hardened switches).
  // Power group, DC side — an AC source resolves into them as the device's PSU.
  "xlr4-dc": { id: "xlr4-dc", label: "XLR-4 (DC power)", color: "#e11d48", group: "power" },
  "euroblock-dc": { id: "euroblock-dc", label: "Euroblock (DC power)", color: "#9f1239", group: "power" },
};

/**
 * Colloquial search terms, kept beside the registry so the picker finds a
 * connector by what people actually call it ("ethernet" → RJ45, "edison" → NEMA,
 * "figure 8" → IEC C7). Attached onto the defs at load so there's one source.
 */
const CONNECTOR_ALIASES: Record<string, string[]> = {
  rj45: ["ethernet", "cat5", "cat5e", "cat6", "lan"],
  ethercon: ["ethernet", "locking ethernet"],
  "nema-5-15": ["edison", "wall plug", "us mains", "outlet"],
  iec: ["kettle lead", "c13", "c14", "mains"],
  "iec-c19": ["c19", "c20", "high current"],
  "iec-c7": ["figure 8", "figure-8", "shotgun", "apple tv", "c7", "c8"],
  "iec-c5": ["cloverleaf", "clover leaf", "mickey mouse", "c5", "c6", "laptop"],
  powercon: ["nac3", "locking power"],
  "dc-barrel": ["barrel", "wall wart", "power brick", "psu"],
  "xlr4-dc": ["4-pin xlr", "xlr4", "battery", "dc"],
  "euroblock-dc": ["phoenix", "terminal block", "captive screw", "dc"],
  xlr3: ["mic", "balanced", "3-pin xlr"],
  xlr5: ["dmx", "dmx512", "lighting"],
  "trs-3.5": ["aux", "mini jack", "headphone", "1/8 inch", "3.5mm"],
  "trs-6.35": ["1/4 inch", "quarter inch", "jack", "6.35mm"],
  "ts-6.35": ["instrument", "guitar", "unbalanced 1/4"],
  euroblock: ["phoenix", "terminal block", "captive screw"],
  speakon: ["nl4", "nl2"],
  toslink: ["optical", "spdif optical", "adat"],
  "usb-c": ["type c", "usb type-c"],
  thunderbolt: ["tb3", "tb4"],
  "f-type": ["coax", "antenna", "rf", "cable tv"],
  "midi-din": ["midi", "din", "5-pin din"],
  rs232: ["serial", "db9", "com port"],
  rs422: ["serial", "deck control"],
  vga: ["d-sub", "hd15", "rgbhv"],
  sdi: ["hd-sdi", "3g", "12g", "coax"],
  bnc: ["coax", "75 ohm"],
  hdbaset: ["cat extender", "hdbt"],
  "fiber-lc": ["fiber", "optical", "lc"],
  sfp: ["sfp+", "fiber module"],
};
for (const [id, aliases] of Object.entries(CONNECTOR_ALIASES)) {
  const def = CONNECTORS[id];
  if (def) def.aliases = aliases;
}

/** Connectors in display order — for the create wizard's port-type picker. */
export const CONNECTOR_LIST: ConnectorDef[] = Object.values(CONNECTORS);

/** Signal groups in display order — drives grouping in the connector picker. */
export const SIGNAL_GROUP_ORDER: SignalKind[] = [
  "av",
  "video",
  "audio",
  "data",
  "network",
  "control",
  "power",
];

/**
 * Where a power connector sits in a power chain. Lets the picker suggest the
 * right ends first — a device input wants an inlet (IEC, DC barrel, XLR-4 DC),
 * a distribution output wants an outlet (NEMA).
 */
export type PowerRole = "outlet" | "inlet" | "dc-inlet";
const POWER_ROLE: Record<string, PowerRole> = {
  "nema-5-15": "outlet",
  iec: "inlet",
  "iec-c7": "inlet",
  "iec-c5": "inlet",
  "iec-c19": "inlet",
  powercon: "inlet",
  "dc-barrel": "dc-inlet",
  "xlr4-dc": "dc-inlet",
  "euroblock-dc": "dc-inlet",
};
export function powerRole(id: string): PowerRole | undefined {
  return POWER_ROLE[id];
}

export type ConnectorGroup = { group: SignalKind; label: string; items: ConnectorDef[] };

/**
 * Connectors bucketed by signal group, in display order — the single source for
 * the connector picker (replacing the old flat, twice-grouped list). For power,
 * `direction` floats the relevant ends first: an input surfaces inlets, an
 * output surfaces outlets.
 */
export function connectorsByGroup(direction?: PortDirection): ConnectorGroup[] {
  const byGroup = new Map<SignalKind, ConnectorDef[]>();
  for (const c of Object.values(CONNECTORS)) {
    const list = byGroup.get(c.group);
    if (list) list.push(c);
    else byGroup.set(c.group, [c]);
  }
  return SIGNAL_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => {
    let items = byGroup.get(g) as ConnectorDef[];
    if (g === "power" && direction) {
      const wantInlet = direction !== "output";
      const rank = (c: ConnectorDef) => {
        const role = powerRole(c.id);
        if (wantInlet) return role === "inlet" || role === "dc-inlet" ? 0 : 1;
        return role === "outlet" ? 0 : 1;
      };
      items = [...items].sort((a, b) => rank(a) - rank(b));
    }
    return { group: g, label: SIGNAL_META[g].label, items };
  });
}

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
