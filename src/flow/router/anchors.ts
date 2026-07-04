import { Position } from "@xyflow/react";
import { isPortBearing } from "../types";
import type { SigNode } from "../types";
import type { PortAnchor, PortAnchors, PortSide } from "./types";

/** The slice of React Flow's InternalNode we read — structural, so the store's untyped
 *  `NodeLookup<InternalNode<Node>>` passes without a variance fight. */
type HandleRect = { id?: string | null; position: Position; x: number; y: number; width: number; height: number };
type MeasuredInternal = {
  internals: {
    positionAbsolute: { x: number; y: number };
    handleBounds?: { source: HandleRect[] | null; target: HandleRect[] | null } | null;
  };
};

/**
 * Extract MEASURED port anchors from React Flow's internal node lookup — the real handle
 * centers CableEdge draws from (`internals.handleBounds`), in canvas coordinates. This is
 * the single fix for the estimated-vs-measured seam: the router (and hop detection, which
 * runs on the router's `ends`) works on exactly the geometry that ends up on screen, so
 * crossing bumps land on the drawn wires instead of on the estimate's ghost.
 *
 * Unmeasured nodes (first frame, or the headless harness where there is no DOM) are simply
 * absent from the map and fall back to the router's estimates per-port.
 */
const SIDE_OF: Record<string, PortSide> = {
  [Position.Left]: "L",
  [Position.Right]: "R",
  [Position.Top]: "T",
  [Position.Bottom]: "B",
};

export function measuredPortAnchors(
  nodeLookup: Map<string, MeasuredInternal> | undefined,
  nodes: SigNode[],
): PortAnchors | undefined {
  if (!nodeLookup) return undefined;
  const out: PortAnchors = new Map();
  for (const n of nodes) {
    if (!isPortBearing(n)) continue;
    const internal = nodeLookup.get(n.id);
    const hb = internal?.internals.handleBounds;
    if (!internal || !hb) continue;
    const origin = internal.internals.positionAbsolute;
    const anchors = new Map<string, PortAnchor>();
    for (const role of ["source", "target"] as const) {
      for (const h of hb[role] ?? []) {
        if (!h.id) continue;
        anchors.set(`${role}:${h.id}`, {
          x: origin.x + h.x + h.width / 2,
          y: origin.y + h.y + h.height / 2,
          side: SIDE_OF[h.position] ?? (role === "source" ? "R" : "L"),
        });
      }
    }
    if (anchors.size) out.set(n.id, anchors);
  }
  return out.size ? out : undefined;
}
