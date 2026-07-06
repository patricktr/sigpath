import type { DeviceInstance } from "./device";
import type { Connection } from "./connection";
import type { GradeScaleId, GradeId } from "./grades";
import type { BoundaryPort } from "./boundary";
import type { BomRules } from "./bom";
import type { SignalKind } from "./signals";

/**
 * Bumped whenever the persisted shape changes, so a future loader can migrate older
 * `.sigpath` files. v2 (2026-06-22) added the optional `Project.signalProfile` plus
 * optional grade fields on ports and connections. v3 (2026-06-23) added the optional
 * `obstacle` flag on zones and annotations. v4 (2026-06-24) added nested sub-diagrams
 * (p2-zonetab): the optional `Diagram.boundary` (the ports a diagram publishes when
 * embedded) and `Diagram.blocks` (placed references to other diagrams). v5 (2026-06-25)
 * added the optional `Project.revisions` embedded history (p2-revisions). v6 (2026-06-25)
 * added the optional `Diagram.trunks` (collapsible cable bundles, p2-trunk). v7 (2026-07-01)
 * added install-checklist state (p3-cableschedule): the optional `Connection.install` status
 * and the optional `Diagram.bomProgress` received-counts map. v8 (2026-07-01) added the optional
 * `Project.bomRules` (spare/overage policy, p3-bomrules). v9 (2026-07-05) added the optional
 * `Diagram.layouts` — named, user-saved canvas layouts (p2-autoarrangezones). v10 (2026-07-05)
 * introduced content-addressed packing on the WIRE (p2-revdedup): unique device models pool
 * into `project.models` (instances carry `modelRef`), revision snapshot diagrams pool into
 * `project.blobs`, and each revision stores a `manifest` of hash-refs instead of a full
 * `snapshot`. Packing/unpacking lives entirely in io/serialize.ts (packDocument /
 * unpackDocument); in-memory shapes stay fully inflated, and v≤9 files (inline models, full
 * snapshots) still load losslessly.
 */
export const SIGPATH_SCHEMA_VERSION = 10;

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
  /** Collapsible cable bundles (p2-trunk). Absent ⇒ none. */
  trunks?: Trunk[];
  /** Install checklist: received/installed count per device model id (p3-cableschedule).
   *  Absent ⇒ nothing received yet. */
  bomProgress?: Record<string, number>;
  /** Named, user-saved canvas layouts (p2-autoarrangezones). Absent ⇒ none. */
  layouts?: SavedLayout[];
};

/**
 * A named snapshot of where everything sits on the canvas (p2-autoarrangezones): node
 * positions, zone sizes (zones resize when arranged), and manual cable jogs. Applying a
 * layout only moves what it knows about — nodes added after the layout was saved stay put.
 */
export type SavedLayout = {
  id: string;
  name: string;
  positions: Record<string, { x: number; y: number }>;
  /** Zone rect sizes captured with the layout. */
  zoneSizes?: Record<string, { w: number; h: number }>;
  /** Manual lane nudges (Connection.jogOffset) captured with the layout. */
  jogs?: Record<string, number>;
};

/**
 * A bundle of like-cables sharing a corridor, drawn as one labeled spine when `collapsed`
 * (p2-trunk). Membership is BY CONNECTION ID — stable through moves and reroutes — and the
 * geometry is re-derived each render, never stored. The member {@link Connection}s are left
 * untouched, so the pack list / BOM and validation ignore trunks entirely; a trunk is purely
 * a presentation grouping. `signalKind` is the coarse family the members share (all audio,
 * all video…), used to keep a bundle homogeneous.
 */
export type Trunk = {
  id: string;
  memberConnectionIds: string[];
  collapsed: boolean;
  /** Optional user label; defaults to a derived "N × <kind>" caption at render time. */
  label?: string;
  signalKind: SignalKind;
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

/**
 * A point-in-time snapshot of the project's WORKING content — deliberately excludes the
 * revision history itself, so revisions never nest recursively (p2-revisions). v1 stores
 * the full content; a later version may content-hash-dedup it. See design discussion.
 */
export type RevisionSnapshot = {
  name: string;
  diagrams: Diagram[];
  signalProfile?: SignalProfile;
};

/**
 * One entry in the project's revision history. An unnamed revision is an automatic save
 * point (pruned to the most recent N); a `label` marks a named milestone, kept forever.
 */
export type Revision = {
  id: string;
  /** Unix epoch ms when captured. */
  at: number;
  label?: string;
  /** Content hash of `snapshot` — dedupes identical consecutive saves. */
  hash: string;
  snapshot: RevisionSnapshot;
};

/** A project groups multiple diagrams (Phase 2). */
export type Project = {
  id: string;
  name: string;
  diagrams: Diagram[];
  /** Project-wide signal demand ceiling for grade validation. Added in schema v2. */
  signalProfile?: SignalProfile;
  /** Revision history embedded in the file (p2-revisions, schema v5). Absent ⇒ none. */
  revisions?: Revision[];
  /** BOM spare/overage policy (p3-bomrules, schema v8). Absent ⇒ neutral default. */
  bomRules?: BomRules;
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
