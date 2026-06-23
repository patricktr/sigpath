/**
 * Orthogonal obstacle-avoiding cable routing.
 *
 * The default cable is a 3-segment Z (out → vertical jog → in). When a device box
 * sits across that Z, the cable draws straight through it. This module reroutes
 * *only those blocked cables* around the boxes, leaving every clear cable on the
 * fast default path (so the parallel-lane de-overlap and today's look are kept for
 * the common case — see parallelLanes.ts).
 *
 * The router is a fewest-bends orthogonal A* over a sparse "boundary grid": the only
 * candidate gridlines are the inflated edges of the obstacles plus the two ports and
 * their stubs (a Hanan grid). That keeps the search graph O(obstacles²) instead of a
 * pixel grid, and biasing the cost by turns-first/length-second yields clean L/U/Z
 * detours that hug the boxes with a margin of clearance. Pure + deterministic.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

/** Clearance kept around each box (px). Cables run this far off a box edge. */
export const OBSTACLE_MARGIN = 16;
/** How far a cable runs straight out of a port before it may turn (px). */
const PORT_STUB = 22;
/** Cost added per 90° bend — far larger than any pixel length so A* minimizes
 *  bends first, then total length. Keeps detours to clean rectilinear shapes. */
const TURN_COST = 100_000;
/** Bail out (fall back to the straight route) above this many in-play obstacles,
 *  so a pathological diagram can't stall the render. Grids stay small in practice. */
const MAX_OBSTACLES = 40;
/** Px that overlapping parallel detour runs are fanned apart (mirrors LANE_GAP). */
const DETOUR_GAP = 14;
/** Keep a fanned run at least this far off an obstacle it's threading beside. */
const DETOUR_CLEAR = 6;
/** Coords within this are the "same" trunk line for de-overlap grouping. */
const TRUNK_TOL = 2;

const inflate = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  w: r.w + 2 * m,
  h: r.h + 2 * m,
});

/** Is point `p` inside rect `r`? Used to drop a region-obstacle for a cable that
 *  starts or ends inside it (it can't be avoided — an endpoint sits within). */
export function rectContains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

const uniqSorted = (xs: number[]): number[] => {
  const s = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (out.length === 0 || Math.abs(out[out.length - 1] - v) > 0.5) out.push(v);
  return out;
};

/**
 * Does an axis-aligned segment cross any obstacle's interior? Boundary-hugging is
 * allowed (strict inequalities): a segment running along an inflated edge has real
 * clearance, so it must not count as a hit, or the grid would have no legal moves.
 */
export function segmentHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rects: Rect[],
): boolean {
  const xlo = Math.min(ax, bx);
  const xhi = Math.max(ax, bx);
  const ylo = Math.min(ay, by);
  const yhi = Math.max(ay, by);
  for (const r of rects) {
    const rx2 = r.x + r.w;
    const ry2 = r.y + r.h;
    // Overlap of the segment's bbox with the OPEN rectangle (strict on all sides).
    if (xlo < rx2 && r.x < xhi && ylo < ry2 && r.y < yhi) return true;
  }
  return false;
}

/** The default Z route's three segments, for blockage testing. */
export function defaultRoutePoints(from: Pt, to: Pt, jogX: number): Pt[] {
  return [from, { x: jogX, y: from.y }, { x: jogX, y: to.y }, to];
}

/** True if the polyline crosses any rect interior (used to decide whether to reroute). */
export function pathHitsObstacle(points: Pt[], rects: Rect[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentHitsRect(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, rects)) {
      return true;
    }
  }
  return false;
}

type AStarNode = { i: number; j: number; axis: 0 | 1 }; // axis: 0 horizontal arrival, 1 vertical

/**
 * Route from `from` (a source port, exits +x) to `to` (a target port, enters from
 * −x) around `obstacles` (already the per-edge set: every device box except this
 * cable's own two). Returns the INTERIOR waypoints (bend points, excluding the two
 * ports) for a clean orthogonal detour, or null if no detour is needed or none is
 * found (caller falls back to the default route).
 *
 * Obstacles are inflated by OBSTACLE_MARGIN here; pass raw device rects.
 */
