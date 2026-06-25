import type { Pt, Rect } from "../obstacleRoute";
import { segmentHitsRect, simplifyOrthogonal, OBSTACLE_MARGIN } from "../obstacleRoute";

/**
 * A general orthogonal obstacle-avoiding router (p2-bidiroute). Unlike the legacy
 * `routeAroundObstacles` — which is hardwired to a left→right run (exit +x, enter −x, an
 * x-corridor grid) — this one is parameterized by each port's EXIT DIRECTION, so it routes
 * runs leaving any side: a bottom (bidirectional) jack exits +y, a left input −x, etc. It
 * searches a full-region Hanan grid (the precise thing the reverted in-place generalization
 * lacked, which let vertical legs cut through stacked boxes), so it avoids every box on all
 * sides.
 *
 * It returns INTERIOR bend points (excluding the two ports); CableEdge stitches the exact
 * measured port endpoints on and snaps the first/last bend to the port's axis, so the
 * estimated anchor passed here need only be close — the drawn exit lands on the real jack.
 */

export type ExitDir = "+x" | "-x" | "+y" | "-y";
export type RoutePort = { x: number; y: number; dir: ExitDir };

// Mirror the legacy obstacle router's constants (flow/obstacleRoute.ts). To be consolidated
// into router/constants.ts when the general router owns all cases (p2-router).
const PORT_STUB = 22;
const TURN_COST = 100000;
const MAX_OBSTACLES = 40;
const PAD = 40; // a clear moat around the bounding box so a route around everything always exists

function inflate(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

function uniqSorted(vals: number[]): number[] {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || Math.abs(out[out.length - 1] - v) > 0.5) out.push(v);
  return out;
}

const stepX = (d: ExitDir) => (d === "+x" ? 1 : d === "-x" ? -1 : 0);
const stepY = (d: ExitDir) => (d === "+y" ? 1 : d === "-y" ? -1 : 0);
const axisOf = (d: ExitDir): 0 | 1 => (d === "+x" || d === "-x" ? 0 : 1);

type AStarNode = { i: number; j: number; axis: 0 | 1 };

/**
 * Route from port `from` (exiting along `from.dir`) to port `to` (entering against `to.dir`).
 * `obstacles` is every OTHER box the run must clear; `ownRects` is the run's own two endpoint
 * devices. The own devices are obstacles for the SEARCH (so a bottom-port run with a target
 * above it routes AROUND its device rather than taking the free shortcut straight up through
 * it) but are excluded from the final hit-check, since the short perpendicular exit stub
 * legitimately pierces the device's own edge at the port. Rects are inflated by OBSTACLE_MARGIN
 * here (pass raw). Returns interior bend points, or null if no clean route is found.
 */
export function routeOrthogonal(from: RoutePort, to: RoutePort, obstacles: Rect[], ownRects: Rect[] = []): Pt[] | null {
  const inflated = obstacles.map((r) => inflate(r, OBSTACLE_MARGIN)); // hard: the final path must clear these
  const ownInflated = ownRects.map((r) => inflate(r, OBSTACLE_MARGIN));
  const avoid = [...inflated, ...ownInflated]; // what A* may not cross (own devices included)
  if (avoid.length > MAX_OBSTACLES) return null;

  // The path leaves/enters each port along a perpendicular stub before it may turn. The stub
  // end sits OBSTACLE_MARGIN+PORT_STUB-(margin) clear of the device, so it is outside ownInflated.
  const fromStub: Pt = { x: from.x + stepX(from.dir) * PORT_STUB, y: from.y + stepY(from.dir) * PORT_STUB };
  const toStub: Pt = { x: to.x + stepX(to.dir) * PORT_STUB, y: to.y + stepY(to.dir) * PORT_STUB };

  // Hanan grid: terminals + stubs + inflated box corners, plus a padding moat around the whole
  // bounding box so a path can always escape around the outside if the interior is blocked.
  const xsRaw = [from.x, fromStub.x, to.x, toStub.x];
  const ysRaw = [from.y, fromStub.y, to.y, toStub.y];
  for (const r of avoid) {
    xsRaw.push(r.x, r.x + r.w);
    ysRaw.push(r.y, r.y + r.h);
  }
  const minX = Math.min(...xsRaw);
  const maxX = Math.max(...xsRaw);
  const minY = Math.min(...ysRaw);
  const maxY = Math.max(...ysRaw);
  xsRaw.push(minX - PAD, maxX + PAD);
  ysRaw.push(minY - PAD, maxY + PAD);

  const xs = uniqSorted(xsRaw);
  const ys = uniqSorted(ysRaw);
  const nx = xs.length;
  const ny = ys.length;
  const xi = (v: number) => xs.findIndex((x) => Math.abs(x - v) <= 0.5);
  const yi = (v: number) => ys.findIndex((y) => Math.abs(y - v) <= 0.5);

  const startI = xi(fromStub.x);
  const startJ = yi(fromStub.y);
  const goalI = xi(toStub.x);
  const goalJ = yi(toStub.y);
  if (startI < 0 || startJ < 0 || goalI < 0 || goalJ < 0) return null;

  // A* over (gridX, gridY, arrivalAxis). Turn cost dominates length, so fewest-bend wins.
  const key = (i: number, j: number, axis: number) => (i * ny + j) * 2 + axis;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const heap: { f: number; node: AStarNode }[] = [];
  const push = (f: number, node: AStarNode) => {
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

  // Arrival axis at the start = the stub's axis (the path reached fromStub moving along from.dir).
  const startAxis = axisOf(from.dir);
  const startKey = key(startI, startJ, startAxis);
  gScore.set(startKey, 0);
  push(h(startI, startJ), { i: startI, j: startJ, axis: startAxis });

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
      if (segmentHitsRect(xs[node.i], ys[node.j], xs[ni], ys[nj], avoid)) continue;
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

  // Reconstruct grid points (fromStub → toStub).
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

  // Bookend with the real ports (the stub ends are the first/last grid points), simplify,
  // and reject a path that still clips a box.
  const full: Pt[] = [{ x: from.x, y: from.y }, ...pts, { x: to.x, y: to.y }];
  const simplified = simplifyOrthogonal(full);
  for (let i = 0; i < simplified.length - 1; i++) {
    if (segmentHitsRect(simplified[i].x, simplified[i].y, simplified[i + 1].x, simplified[i + 1].y, inflated)) {
      return null;
    }
  }
  const interior = simplified.slice(1, -1);
  return interior.length ? interior : null;
}
