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
/** Requested minimum exit-stub length per end (soft — callers retry without it if routing
 *  fails). Used to hold a first/last straight run long enough for the cable-ID label. */
export type StubSpec = { from?: number; to?: number };

/** Already-routed cable geometry the A* is penalized for crossing (sequential soft
 *  crossing-minimization): horizontal and vertical segments as (pos, lo..hi) spans. */
export type Seg = { pos: number; lo: number; hi: number };
export type CrossContext = { h: Seg[]; v: Seg[] };

/** Decompose polylines into a {@link CrossContext} (degenerate segments dropped). */
export function crossContextOf(polylines: Pt[][]): CrossContext {
  const h: Seg[] = [];
  const v: Seg[] = [];
  for (const pts of polylines) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const horiz = Math.abs(a.y - b.y) <= 0.5;
      const vert = Math.abs(a.x - b.x) <= 0.5;
      if (horiz && !vert) h.push({ pos: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      else if (vert && !horiz) v.push({ pos: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  }
  return { h, v };
}

// Mirror the legacy obstacle router's constants (flow/obstacleRoute.ts). To be consolidated
// into router/constants.ts when the general router owns all cases (p2-router).
const PORT_STUB = 22;
const TURN_COST = 100000;
/** Comfort band beyond the 16px hard margin: running PARALLEL alongside a box inside this
 *  band is penalized per px, so routes keep ~40px off a device edge when there's room and
 *  compress toward the hard margin only under pressure (the user rule: "try really hard to
 *  avoid routing directly next to a rectangle"). Crossing the band perpendicular is free. */
const COMFORT = 24;
const HUG_COST = 300; // per px alongside a box; ~333px of hugging ≈ one extra bend
/** Soft cost per crossing of an already-routed cable — the settled ~2:1 crossing:bend weight
 *  (routeMetrics.DEFAULT_WEIGHTS) expressed in the A*'s TURN_COST quantum. Crossing stays
 *  legal (clarity > absolute-minimum-crossings), just twice as expensive as a bend. */
const CROSS_COST = 2 * TURN_COST;
// Grid-size guard, not a routing policy: {@link routeOrthogonalPruned} keeps the working set
// far below this by only feeding in boxes the run can actually meet. Big diagrams (50–250+
// devices) must still route — the old hard bail at 40 made every run on them give up at once.
const MAX_OBSTACLES = 160;
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
export function routeOrthogonal(
  from: RoutePort,
  to: RoutePort,
  obstacles: Rect[],
  ownRects: Rect[] = [],
  stubs?: StubSpec,
  cross?: CrossContext,
): Pt[] | null {
  const inflated = obstacles.map((r) => inflate(r, OBSTACLE_MARGIN)); // hard: the final path must clear these
  const ownInflated = ownRects.map((r) => inflate(r, OBSTACLE_MARGIN));
  const avoid = [...inflated, ...ownInflated]; // what A* may not cross (own devices included)
  if (avoid.length > MAX_OBSTACLES) return null;

  // The path leaves/enters each port along a perpendicular stub before it may turn. A MEASURED
  // anchor can sit INSIDE its own device (a bidi jack lives in the io strip above the bottom
  // edge), so the fixed stub alone may still end within the own box's margin, where every A*
  // step is blocked — extend it until it clears every own inflated box it starts inside.
  const stubLen = (p: RoutePort, want?: number): number => {
    let len = Math.max(PORT_STUB, want ?? 0);
    for (const r of ownInflated) {
      if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
      const exit =
        p.dir === "+y" ? r.y + r.h - p.y : p.dir === "-y" ? p.y - r.y : p.dir === "+x" ? r.x + r.w - p.x : p.x - r.x;
      len = Math.max(len, exit + 1);
    }
    return len;
  };
  const fromLen = stubLen(from, stubs?.from);
  const toLen = stubLen(to, stubs?.to);
  const fromStub: Pt = { x: from.x + stepX(from.dir) * fromLen, y: from.y + stepY(from.dir) * fromLen };
  const toStub: Pt = { x: to.x + stepX(to.dir) * toLen, y: to.y + stepY(to.dir) * toLen };

  // Hanan grid: terminals + stubs + inflated box corners + comfort boundaries (so a line
  // ~40px off every device EXISTS to choose), plus a padding moat around the whole bounding
  // box so a path can always escape around the outside if the interior is blocked.
  const xsRaw = [from.x, fromStub.x, to.x, toStub.x];
  const ysRaw = [from.y, fromStub.y, to.y, toStub.y];
  for (const r of avoid) {
    xsRaw.push(r.x, r.x + r.w, r.x - COMFORT, r.x + r.w + COMFORT);
    ysRaw.push(r.y, r.y + r.h, r.y - COMFORT, r.y + r.h + COMFORT);
  }
  const minX = Math.min(...xsRaw);
  const maxX = Math.max(...xsRaw);
  const minY = Math.min(...ysRaw);
  const maxY = Math.max(...ysRaw);
  // Candidate lines BESIDE existing cables: box corners alone leave open space lineless, so
  // the crossing penalty can price a staircase crossing but has no grid line in the clear
  // gap next to it — the route "goes out of its way to cross". A slot CROSS_LANE off each
  // context segment inside the search area gives A* the zero-crossing option. Capped so a
  // dense canvas can't explode the grid.
  const CROSS_LANE = 16;
  const MAX_CTX_LINES = 60;
  if (cross) {
    let added = 0;
    for (const s of cross.v) {
      if (added >= MAX_CTX_LINES) break;
      if (s.pos < minX || s.pos > maxX || s.hi < minY || s.lo > maxY) continue;
      xsRaw.push(Math.max(minX, s.pos - CROSS_LANE), Math.min(maxX, s.pos + CROSS_LANE));
      added++;
    }
    added = 0;
    for (const s of cross.h) {
      if (added >= MAX_CTX_LINES) break;
      if (s.pos < minY || s.pos > maxY || s.hi < minX || s.lo > maxX) continue;
      ysRaw.push(Math.max(minY, s.pos - CROSS_LANE), Math.min(maxY, s.pos + CROSS_LANE));
      added++;
    }
  }
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

  // Soft "don't hug a box" cost: the length of a segment spent running PARALLEL alongside a
  // box within the comfort band (between the hard margin line and COMFORT px further out).
  // Crossing a band perpendicular is free — only sidling along an edge is penalized.
  const hugPenalty = (x1: number, y1: number, x2: number, y2: number): number => {
    const vertical = Math.abs(x1 - x2) <= 0.5;
    let pen = 0;
    for (const r of avoid) {
      if (vertical) {
        const nearSide =
          (x1 > r.x - COMFORT + 0.5 && x1 < r.x + 0.5) ||
          (x1 > r.x + r.w - 0.5 && x1 < r.x + r.w + COMFORT - 0.5);
        if (!nearSide) continue;
        const lo = Math.max(Math.min(y1, y2), r.y);
        const hi = Math.min(Math.max(y1, y2), r.y + r.h);
        if (hi > lo) pen += (hi - lo) * HUG_COST;
      } else {
        const nearSide =
          (y1 > r.y - COMFORT + 0.5 && y1 < r.y + 0.5) ||
          (y1 > r.y + r.h - 0.5 && y1 < r.y + r.h + COMFORT - 0.5);
        if (!nearSide) continue;
        const lo = Math.max(Math.min(x1, x2), r.x);
        const hi = Math.min(Math.max(x1, x2), r.x + r.w);
        if (hi > lo) pen += (hi - lo) * HUG_COST;
      }
    }
    return pen;
  };

  // Soft crossing cost vs already-routed cables: a candidate segment pays CROSS_COST per
  // existing perpendicular segment it properly crosses (strict interior both ways — shared
  // endpoints/T-junctions are free, matching the canonical crossing counter).
  const crossPenalty = (x1: number, y1: number, x2: number, y2: number): number => {
    if (!cross) return 0;
    let n = 0;
    if (Math.abs(x1 - x2) <= 0.5) {
      const lo = Math.min(y1, y2);
      const hi = Math.max(y1, y2);
      for (const s of cross.h) {
        if (s.pos > lo + 0.5 && s.pos < hi - 0.5 && x1 > s.lo + 0.5 && x1 < s.hi - 0.5) n++;
      }
    } else if (Math.abs(y1 - y2) <= 0.5) {
      const lo = Math.min(x1, x2);
      const hi = Math.max(x1, x2);
      for (const s of cross.v) {
        if (s.pos > lo + 0.5 && s.pos < hi - 0.5 && y1 > s.lo + 0.5 && y1 < s.hi - 0.5) n++;
      }
    }
    return n * CROSS_COST;
  };

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
      const ng =
        g +
        len +
        turn +
        hugPenalty(xs[node.i], ys[node.j], xs[ni], ys[nj]) +
        crossPenalty(xs[node.i], ys[node.j], xs[ni], ys[nj]);
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

// --- Spatial pruning ---------------------------------------------------------------------

/** Fields this small route with the full set — byte-identical to the pre-pruning router. */
const PRUNE_THRESHOLD = 24;
/** Corridor around the endpoints' bbox that seeds the working obstacle set. */
const REGION_PAD = 96;
/** Offender-expansion rounds before giving up (the set only grows, so this terminates). */
const MAX_PRUNE_ROUNDS = 5;

const rectsIntersect = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * {@link routeOrthogonal} for large diagrams: instead of handing A* every box on the canvas
 * (whose Hanan grid would explode — and where the old MAX_OBSTACLES bail made every run give
 * up at ~40 devices), seed the search with only the boxes near the run's own region, then
 * verify the found path against ALL boxes and re-route with any offender added. The set only
 * grows, so a few rounds either converge on a clean path or give up honestly with null.
 * Small fields skip pruning entirely and stay byte-identical to a direct call.
 */
export function routeOrthogonalPruned(
  from: RoutePort,
  to: RoutePort,
  obstacles: Rect[],
  ownRects: Rect[] = [],
  stubs?: StubSpec,
  cross?: CrossContext,
): Pt[] | null {
  if (obstacles.length <= PRUNE_THRESHOLD) return routeOrthogonal(from, to, obstacles, ownRects, stubs, cross);

  const region: Rect = {
    x: Math.min(from.x, to.x) - REGION_PAD,
    y: Math.min(from.y, to.y) - REGION_PAD,
    w: Math.abs(from.x - to.x) + 2 * REGION_PAD,
    h: Math.abs(from.y - to.y) + 2 * REGION_PAD,
  };
  const active = obstacles.filter((r) => rectsIntersect(r, region));
  const activeSet = new Set(active);
  const rest = obstacles.filter((r) => !activeSet.has(r));
  const restInflated = rest.map((r) => ({ raw: r, infl: inflate(r, OBSTACLE_MARGIN) }));

  for (let round = 0; round < MAX_PRUNE_ROUNDS; round++) {
    const interior = routeOrthogonal(from, to, active, ownRects, stubs, cross);
    if (!interior) return null;
    const full: Pt[] = [{ x: from.x, y: from.y }, ...interior, { x: to.x, y: to.y }];
    const offenders: Rect[] = [];
    for (const { raw, infl } of restInflated) {
      if (activeSet.has(raw)) continue;
      for (let i = 0; i < full.length - 1; i++) {
        if (segmentHitsRect(full[i].x, full[i].y, full[i + 1].x, full[i + 1].y, [infl])) {
          offenders.push(raw);
          break;
        }
      }
    }
    if (!offenders.length) return interior;
    for (const r of offenders) {
      active.push(r);
      activeSet.add(r);
    }
  }
  return null;
}