export function routeAroundObstacles(from: Pt, to: Pt, obstacles: Rect[]): Pt[] | null {
  // Only boxes within the horizontal corridor can block a rightward run; a path that
  // advances from `from.x` to `to.x` never needs to consider boxes fully left/right
  // of the span. Keeps the grid tiny.
  const xMin = Math.min(from.x, to.x);
  const xMax = Math.max(from.x, to.x);
  const inflated = obstacles
    .map((r) => inflate(r, OBSTACLE_MARGIN))
    .filter((r) => r.x + r.w > xMin && r.x < xMax);

  if (inflated.length === 0 || inflated.length > MAX_OBSTACLES) return null;

  // Stubs: the path leaves/enters the ports straight before it may turn.
  const sx = from.x + PORT_STUB;
  const tx = to.x - PORT_STUB;
  if (tx <= sx) return null; // ports too close to route cleanly — keep default.

  // Boundary grid: obstacle edges + ports/stubs.
  const xsRaw = [from.x, sx, tx, to.x];
  const ysRaw = [from.y, to.y];
  for (const r of inflated) {
    xsRaw.push(r.x, r.x + r.w);
    ysRaw.push(r.y, r.y + r.h);
  }
  const xs = uniqSorted(xsRaw);
  const ys = uniqSorted(ysRaw);
  const nx = xs.length;
  const ny = ys.length;
  const xi = (v: number) => xs.findIndex((x) => Math.abs(x - v) <= 0.5);
  const yi = (v: number) => ys.findIndex((y) => Math.abs(y - v) <= 0.5);

  const startI = xi(sx);
  const startJ = yi(from.y);
  const goalI = xi(tx);
  const goalJ = yi(to.y);
  if (startI < 0 || startJ < 0 || goalI < 0 || goalJ < 0) return null;

  // A* over (gridX, gridY, arrivalAxis). Turn cost dominates length.
  const key = (i: number, j: number, axis: number) => (i * ny + j) * 2 + axis;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const heap: { f: number; node: AStarNode }[] = [];
  const push = (f: number, node: AStarNode) => {
    // Tiny binary heap.
    heap.push({ f, node });
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p].f <= heap[c].f) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = 2 * c + 2;
        let m = c;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[goalI]) + Math.abs(ys[j] - ys[goalJ]);

  // The cable arrives at the start having moved +x along the stub → horizontal axis.
  const startKey = key(startI, startJ, 0);
  gScore.set(startKey, 0);
  push(h(startI, startJ), { i: startI, j: startJ, axis: 0 });

  let found: AStarNode | null = null;
  const seen = new Set<number>();
  while (heap.length > 0) {
    const { node } = pop();
    const k = key(node.i, node.j, node.axis);
    if (seen.has(k)) continue;
    seen.add(k);
    if (node.i === goalI && node.j === goalJ) {
      found = node;
      break;
    }
    const g = gScore.get(k)!;
    // Four orthogonal neighbours.
    const steps: { di: number; dj: number; axis: 0 | 1 }[] = [
      { di: 1, dj: 0, axis: 0 },
      { di: -1, dj: 0, axis: 0 },
      { di: 0, dj: 1, axis: 1 },
      { di: 0, dj: -1, axis: 1 },
    ];
    for (const s of steps) {
      const ni = node.i + s.di;
      const nj = node.j + s.dj;
      if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) continue;
      if (segmentHitsRect(xs[node.i], ys[node.j], xs[ni], ys[nj], inflated)) continue;
      const len = Math.abs(xs[ni] - xs[node.i]) + Math.abs(ys[nj] - ys[node.j]);
      const turn = s.axis !== node.axis ? TURN_COST : 0;
      const ng = g + len + turn;
      const nk = key(ni, nj, s.axis);
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        cameFrom.set(nk, k);
        push(ng + h(ni, nj), { i: ni, j: nj, axis: s.axis });
      }
    }
  }
  if (!found) return null;

  // Reconstruct grid points start→goal.
  const pts: Pt[] = [];
  let cur: number | undefined = key(found.i, found.j, found.axis);
  while (cur !== undefined) {
    const flat = Math.floor(cur / 2);
    const i = Math.floor(flat / ny);
    const j = flat % ny;
    pts.push({ x: xs[i], y: ys[j] });
    cur = cameFrom.get(cur);
  }
  pts.reverse();

  // Bookend with the actual ports (stub ends are the first/last grid points).
  const full: Pt[] = [from, ...pts, to];
  const simplified = simplifyOrthogonal(full);

  // Sanity: never hand back a path that still clips a box.
  if (pathHitsObstacle(simplified, inflated)) return null;

  // Interior bend points only (drop the two ports the caller already has).
  const interior = simplified.slice(1, -1);
  return interior.length ? interior : null;
}

