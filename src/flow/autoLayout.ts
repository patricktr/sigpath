import type { CableEdgeType, SigNode } from "./types";

const COL_WIDTH = 300;
const ROW_GAP = 40;

/**
 * Lay device nodes out left-to-right by signal flow: sources in the leftmost
 * column, each downstream device one column to the right. Columns come from a
 * longest-path ranking over the cable connections (bounded so cycles can't loop
 * forever). Zones and notes are left where the user put them.
 */
export function arrangeLeftToRight(nodes: SigNode[], edges: CableEdgeType[]): SigNode[] {
  const devices = nodes.filter((n) => n.type === "device");
  if (devices.length === 0) return nodes;

  const deviceIds = new Set(devices.map((d) => d.id));
  const flowEdges = edges.filter(
    (e) => e.source !== e.target && deviceIds.has(e.source) && deviceIds.has(e.target),
  );

  // Longest-path layering: relax rank[target] = max(rank[source] + 1), capped at
  // |V| iterations (exact for DAGs; bounded for the rare feedback loop).
  const rank = new Map<string, number>();
  devices.forEach((d) => rank.set(d.id, 0));
  for (let iter = 0; iter < devices.length; iter++) {
    let changed = false;
    for (const e of flowEdges) {
      const next = (rank.get(e.source) ?? 0) + 1;
      if (next > (rank.get(e.target) ?? 0)) {
        rank.set(e.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group by column, keeping each column's existing top-to-bottom order.
  const columns = new Map<number, SigNode[]>();
  for (const d of devices) {
    const r = rank.get(d.id) ?? 0;
    const col = columns.get(r);
    if (col) col.push(d);
    else columns.set(r, [d]);
  }
  for (const col of columns.values()) {
    col.sort((a, b) => a.position.y - b.position.y);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [r, col] of columns) {
    let y = 0;
    for (const d of col) {
      positions.set(d.id, { x: r * COL_WIDTH, y });
      y += (d.measured?.height ?? 100) + ROW_GAP;
    }
  }

  return nodes.map((n) =>
    n.type === "device" && positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n,
  );
}
