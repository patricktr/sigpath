import type { SigNode, ZoneNodeType } from "./types";

/**
 * Geometric zone membership — the shared "what's inside this zone?" primitive used by
 * move-with-zone (drag) and promote-to-tab (p2-zonetab). Membership is ephemeral
 * (recomputed from positions), not stored on the nodes, matching the design's choice to
 * defer real parent/child membership (decision 1).
 */

type Rect = { x: number; y: number; w: number; h: number };

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function rectOf(n: SigNode, fallback: { w: number; h: number }): Rect {
  const w = n.measured?.width ?? num(n.width) ?? num(n.style?.width) ?? fallback.w;
  const h = n.measured?.height ?? num(n.height) ?? num(n.style?.height) ?? fallback.h;
  return { x: n.position.x, y: n.position.y, w, h };
}

/**
 * The content nodes whose center lies within the zone's rect — its members. Excludes the
 * zone itself and other zones (only devices, notes, and blocks move/promote as content).
 * Center-point containment keeps it predictable: a node belongs to the zone its middle sits in.
 */
export function nodesInZone(zone: ZoneNodeType, nodes: SigNode[]): SigNode[] {
  const z = rectOf(zone, { w: 280, h: 180 });
  return nodes.filter((n) => {
    if (n.id === zone.id || n.type === "zone") return false;
    const r = rectOf(n, { w: 168, h: 96 });
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
  });
}
