/**
 * Parallel-cable routing. Where many cables share a corridor (same axis, near-equal jog
 * X, overlapping spans) their vertical jogs would stack on one line. We cluster such runs
 * and give each a distinct jog-X "track" — choosing the track ORDER that MINIMIZES
 * crossings within the cluster, rather than a fixed top-to-bottom heuristic.
 *
 * For cables converging on one corridor, the minimum number of crossings equals the
 * inversions of the source-order vs target-order permutation (a hard floor). We reach it
 * by brute-forcing the track order for small clusters (the common case), a greedy insert
 * for mid-size, and a directional heuristic for very large single-corridor fans (where
 * the source-order nesting is already optimal). A planar bundle lands at zero crossings;
 * a scrambled one at its inversion floor.
 *
 * assignLanes returns the absolute jog X per clustered cable (App applies it directly;
 * an unclustered run keeps its own midpoint). Geometry is approximated from node
 * positions + port indices in App's displayEdges; only grouping + ordering depend on it.
 */

export type LaneAxis = "h" | "v";

/** A run reduced to what lane-grouping + crossing-min needs. */
export type LaneInput = {
  id: string;
  axis: LaneAxis;
  /** Jog coordinate the cluster spreads around (centerX for "h"). */
  jog: number;
  /** Perpendicular span the run occupies (y-range for "h"). */
  lo: number;
  hi: number;
  /** Full run endpoints — drive the crossing-minimizing track order. */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
};

/** Px the per-lane jogs are spread apart. Small — ports sit one grid cell (24px) apart. Tunable. */
export const LANE_GAP = 18;

/** Two jogs within this many px (with overlapping spans) are the same corridor. */
const JOG_TOL = 40;
/** Brute-force the track order up to this cluster size (k! orderings — exact optimum). */
const BRUTE_MAX = 7;
/** Greedy track order up to this size; above it, the directional heuristic. */
const GREEDY_MAX = 20;

// --- Handle-Y within a device node. Kept in sync with DeviceNode.css, where the
// layout is grid-pitched (App's GRID = 24): 1px border + a 1.5-cell header (35px) +
// half a one-cell port (12) puts the first port center at 2 grid cells (48) from the
// node top; ports then stack one grid cell (24px) apart, landing on background lines.
export const NODE_FIRST_PORT_Y = 48;
export const NODE_PORT_PITCH = 24;
/** Approx vertical center of the i-th port in its column, relative to the node top. */
export const approxPortY = (indexInColumn: number) =>
  NODE_FIRST_PORT_Y + indexInColumn * NODE_PORT_PITCH;

const overlaps = (aLo: number, aHi: number, bLo: number, bHi: number) =>
  aLo < bHi && bLo < aHi;

type Pt = { x: number; y: number };

/** A member's smooth-step "Z": out → vertical jog → in. */
const zRoute = (m: LaneInput, jogX: number): Pt[] => [
  { x: m.sx, y: m.sy },
  { x: jogX, y: m.sy },
  { x: jogX, y: m.ty },
  { x: m.tx, y: m.ty },
];

/** Proper orthogonal crossings between two routes (strict interior of both). */
function routeCrossings(a: Pt[], b: Pt[]): number {
  let n = 0;
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const a1 = a[i];
      const a2 = a[i + 1];
      const b1 = b[j];
      const b2 = b[j + 1];
      const aH = Math.abs(a1.y - a2.y) <= 0.5;
      const bH = Math.abs(b1.y - b2.y) <= 0.5;
      if (aH === bH) continue;
      const h0 = aH ? a1 : b1;
      const h1 = aH ? a2 : b2;
      const v0 = aH ? b1 : a1;
      const v1 = aH ? b2 : a2;
      if (
        v0.x > Math.min(h0.x, h1.x) + 0.5 &&
        v0.x < Math.max(h0.x, h1.x) - 0.5 &&
        h0.y > Math.min(v0.y, v1.y) + 0.5 &&
        h0.y < Math.max(v0.y, v1.y) - 0.5
      ) {
        n++;
      }
    }
  }
  return n;
}

/** Crossings for a cluster laid out in a given left→right member order. */
function orderCrossings(members: LaneInput[], order: number[], base: number): number {
  const routes = order.map((mi, pos) =>
    zRoute(members[mi], base + (pos - (order.length - 1) / 2) * LANE_GAP),
  );
  let n = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) n += routeCrossings(routes[i], routes[j]);
  }
  return n;
}

/** All permutations of [0..n-1] (used only for small clusters). */
function permutations(n: number): number[][] {
  if (n <= 1) return [[...Array(n).keys()]];
  const out: number[][] = [];
  const rec = (cur: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(cur);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      rec([...cur, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  };
  rec([], [...Array(n).keys()]);
  return out;
}

/** The crossing-minimizing left→right track order for a cluster (member indices). */
function bestOrder(members: LaneInput[], base: number): number[] {
  const n = members.length;
  const idx = members.map((_, i) => i);

  if (n <= BRUTE_MAX) {
    let best = Infinity;
    let bestOrder = idx;
    for (const p of permutations(n)) {
      const c = orderCrossings(members, p, base);
      if (c < best) {
        best = c;
        bestOrder = p;
        if (best === 0) break;
      }
    }
    return bestOrder;
  }

  if (n <= GREEDY_MAX) {
    // Insert cables (seeded by source Y) one at a time at the position adding the fewest
    // crossings — near-optimal without the k! cost.
    const seed = [...idx].sort((a, b) => members[a].sy - members[b].sy || (members[a].id < members[b].id ? -1 : 1));
    let order: number[] = [];
    for (const mi of seed) {
      let bestPos = 0;
      let bestC = Infinity;
      for (let pos = 0; pos <= order.length; pos++) {
        const cand = [...order.slice(0, pos), mi, ...order.slice(pos)];
        const c = orderCrossings(members, cand, base);
        if (c < bestC) {
          bestC = c;
          bestPos = pos;
        }
      }
      order = [...order.slice(0, bestPos), mi, ...order.slice(bestPos)];
    }
    return order;
  }

  // Very large fan (e.g. a fully-patched router): order by source Y, flipped when the
  // bundle runs downward — optimal for a single-corridor fan, O(n log n).
  const order = [...idx].sort(
    (a, b) => members[a].sy - members[b].sy || (members[a].id < members[b].id ? -1 : 1),
  );
  const downSum = members.reduce((s, m) => s + (m.ty > m.sy ? 1 : -1), 0);
  if (downSum > 0) order.reverse();
  return order;
}

/**
 * Cluster runs sharing a corridor and assign each a jog-X track that minimizes crossings.
 * Returns the absolute jog X per clustered cable; unclustered runs are omitted (the
 * caller keeps their own midpoint). O(n²) clustering; per-cluster cost bounded by the
 * brute/greedy caps. Deterministic.
 */
export function assignLanes(inputs: LaneInput[]): Map<string, number> {
  const n = inputs.length;
  const parent = inputs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = inputs[i];
      const b = inputs[j];
      if (a.axis === b.axis && Math.abs(a.jog - b.jog) <= JOG_TOL && overlaps(a.lo, a.hi, b.lo, b.hi)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const jogX = new Map<string, number>();
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const members = idxs.map((i) => inputs[i]);
    const base = members.reduce((s, m) => s + m.jog, 0) / members.length;
    const order = bestOrder(members, base);
    order.forEach((mi, pos) => {
      jogX.set(members[mi].id, base + (pos - (order.length - 1) / 2) * LANE_GAP);
    });
  }
  return jogX;
}
