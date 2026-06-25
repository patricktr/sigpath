import type { CableEdgeType, SigNode, ZoneNodeType } from "./types";
import { isPortBearing } from "./types";
import { pickRouter } from "./router";
import { polylinesFromResult, totalCrossings } from "./routeMetrics";
import { nodesInZone } from "./zoneMembership";
import { LANE_GAP } from "./parallelLanes";
import { OBSTACLE_MARGIN } from "./obstacleRoute";

/**
 * "Make room / Tidy" (p2-makeroom) — the opt-in, arrangement-preserving counterpart to
 * auto-layout. It does NOT re-lay-out the diagram; it only widens the vertical channels
 * between device columns where the router can't fan the cables into lanes without crowding,
 * by shifting the right-hand column groups apart on the grid. Reroute is free (applying the
 * positions re-runs the router on the next render). A crossing guard refuses any proposal
 * that would increase total crossings, honoring the "never regress" rule. See design §5.
 *
 * Congestion is read from the router's OWN output polylines (no RoutingReport dependency):
 * a channel is congested when the number of cable jogs sharing it needs more lane width than
 * the gap between the two columns provides.
 */

const GRID = 24;
const COL_TOL = 120; // device left-edges within this X band are the same visual column
const MAX_TIDY_SHIFT = 144; // cap per channel (6 grid cells) so one pass can't fling devices
const LANE_CLEAR = OBSTACLE_MARGIN; // keep the lane fan this far off each flanking device edge

type Col = { left: number; right: number; ids: string[] };

/** Cluster device/block nodes into visual columns by left-edge X. Sorted left→right. */
export function deriveColumns(nodes: SigNode[]): Col[] {
  const boxes = nodes
    .filter(isPortBearing)
    .map((n) => ({ id: n.id, x: n.position.x, w: n.measured?.width ?? n.width ?? 168 }))
    .sort((a, b) => a.x - b.x);
  const cols: Col[] = [];
  for (const b of boxes) {
    const last = cols[cols.length - 1];
    if (last && b.x - last.left <= COL_TOL) {
      last.ids.push(b.id);
      last.right = Math.max(last.right, b.x + b.w);
    } else {
      cols.push({ left: b.x, right: b.x + b.w, ids: [b.id] });
    }
  }
  return cols;
}

/** The vertical-segment X positions of a polyline (where it occupies a channel's lane width). */
function verticalXs(pts: { x: number; y: number }[]): number[] {
  const xs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (Math.abs(pts[i].x - pts[i + 1].x) <= 0.5 && Math.abs(pts[i].y - pts[i + 1].y) > 0.5) xs.push(pts[i].x);
  }
  return xs;
}

export type MakeRoomPlan = {
  shifts: Map<string, { x: number; y: number }>;
  channelsWidened: number;
  cablesAffected: number;
};

export type MakeRoomResult =
  | { kind: "none" }
  | { kind: "refused"; addedCrossings: number }
  | ({ kind: "ok" } & MakeRoomPlan);

/**
 * Plan a tidy pass. Returns `none` when no channel is congested, `refused` when widening would
 * add crossings, or an `ok` plan with the per-node target positions (devices + the zones that
 * ride along with them). Pure: runs the active router twice (before/after) but mutates nothing.
 */
export function planMakeRoom(nodes: SigNode[], edges: CableEdgeType[]): MakeRoomResult {
  const cols = deriveColumns(nodes);
  if (cols.length < 2) return { kind: "none" };

  const router = pickRouter();
  const basePolys = polylinesFromResult(router.route({ nodes, edges }));

  // Channels = the gaps between adjacent columns. Assign each cable's vertical jog to its
  // NEAREST channel (so lanes that spill past a too-narrow gap — the very thing we fix — still
  // count toward that channel's demand). Demand = distinct cables jogging in the channel.
  const channels = cols.slice(0, -1).map((c, i) => ({
    left: c.right,
    right: cols[i + 1].left,
    center: (c.right + cols[i + 1].left) / 2,
  }));
  const demandSets = channels.map(() => new Set<string>());
  for (const p of basePolys) {
    for (const x of verticalXs(p.pts)) {
      let best = -1;
      let bestD = Infinity;
      channels.forEach((ch, i) => {
        const d = Math.abs(x - ch.center);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) demandSets[best].add(p.id);
    }
  }

  let cablesAffected = 0;
  let channelsWidened = 0;
  let cumulativeDx = 0;
  const colDx = new Array(cols.length).fill(0); // extra X applied to column i and everything right
  channels.forEach((ch, i) => {
    const demand = demandSets[i].size;
    // Lane fan of `demand` runs spans (demand-1)*LANE_GAP and wants LANE_CLEAR off each edge.
    const avail = ch.right - ch.left - 2 * LANE_CLEAR;
    const need = (demand - 1) * LANE_GAP - avail;
    if (demand >= 2 && need > 0) {
      cumulativeDx += Math.min(MAX_TIDY_SHIFT, Math.ceil(need / GRID) * GRID);
      channelsWidened++;
      cablesAffected += demand;
    }
    colDx[i + 1] = cumulativeDx; // columns i+1.. shift by the accumulated widening
  });

  if (channelsWidened === 0) return { kind: "none" };

  // Per-node dx: a device gets its column's dx; a zone rides along with the dx of the majority
  // of its members; notes stay put.
  const dxByNode = new Map<string, number>();
  cols.forEach((c, i) => {
    if (colDx[i]) for (const id of c.ids) dxByNode.set(id, colDx[i]);
  });
  for (const n of nodes) {
    if (n.type !== "zone") continue;
    const members = nodesInZone(n as ZoneNodeType, nodes);
    if (!members.length) continue;
    const tally = new Map<number, number>();
    for (const m of members) {
      const dx = dxByNode.get(m.id) ?? 0;
      tally.set(dx, (tally.get(dx) ?? 0) + 1);
    }
    let best = 0;
    let bestN = -1;
    for (const [dx, cnt] of tally) if (cnt > bestN) { bestN = cnt; best = dx; }
    if (best) dxByNode.set(n.id, best);
  }

  const shifts = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const dx = dxByNode.get(n.id);
    if (!dx) continue;
    shifts.set(n.id, { x: Math.round((n.position.x + dx) / GRID) * GRID, y: n.position.y });
  }

  // Crossing guard: re-route with the shifted positions and refuse if crossings rise.
  const shifted = nodes.map((n) => (shifts.has(n.id) ? { ...n, position: shifts.get(n.id)! } : n));
  const before = totalCrossings(basePolys.map((p) => p.pts));
  const after = totalCrossings(polylinesFromResult(router.route({ nodes: shifted, edges })).map((p) => p.pts));
  if (after > before) return { kind: "refused", addedCrossings: after - before };

  return { kind: "ok", shifts, channelsWidened, cablesAffected };
}
