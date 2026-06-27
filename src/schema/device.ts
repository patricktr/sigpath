import type { SignalKind } from "./signals";
import type { ConnectorId } from "./connectors";
import type { GradeId } from "./grades";

export type PortDirection = "input" | "output" | "bidirectional";

/** A single physical port on a device (one input, output, or bidirectional jack). */
export type Port = {
  /** Unique within its device; used as the React Flow handle id. */
  id: string;
  /** Human label shown next to the port, e.g. "HDMI 1", "Mic In 3", "eARC". */
  name: string;
  direction: PortDirection;
  /** The port type — the source of truth for color, cabling, and validation. */
  connector: ConnectorId;
  /**
   * Additional connectors this one physical jack also mates with — e.g. a combo
   * XLR/TRS input is `{ connector: "xlr3", accepts: ["trs-6.35"] }`. The primary
   * `connector` drives color/label; `accepts` widens compatibility. One jack
   * still carries one cable at a time.
   */
  accepts?: ConnectorId[];
  /**
   * Max bandwidth grade this jack emits/accepts — its *capability* ceiling
   * (e.g. "sdi-12g", "hdmi-2.1"). Belongs to the connector's {@link gradeScale};
   * omitted ⇒ unrated, so the run is never grade-checked at this end. See grades.ts.
   */
  grade?: GradeId;
  /** Legacy/derived coarse group; the connector is authoritative. Optional. */
  signal?: SignalKind;
  note?: string;
};

export type DeviceCategory =
  | "source"
  | "display"
  | "switcher"
  | "matrix"
  | "amplifier"
  | "audio"
  | "recorder"
  | "converter"
  | "network"
  | "control"
  | "power"
  | "other";

/** All device categories, in display order — for builder dropdowns. */
export const DEVICE_CATEGORIES: DeviceCategory[] = [
  "source",
  "display",
  "switcher",
  "matrix",
  "amplifier",
  "audio",
  "recorder",
  "converter",
  "network",
  "control",
  "power",
  "other",
];

/**
 * Friendly, user-facing device types — finer than DeviceCategory. Drives the
 * Add-Device browser's Type facet/column and the create wizard's Type select.
 */
export const DEVICE_TYPES = [
  "Media source",
  "Camera",
  "Computer",
  "Video switcher",
  "Matrix router",
  "Converter",
  "Scaler",
  "Extender",
  "AV receiver",
  "Audio mixer",
  "Amplifier",
  "Speaker",
  "Display",
  "Projector",
  "Network switch",
  "Control processor",
  "Recorder",
  "Audio interface",
  "Power conditioner",
  "Wireless mic",
  "Microphone",
  "DSP",
  "PDU",
  "Touch panel",
  "Media player",
  "Encoder/Decoder",
  "Other",
] as const;

const TYPE_TO_CATEGORY: Record<string, DeviceCategory> = {
  "Media source": "source",
  Camera: "source",
  Computer: "source",
  "Video switcher": "switcher",
  "AV receiver": "switcher",
  "Matrix router": "matrix",
  Converter: "converter",
  Scaler: "converter",
  Extender: "converter",
  "Audio mixer": "audio",
  Amplifier: "amplifier",
  Speaker: "audio",
  Display: "display",
  Projector: "display",
  "Network switch": "network",
  "Control processor": "control",
  Recorder: "recorder",
  "Audio interface": "audio",
  "Power conditioner": "power",
  "Wireless mic": "audio",
  Microphone: "audio",
  DSP: "audio",
  PDU: "power",
  "Touch panel": "control",
  "Media player": "source",
  "Encoder/Decoder": "converter",
  Other: "other",
};

/** Coarse category for a friendly type — keeps `category` populated for devices
 *  created via the wizard, which only collects the finer type. */
export function categoryForType(type: string): DeviceCategory {
  return TYPE_TO_CATEGORY[type] ?? "other";
}

/**
 * A reusable device definition — a "model" in the library. This is what the
 * equipment database stores and the custom item builder produces. It is the
 * unit that gets shared/community-contributed.
 */
