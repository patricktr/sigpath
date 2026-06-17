import type { Node, Edge } from "@xyflow/react";
import type { DeviceModel, CableTypeId } from "../schema";

/**
 * React Flow binding types. The domain model lives in `src/schema`; these types
 * map it onto React Flow's node/edge shapes. A node's id and position live on
 * the Node itself, so the data payload only carries the device-specific bits.
 */

export type DeviceNodeData = {
  model: DeviceModel;
  /** Per-placement label override. */
  label?: string;
};

export type DeviceNodeType = Node<DeviceNodeData, "device">;

export type CableEdgeData = {
  cableTypeId: CableTypeId;
  number?: string;
  lengthMeters?: number;
};

export type CableEdgeType = Edge<CableEdgeData>;
