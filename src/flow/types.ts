import type { Node, Edge } from "@xyflow/react";
import type { DeviceModel, CableTypeId, GradeId, BoundaryPort, Port, Trunk, InstallStatus } from "../schema";
import type { Pt } from "./obstacleRoute";
import type { Hop } from "./cableHops";

/**
 * React Flow binding types. The domain model lives in `src/schema`; these types
 * map it onto React Flow's node/edge shapes.
 */

export type DeviceNodeData = {
  model: DeviceModel;
  /** Per-placement label override. */
  label?: string;
  /** Per-output-port signal cap (p2-deepgrade), keyed by Port.id — see DeviceInstance.signalPins. */
  signalPins?: Record<string, GradeId>;
};

export type DeviceNodeType = Node<DeviceNodeData, "device">;

/** A labeled, colored region that groups devices behind the canvas. */
export type ZoneData = {
  label: string;
  color: string;
  /** Opt-in: cables route around this region instead of through it. Default off. */
  obstacle?: boolean;
};

export type ZoneNodeType = Node<ZoneData, "zone">;

/** A free-floating Markdown text annotation on the canvas. */
export type NoteData = {
  text: string;
  /** Opt-in: cables route around this note instead of through it. Default off. */
  obstacle?: boolean;
};

export type NoteNodeType = Node<NoteData, "note">;

/**
 * A placed reference to another diagram, rendered as a block (p2-zonetab). Its handles
 * are the referenced diagram's boundary ports. `model` is SYNTHESIZED from that boundary
 * set at load/render time — `model.ports` are the boundary ports — so every consumer that
 * reads `data.model.ports` (validate, derive, cableId) resolves a block exactly as a
 * device, behind one shared seam. See design/ZONE-TAB.html.
 */
export type BlockNodeData = {
  refDiagramId: string;
  /** Per-placement label override; defaults to the referenced diagram's name. */
  label?: string;
  /** Synthesized from the referenced diagram's `boundary.ports`; not persisted as-is. */
  model: DeviceModel;
  /** The referenced diagram's `boundary.rev` this block was bound to. */
  boundaryRev: number;
  /** Derived (not persisted): boundaryRev is behind the referenced diagram's live rev. */
  drift?: boolean;
  /** Cables route around a block by default; opt out per placement. */
  obstacle?: boolean;
};

export type BlockNodeType = Node<BlockNodeData, "block">;

/** Any node on the canvas — a device, a zone, a note, or a nested-diagram block. */
export type SigNode = DeviceNodeType | ZoneNodeType | NoteNodeType | BlockNodeType;

/** Nodes that carry connectable ports — a real device or a nested-diagram block. Both
 *  hold their ports at `data.model.ports` (a block's are synthesized from the referenced
 *  diagram's boundary), so every consumer resolves a cable endpoint through them
 *  uniformly. This is the single seam that keeps validate / derive / cableId / routing
 *  from forking a separate block path. See design/ZONE-TAB.html. */
export type PortBearingNode = DeviceNodeType | BlockNodeType;

/** True for a device or block node (handles undefined/null so call sites stay terse). */
export function isPortBearing(n: SigNode | undefined | null): n is PortBearingNode {
  return !!n && (n.type === "device" || n.type === "block");
}

/** The ports a node exposes — empty for zones, notes, and missing nodes. */
export function nodePorts(n: SigNode | undefined | null): Port[] {
  return isPortBearing(n) ? n.data.model.ports : [];
}

export type CableEdgeData = {
  cableTypeId: CableTypeId;
  number?: string;
  lengthMeters?: number;
  /** Free-text cable-schedule note (persisted; mirrors Connection.note). */
  note?: string;
  /** Install-tracking status (persisted; mirrors Connection.install). Off the undo stack. */
  install?: InstallStatus;
  /** The cable's supported bandwidth rating (persisted; mirrors Connection.cableGrade). */
  cableGrade?: GradeId;
  /** Per-run demand override (persisted; mirrors Connection.signalGrade). */
  signalGrade?: GradeId;
  /** Manual routing override (persisted): vertical-jog X relative to the run midpoint.
   *  Set ⇒ the run is pinned there and drops out of the auto crossing-minimizer. */
  jogOffset?: number;
  /** Derived at render time (not persisted): when a cable's two ends differ in
   *  connector color, the source→target colors to stroke it with a gradient. */
  gradient?: { from: string; to: string };
  /** Derived at render time (not persisted): interior bend points of an
   *  obstacle-avoiding detour around device boxes. When set, CableEdge draws this
   *  orthogonal path instead of the default smooth-step jog (and ignores `parallel`). */
  waypoints?: Pt[];
  /** Derived at render time (not persisted): points on this cable's horizontal runs where it
   *  bumps over a crossing cable (p2-crossinghops) — the "passes over" schematic convention. */
  hops?: Hop[];
};

export type CableEdgeType = Edge<CableEdgeData>;

/** A diagram as held in the editor: React Flow content plus identity. */
export type EditorDiagram = {
  id: string;
  name: string;
  nodes: SigNode[];
  edges: CableEdgeType[];
  /** Ports this diagram publishes when embedded as a block (p2-zonetab). Diagram-level
   *  metadata — not a node — so it rides here and round-trips through serialize. The
   *  spread in useProject's synced() preserves it across canvas edits. */
  boundary?: { ports: BoundaryPort[]; rev: number };
  /** Collapsible cable bundles (p2-trunk). Diagram-level metadata like `boundary`. */
  trunks?: Trunk[];
  /** Install checklist: received/installed count per device model id (p3-cableschedule).
   *  Diagram-level like `trunks`; off the undo stack. Absent ⇒ nothing received yet. */
  bomProgress?: Record<string, number>;
};
