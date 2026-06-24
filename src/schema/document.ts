import type { DeviceInstance } from "./device";
import type { Connection } from "./connection";
import type { GradeScaleId, GradeId } from "./grades";
import type { BoundaryPort } from "./boundary";

/**
 * Bumped whenever the persisted shape changes, so a future loader can migrate older
 * `.sigpath` files. v2 (2026-06-22) added the optional `Project.signalProfile` plus
 * optional grade fields on ports and connections. v3 (2026-06-23) added the optional
 * `obstacle` flag on zones and annotations. v4 (2026-06-24) added nested sub-diagrams
 * (p2-zonetab): the optional `Diagram.boundary` (the ports a diagram publishes when
 * embedded) and `Diagram.blocks` (placed references to other diagrams). All additive,
 * so an older file loads unchanged — a missing field reads as absent, i.e. the diagram
 * simply isn't embeddable yet and holds no blocks. See design/ZONE-TAB.html.
 */
export const SIGPATH_SCHEMA_VERSION = 4;

/** A labeled, colored region grouping devices (stage, rack, control room). */
export type Zone = {
  id: string;
  label: string;
  color: string;
  rect: { x: number; y: number; width: number; height: number };
  /** When set, cables route around this region instead of through it. */
  obstacle?: boolean;
};

/** Free-floating note on the canvas (rich text comes later). */
export type Annotation = {
  id: string;
  text: string;
  position: { x: number; y: number };
  /** When set, cables route around this note instead of through it. */
  obstacle?: boolean;
};

/** A single signal-flow drawing. */
export type Diagram = {
  id: string;
  name: string;
  devices: DeviceInstance[];
  connections: Connection[];
  zones: Zone[];
  annotations: Annotation[];
  orientation?: "left-right" | "free";
  /**
   * The ports this diagram exposes when embedded elsewhere as a block (p2-zonetab).
   * Absent ⇒ the diagram isn't embeddable yet. `rev` is a content hash of the port set,
   * bumped only when the boundary actually changes, so embeds can detect drift.
   */
  boundary?: { ports: BoundaryPort[]; rev: number };
  /** Placed references to other diagrams, rendered as blocks. Absent ⇒ none. */
  blocks?: BlockInstance[];
};

/**
 * A placed reference to another Diagram, rendered as a block in the host diagram
 * (p2-zonetab). NOT a Zone — a Zone is decorative; a block is a live reference whose
 * handles are the referenced diagram's boundary ports. The same diagram may be embedded
 * many times as distinct BlockInstances sharing one `refDiagramId`.
 */
export type BlockInstance = {
  /** Unique within the HOST diagram — lives in the host's id-space like a device. */
  id: string;
  refDiagramId: string;
  /** Per-placement label override; defaults to the referenced diagram's name. */
  label?: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  /** Cables route around a block by default; opt out per placement. */
  obstacle?: boolean;
  /** The referenced diagram's `boundary.rev` this block was last bound to (drift check). */
  boundaryRev: number;
};

/**
 * The show's target signal format — the demand ceiling for grade validation.
 * `videoFormat` is the friendly handle AV folks use ("1080p59.94", "2160p59.94")
 * and resolves to image-domain grades (SDI/HDMI/DisplayPort); `targets` carries
 * explicit per-family ceilings for the independent domains (network, USB). Both
 * optional — absent ⇒ grade checks stay paused and the app prompts the user to pick
 * a format rather than guessing. See design/SIGNAL-GRADE.html §3.
 */
export type SignalProfile = {
  videoFormat?: string;
  targets?: Partial<Record<GradeScaleId, GradeId>>;
};

/** A project groups multiple diagrams (Phase 2). */
export type Project = {
  id: string;
  name: string;
  diagrams: Diagram[];
  /** Project-wide signal demand ceiling for grade validation. Added in schema v2. */
  signalProfile?: SignalProfile;
};

/** Root persisted document — the contents of a `.sigpath` file (Phase 1). */
export type SigpathDocument = {
  schemaVersion: number;
  project: Project;
};

/** An empty diagram with sensible defaults. */
export function emptyDiagram(id: string, name: string): Diagram {
  return {
    id,
    name,
    devices: [],
    connections: [],
    zones: [],
    annotations: [],
    orientation: "free",
  };
}