export type DeviceModel = {
  /** Stable library id. */
  id: string;
  manufacturer?: string;
  /** Model name, e.g. "BRAVIA X90L". */
  model: string;
  category: DeviceCategory;
  /** Finer, user-facing type (e.g. "Video switcher", "Camera"). Optional;
   *  `category` remains the coarse grouping used internally. */
  type?: string;
  ports: Port[];
  /** Height in 19" rack units — for the future rack-elevation view. */
  rackUnits?: number;
  source: "community" | "custom" | "builtin";
  imageUrl?: string;
  /**
   * Catalog revision this model was synced at (community models only). Lets the
   * sync client tell which local rows are stale. See design/COMMUNITY.html §3.
   */
  rev?: number;
  /**
   * Stable hash of the model's identity-bearing spec — powers per-row change
   * detection, dedup, and sync deltas. Produced by {@link deviceContentHash}.
   */
  contentHash?: string;
  /**
   * Set when a community/built-in model was forked into the personal library to
   * correct it. Records what was forked so a later "submit correction" can diff
   * against that base instead of overwriting blind. See design/COMMUNITY.html §5.
   */
  forkedFrom?: { id: string; baseRev?: number; baseHash?: string };
};

/**
 * A device placed on a diagram. It embeds a *snapshot* of the model rather than
 * just referencing it, so a saved or shared diagram stays self-contained and
 * stable even if the library later changes — a deliberate local-first choice.
 */
export type DeviceInstance = {
  /** Unique within the diagram (becomes the React Flow node id). */
  id: string;
  model: DeviceModel;
  /** User override for this placement, e.g. "Stage-Left Camera". */
  label?: string;
  position: { x: number; y: number };
  /**
   * Per-output-port signal cap (p2-deepgrade): "this output emits at most grade X". Keyed by
   * {@link Port.id}. Propagates downstream through grade validation, so a feed known to run
   * below the show format (a dedicated 3G camera in a 4K show) isn't graded against the format.
   * Per-instance (this placement), not the shared model. Optional/additive.
   */
  signalPins?: Record<string, GradeId>;
};

/** Pure input ports — rendered on the left edge. Bidirectional ports are kept
 *  separate ({@link bidirectionalPorts}) so they aren't drawn on two sides at once. */
export function inputPorts(model: DeviceModel): Port[] {
  return model.ports.filter((p) => p.direction === "input");
}

/** Pure output ports — rendered on the right edge. */
export function outputPorts(model: DeviceModel): Port[] {
  return model.ports.filter((p) => p.direction === "output");
}

/** Bidirectional ports (RJ45, etc.) — one physical jack that carries both ways;
 *  rendered once on a bottom bank rather than mirrored on both sides. */
export function bidirectionalPorts(model: DeviceModel): Port[] {
  return model.ports.filter((p) => p.direction === "bidirectional");
}

/** Display name for a placed device: its label, else manufacturer + model. */
export function deviceTitle(model: DeviceModel, label?: string): string {
  if (label) return label;
  return model.manufacturer ? `${model.manufacturer} ${model.model}` : model.model;
}

/**
 * A stable, dependency-free hash of a model's identity-bearing spec — manufacturer,
 * model, category, type, rack units, and ports in order (direction, connector, grade,
 * name, note). Volatile/identity fields (id, source, rev, contentHash, forkedFrom,
 * imageUrl) and the legacy derived `port.signal` are excluded, as are arbitrary local
 * `port.id`s. Used for per-row change detection, dedup, and sync deltas — NOT a
 * security boundary (the contribution pipeline re-validates), so a fast
 * non-cryptographic FNV-1a is plenty.
 *
 * Note: `port.grade` joined the canonical on 2026-06-22 (Phase A of signal-grade).
 * That one-time change re-hashes every existing row — expected, handled as a single
 * catalog rev bump, not a sync bug. See design/SIGNAL-GRADE.html §5.
 */
export function deviceContentHash(model: DeviceModel): string {
  const canonical = JSON.stringify({
    manufacturer: model.manufacturer ?? "",
    model: model.model,
    category: model.category,
    type: model.type ?? "",
    rackUnits: model.rackUnits ?? null,
    ports: model.ports.map((p) => [p.direction, p.connector, p.grade ?? "", p.name, p.note ?? ""]),
  });
  // FNV-1a (32-bit) → 8-char hex. Deterministic and synchronous; collisions only
  // matter per-row (same id across revs), where 32 bits is ample.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Fork a community/built-in model into an editable personal copy, stamped with
 * provenance so a later "submit correction" can compute a field-level diff against
 * the version that was forked rather than overwriting blind. Pure — returns the new
 * model (fresh id, `source: "custom"`, deep-copied ports); persist it via
 * `addToPersonalLibrary` when the user saves their edit. See design/COMMUNITY.html §5.
 */
export function forkCommunityDevice(model: DeviceModel): DeviceModel {
  return {
    ...model,
    id: crypto.randomUUID(),
    source: "custom",
    rev: undefined,
    contentHash: undefined,
    ports: model.ports.map((p) => ({ ...p })),
    forkedFrom: {
      id: model.id,
      baseRev: model.rev,
      baseHash: model.contentHash ?? deviceContentHash(model),
    },
  };
}
