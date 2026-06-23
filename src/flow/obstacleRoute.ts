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

const inflate = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  w: r.w + 2 * m,
  h: r.h + 2 * m,
});

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