// --- Rendering geometry (shared with CableEdge) -----------------------------

const manhattan = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** A point `r` from `corner` toward `toward` (segments are axis-aligned). */
function towards(corner: Pt, toward: Pt, r: number): Pt {
  const dx = toward.x - corner.x;
  const dy = toward.y - corner.y;
  const len = Math.abs(dx) + Math.abs(dy) || 1;
  return { x: corner.x + (dx / len) * r, y: corner.y + (dy / len) * r };
}

/** Rounded-corner SVG path string through an orthogonal polyline. */
export function orthogonalPathD(points: Pt[], radius: number): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p = points[i];
    const p1 = points[i + 1];
    const r = Math.min(radius, manhattan(p0, p) / 2, manhattan(p, p1) / 2);
    const a = towards(p, p0, r);
    const b = towards(p, p1, r);
    d += ` L ${a.x},${a.y} Q ${p.x},${p.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/** Midpoint of an orthogonal polyline by arc length (where the cable ID rides). */
export function polylineMidpoint(points: Pt[]): Pt {
  const segLen = points.slice(1).map((p, i) => manhattan(points[i], p));
  const total = segLen.reduce((s, l) => s + l, 0);
  let half = total / 2;
  for (let i = 0; i < segLen.length; i++) {
    if (half <= segLen[i]) {
      const t = segLen[i] === 0 ? 0 : half / segLen[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    half -= segLen[i];
  }
  return points[points.length - 1];
}

/** Drop collinear midpoints and exact duplicates from an orthogonal polyline. */
export function simplifyOrthogonal(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) <= 0.5 && Math.abs(last.y - p.y) <= 0.5) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const abH = Math.abs(a.y - b.y) <= 0.5;
      const bpH = Math.abs(b.y - p.y) <= 0.5;
      const abV = Math.abs(a.x - b.x) <= 0.5;
      const bpV = Math.abs(b.x - p.x) <= 0.5;
      if ((abH && bpH) || (abV && bpV)) {
        out[out.length - 1] = p; // b was collinear — replace it
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

// --- Detour-bundle de-overlap --------------------------------------------------

/** One straight run of a routed detour, reduced to what de-overlap grouping needs. */
type SegRef = {
  id: string;
  /** Index of this segment's first point within its route's point list. */
  pi: number;
  /** Shared coordinate of the run (x for a vertical run, y for a horizontal one). */
  pos: number;
  /** The run's span along its own axis (y-range for vertical, x-range for horizontal). */
  lo: number;
  hi: number;
  /** The whole cable's vertical centre (mean of its two port Ys) — a single value per
   *  cable so it keeps a consistent lane across every cluster it threads (no self-cross). */
  rank: number;
};

const overlap1d = (aLo: number, aHi: number, bLo: number, bHi: number) =>
  aLo < bHi - 0.5 && bLo < aHi - 0.5;

/** A proper orthogonal crossing of two axis-aligned segments (strict interior of both)?
 *  Parallel/collinear runs never count — those are the merges the spread itself removes. */
function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const aH = Math.abs(a1.y - a2.y) <= 0.5;
  const bH = Math.abs(b1.y - b2.y) <= 0.5;
  if (aH === bH) return false;
  const [h0, h1] = aH ? [a1, a2] : [b1, b2];
  const [v0, v1] = aH ? [b1, b2] : [a1, a2];
  const hy = h0.y;
  const vx = v0.x;
  return (
    vx > Math.min(h0.x, h1.x) + 0.5 &&
    vx < Math.max(h0.x, h1.x) - 0.5 &&
    hy > Math.min(v0.y, v1.y) + 0.5 &&
    hy < Math.max(v0.y, v1.y) - 0.5
  );
}

/** Count proper crossings between the runs of different cables in a bundle. */
function countBundleCrossings(paths: Pt[][]): number {
  const segs = paths.map((p) => p.slice(1).map((q, i) => [p[i], q] as [Pt, Pt]));
  let n = 0;
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      for (const a of segs[i]) for (const b of segs[j]) if (segmentsCross(a[0], a[1], b[0], b[1])) n++;
    }
  }
  return n;
}

/**
 * Fan overlapping parallel detour runs apart so a bundle routing around the same box
 * reads as separate lines instead of one merged trunk — the lane idea (parallelLanes.ts)
 * generalized to arbitrary routed segments. Operates on the full routed polylines
 * (ports included) and returns adjusted INTERIOR waypoints per cable.
 *
 * Each cluster of collinear, perpendicular-overlapping runs is spread perpendicular to
 * itself. The spread window is packed into whatever free space the flanking obstacles
 * leave (away from a wall, symmetric when clear, compressed if pinched), so a fanned run
 * never crosses into a box. Port stubs (first/last run of each path) are never moved, so
 * the cables stay anchored to their ports. Shifting a run only lengthens the horizontals
 * that meet it; H/V runs alternate, so each point takes at most one x- and one y-shift.
 */
export function spreadDetourBundles(
  routes: { id: string; pts: Pt[] }[],
  deviceRects: Rect[],
): Map<string, Pt[]> {
  const infl = deviceRects.map((r) => inflate(r, OBSTACLE_MARGIN));
  // Work on a mutable copy of the points so each cluster can be applied + measured in place.
  const work = routes.map((r) => ({ id: r.id, pts: r.pts.map((p) => ({ ...p })) }));
  const ptsById = new Map(work.map((w) => [w.id, w.pts]));

  const collect = (axis: "v" | "h"): SegRef[] => {
    const segs: SegRef[] = [];
    for (const r of work) {
      const rank = (r.pts[0].y + r.pts[r.pts.length - 1].y) / 2;
      // Skip the first/last run (port stubs) so ports stay put.
      for (let i = 1; i < r.pts.length - 2; i++) {
        const a = r.pts[i];
        const b = r.pts[i + 1];
        const isV = Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) > 0.5;
        const isH = Math.abs(a.y - b.y) <= 0.5 && Math.abs(a.x - b.x) > 0.5;
        if (axis === "v" && isV) {
          segs.push({ id: r.id, pi: i, pos: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), rank });
        } else if (axis === "h" && isH) {
          segs.push({ id: r.id, pi: i, pos: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), rank });
        }
      }
    }
    return segs;
  };

  const process = (axis: "v" | "h") => {
    const segs = collect(axis);
    const n = segs.length;
    if (n < 2) return;
    const parent = segs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(segs[i].pos - segs[j].pos) <= TRUNK_TOL && overlap1d(segs[i].lo, segs[i].hi, segs[j].lo, segs[j].hi)) {
          parent[find(i)] = find(j);
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

    for (const idxs of groups.values()) {
      const count = idxs.length;
      if (count < 2) continue;
      const lo = Math.min(...idxs.map((k) => segs[k].lo));
      const hi = Math.max(...idxs.map((k) => segs[k].hi));
      const pos = segs[idxs[0]].pos;
      // Free room on each side of the cluster (perpendicular to the runs), bounded by
      // the nearest obstacle that spans the same band.
      let gapNeg = Infinity;
      let gapPos = Infinity;
      for (const o of infl) {
        const bandLo = axis === "v" ? o.y : o.x;
        const bandHi = axis === "v" ? o.y + o.h : o.x + o.w;
        if (!overlap1d(lo, hi, bandLo, bandHi)) continue;
        const edgeNeg = axis === "v" ? o.x : o.y;
        const edgePos = axis === "v" ? o.x + o.w : o.y + o.h;
        if (edgeNeg >= pos - 0.5) gapPos = Math.min(gapPos, edgeNeg - pos);
        if (edgePos <= pos + 0.5) gapNeg = Math.min(gapNeg, pos - edgePos);
      }
      const roomNeg = gapNeg === Infinity ? Infinity : Math.max(0, gapNeg - DETOUR_CLEAR);
      const roomPos = gapPos === Infinity ? Infinity : Math.max(0, gapPos - DETOUR_CLEAR);
      const totalRoom = roomNeg === Infinity || roomPos === Infinity ? Infinity : roomNeg + roomPos;
      // Compress the gap if the bundle can't fit between two close walls.
      const gap = totalRoom !== Infinity && (count - 1) * DETOUR_GAP > totalRoom ? totalRoom / (count - 1) : DETOUR_GAP;
      const half = ((count - 1) / 2) * gap;
      // Center the symmetric window, then slide it to sit inside [-roomNeg, +roomPos].
      const lowBound = roomNeg === Infinity ? -Infinity : -roomNeg + half;
      const highBound = roomPos === Infinity ? Infinity : roomPos - half;
      let shift = 0;
      if (lowBound > highBound) shift = (lowBound + highBound) / 2;
      else shift = Math.max(lowBound, Math.min(highBound, 0));

      // Order the cluster by whole-cable rank; the two nesting directions (rank ascending
      // vs descending) are the only sensible lane orders. Spread both ways and keep the
      // one with fewer bundle crossings — robust without per-case over/under reasoning.
      const order = [...idxs].sort(
        (a, b) => segs[a].rank - segs[b].rank || (segs[a].id < segs[b].id ? -1 : 1),
      );
      const applyOrient = (rev: boolean): (() => void) => {
        const ordered = rev ? [...order].reverse() : order;
        const undo: Array<() => void> = [];
        ordered.forEach((segIdx, k) => {
          const off = (k - (count - 1) / 2) * gap + shift;
          const s = segs[segIdx];
          const pts = ptsById.get(s.id)!;
          const a = pts[s.pi];
          const b = pts[s.pi + 1];
          if (axis === "v") {
            a.x += off;
            b.x += off;
            undo.push(() => {
              a.x -= off;
              b.x -= off;
            });
          } else {
            a.y += off;
            b.y += off;
            undo.push(() => {
              a.y -= off;
              b.y -= off;
            });
          }
        });
        return () => undo.forEach((u) => u());
      };
      const allPaths = work.map((w) => w.pts);
      const undoAsc = applyOrient(false);
      const crossAsc = countBundleCrossings(allPaths);
      undoAsc();
      const undoDesc = applyOrient(true);
      const crossDesc = countBundleCrossings(allPaths);
      if (crossAsc <= crossDesc) {
        undoDesc();
        applyOrient(false);
      }
    }
  };

  process("v");
  process("h");

  const out = new Map<string, Pt[]>();
  for (const w of work) out.set(w.id, w.pts.slice(1, -1)); // interior waypoints only
  return out;
}

// --- Collinear-overlap nudging -------------------------------------------------

/** Px that two cable runs lying on the same line are nudged apart — small, just enough
 *  to read them as separate lines (mirrors the user ask: "offset even a few pixels"). */
const NUDGE_GAP = 6;
/** Short run kept at a port before a nudged cable hops to its offset lane, so the cable
 *  stays anchored to the port and the hop reads as a deliberate little step. */
const NUDGE_STUB = 10;

const segAxis = (a: Pt, b: Pt): "h" | "v" | null => {
  const h = Math.abs(a.y - b.y) <= 0.5;
  const v = Math.abs(a.x - b.x) <= 0.5;
  if (h && !v) return "h";
  if (v && !h) return "v";
  return null; // zero-length or (shouldn't happen) diagonal
};

/**
 * Rebuild one orthogonal polyline shifting each segment perpendicular by `off(i)` px.
 * An interior corner just moves (its two perpendicular runs absorb the shift). A run that
 * touches a PORT (first/last segment) can't move its port end, so we insert a short stub
 * at the port Y/X and a hop up/down to the offset lane — the cable stays anchored and the
 * separation reads as a small step near the connector. Assumes axes alternate (simplify
 * the polyline first).
 */
function rebuildWithHops(pts: Pt[], off: (i: number) => number): Pt[] {
  const n = pts.length - 1; // segment count
  if (n < 1) return pts.map((p) => ({ ...p }));
  const axisAt = (i: number) => segAxis(pts[i], pts[i + 1]);
  const result: Pt[] = [{ ...pts[0] }];

  const o0 = off(0);
  const a0 = axisAt(0);
  if (Math.abs(o0) > 0.5 && a0) {
    if (a0 === "h") {
      const dir = Math.sign(pts[1].x - pts[0].x) || 1;
      const sx = pts[0].x + dir * NUDGE_STUB;
      result.push({ x: sx, y: pts[0].y }, { x: sx, y: pts[0].y + o0 });
    } else {
      const dir = Math.sign(pts[1].y - pts[0].y) || 1;
      const sy = pts[0].y + dir * NUDGE_STUB;
      result.push({ x: pts[0].x, y: sy }, { x: pts[0].x + o0, y: sy });
    }
  }

  for (let k = 1; k <= n - 1; k++) {
    const aPrev = axisAt(k - 1);
    const aCur = axisAt(k);
    let dx = 0;
    let dy = 0;
    // The 'v' run touching this corner shifts its x; the 'h' run shifts its y.
    if (aPrev === "v") dx = off(k - 1);
    else if (aPrev === "h") dy = off(k - 1);
    if (aCur === "v") dx = off(k);
    else if (aCur === "h") dy = off(k);
    result.push({ x: pts[k].x + dx, y: pts[k].y + dy });
  }

  const oN = off(n - 1);
  const aN = axisAt(n - 1);
  if (Math.abs(oN) > 0.5 && aN) {
    if (aN === "h") {
      const dir = Math.sign(pts[n - 1].x - pts[n].x) || 1;
      const sx = pts[n].x + dir * NUDGE_STUB;
      result.push({ x: sx, y: pts[n].y + oN }, { x: sx, y: pts[n].y });
    } else {
      const dir = Math.sign(pts[n - 1].y - pts[n].y) || 1;
      const sy = pts[n].y + dir * NUDGE_STUB;
      result.push({ x: pts[n].x + oN, y: sy }, { x: pts[n].x, y: sy });
    }
  }

  result.push({ ...pts[n] });
  return result;
}

/**
 * Final separation pass over ALL cable polylines: wherever runs of two *different* cables
 * lie on the same line and overlap, fan them a few px apart (with port hops) so they read
 * as distinct lines. Catches what the corridor-lane and detour passes can't — scrambled
 * patches and cross-device runs whose horizontals land on a shared row. Returns adjusted
 * INTERIOR waypoints per cable. Runs already separated by earlier passes stay singletons
 * here and are returned untouched.
 */
export function nudgeCollinearOverlaps(routes: { id: string; pts: Pt[] }[]): Map<string, Pt[]> {
  type Seg = { id: string; si: number; axis: "h" | "v"; pos: number; lo: number; hi: number; rank: number; down: boolean };
  const segs: Seg[] = [];
  for (const r of routes) {
    const rank = (r.pts[0].y + r.pts[r.pts.length - 1].y) / 2;
    const down = r.pts[r.pts.length - 1].y > r.pts[0].y; // target below source?
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      const ax = segAxis(a, b);
      if (!ax) continue;
      if (ax === "h") segs.push({ id: r.id, si: i, axis: "h", pos: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), rank, down });
      else segs.push({ id: r.id, si: i, axis: "v", pos: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), rank, down });
    }
  }

  const n = segs.length;
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        segs[i].id !== segs[j].id &&
        segs[i].axis === segs[j].axis &&
        Math.abs(segs[i].pos - segs[j].pos) <= NUDGE_GAP * 1.5 &&
        overlap1d(segs[i].lo, segs[i].hi, segs[j].lo, segs[j].hi)
      ) {
        parent[find(i)] = find(j);
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

  const offsetOf = new Map<string, number>();
  for (const idxs of groups.values()) {
    if (new Set(idxs.map((k) => segs[k].id)).size < 2) continue; // only when ≥2 cables overlap
    const ordered = [...idxs].sort(
      (a, b) => segs[a].rank - segs[b].rank || (segs[a].id < segs[b].id ? -1 : 1),
    );
    // A cluster of vertical jogs is a same-corridor bundle: nest it like the lane pass.
    // A downward bundle must flip so the higher cable takes the right-hand jog, or the
    // top-to-bottom rank order self-crosses (identity pairs cross twice). Horizontal
    // overlaps keep absolute rank order (a higher cable stays higher).
    if (segs[idxs[0]].axis === "v") {
      const downSum = idxs.reduce((s, k) => s + (segs[k].down ? 1 : -1), 0);
      if (downSum > 0) ordered.reverse();
    }
    const count = ordered.length;
    ordered.forEach((k, idx) => {
      offsetOf.set(`${segs[k].id}:${segs[k].si}`, (idx - (count - 1) / 2) * NUDGE_GAP);
    });
  }

  const out = new Map<string, Pt[]>();
  for (const r of routes) {
    const rebuilt = rebuildWithHops(r.pts, (i) => offsetOf.get(`${r.id}:${i}`) ?? 0);
    out.set(r.id, rebuilt.slice(1, -1));
  }
  return out;
}
