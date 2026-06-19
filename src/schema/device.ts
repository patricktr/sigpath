import type { SignalKind } from "./signals";
import type { ConnectorId } from "./connectors";

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
};

/** Ports rendered on the left edge (things you connect *into*). */
export function inputPorts(model: DeviceModel): Port[] {
  return model.ports.filter(
    (p) => p.direction === "input" || p.direction === "bidirectional",
  );
}

/** Ports rendered on the right edge (things you connect *out of*). */
export function outputPorts(model: DeviceModel): Port[] {
  return model.ports.filter(
    (p) => p.direction === "output" || p.direction === "bidirectional",
  );
}

/** Display name for a placed device: its label, else manufacturer + model. */
export function deviceTitle(model: DeviceModel, label?: string): string {
  if (label) return label;
  return model.manufacturer ? `${model.manufacturer} ${model.model}` : model.model;
}
