import type { Node, Edge } from "@xyflow/react";
import type { DeviceModel, CableTypeId, GradeId } from "../schema";
import type { Lane } from "./parallelLanes";
import type { Pt } from "./obstacleRoute";

/**
 * React Flow binding types. The domain model lives in `src/schema`; these types
 * map it onto React Flow's node/edge shapes.
 */

export type DeviceNodeData = {
  model: DeviceModel;
  /** Per-placement label override. */
  label?: string;
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

/** Any node on the canvas — a device, a zone, or a note. */
export type SigNode = DeviceNodeType | ZoneNodeType | NoteNodeType;

export type CableEdgeData = {
  cableTypeId: CableTypeId;
  number?: string;
  lengthMeters?: number;
  /** The cable's supported bandwidth rating (persisted; mirrors Connection.cableGrade). */
  cableGrade?: GradeId;
  /** Per-run demand override (persisted; mirrors Connection.signalGrade). */
  signalGrade?: GradeId;
  /** Derived at render time (not persisted): when a cable's two ends differ in
   *  connector color, the source→target colors to stroke it with a gradient. */
  gradient?: { from: string; to: string };
  /** Derived at render time (not persisted): this run's lane within a bundle of
   *  parallel cables sharing a corridor — CableEdge turns it into a jog offset. */
  parallel?: Lane;
  /** Derived at render time (not persisted): interior bend points of an
   *  obstacle-avoiding detour around device boxes. When set, CableEdge draws this
   *  orthogonal path instead of the default smooth-step jog (and ignores `parallel`). */
  waypoints?: Pt[];
};

export type CableEdgeType = Edge<CableEdgeData>;

/** A diagram as held in the editor: React Flow content plus identity. */
export type EditorDiagram = {
  id: string;
  name: string;
  nodes: SigNode[];
  edges: CableEdgeType[];
};
