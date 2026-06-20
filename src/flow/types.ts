import type { Node, Edge } from "@xyflow/react";
import type { DeviceModel, CableTypeId } from "../schema";

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
};

export type ZoneNodeType = Node<ZoneData, "zone">;

/** A free-floating Markdown text annotation on the canvas. */
export type NoteData = {
  text: string;
};

export type NoteNodeType = Node<NoteData, "note">;

/** Any node on the canvas — a device, a zone, or a note. */
export type SigNode = DeviceNodeType | ZoneNodeType | NoteNodeType;

export type CableEdgeData = {
  cableTypeId: CableTypeId;
  number?: string;
  lengthMeters?: number;
  /** Derived at render time (not persisted): when a cable's two ends differ in
   *  connector color, the source→target colors to stroke it with a gradient. */
  gradient?: { from: string; to: string };
};

export type CableEdgeType = Edge<CableEdgeData>;

/** A diagram as held in the editor: React Flow content plus identity. */
export type EditorDiagram = {
  id: string;
  name: string;
  nodes: SigNode[];
  edges: CableEdgeType[];
};
