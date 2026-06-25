import type { Pt, Rect } from "./obstacleRoute";
import { segmentHitsRect } from "./obstacleRoute";
import type { RouteResult } from "./router/types";

/**
 * The canonical routing metric — the objective measure that drives the non-regression
 * gate (design/CABLE-ROUTING.html §4). Pure geometry: it scores a set of post-stitch
 * cable polylines on crossings, bends, length, collinear overlaps, and a joint cost.
 *
 * The same crossing counter is meant to drive BOTH this gate AND the general router's
 * internal objective (P3), measured on the SAME post-stitch geometry — so "fewer crossings"
 * means the same thing to the optimizer and to the gate. Today the legacy lane pass keeps a
 * private, identical copy in parallelLanes (`routeCrossings`); P3 unifies them here.
 */

/** Joint-cost weights: ~2:1 crossing:bend, with length a sub-unit tie-breaker so bends and
 *  crossings dominate (mirroring the legacy TURN_COST=100000 quantum). Tunable; surfaced as
 *  the single legibility slider once the general router lands. */
export const DEFAULT_WEIGHTS = { crossing: 2, bend: 1, length: 0.0001 };
export type Weights = typeof DEFAULT_WEIGHTS;

const EPS = 0.5;

/** Orientation of a segment, or null if it is degenerate (zero-length). */
function segAxis(a: Pt, b: Pt): "h" | "v" | null {
  const h = Math.abs(a.y - b.y) <= EPS;
  const v = Math.abs(a.x - b.x) <= EPS;
  if (h && !v) return "h";
  if (v && !h) return "v";
  return null;
}

/**
 * Proper orthogonal crossings between two routes — strict interior of both segments, so a
 * shared endpoint or a T-junction does not count (only a true over/under crossing does).
 * Identical to the private counter in parallelLanes.ts:71 (kept in sync until P3 unifies).
 */
export function routeCrossings(a: Pt[], b: Pt[]): number {
  let n = 0;
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const a1 = a[i];
      const a2 = a[i + 1];
      const b1 = b[j];
      const b2 = b[j + 1];
      const aH = Math.abs(a1.y - a2.y) <= EPS;
      const bH = Math.abs(b1.y - b2.y) <= EPS;
      if (aH === bH) continue; // parallel (both H or both V) — no proper crossing
      const h0 = aH ? a1 : b1;
      const h1 = aH ? a2 : b2;
      const v0 = aH ? b1 : a1;
      const v1 = aH ? b2 : a2;
      if (
        v0.x > Math.min(h0.x, h1.x) + EPS &&
        v0.x < Math.max(h0.x, h1.x) - EPS &&
        h0.y > Math.min(v0.y, v1.y) + EPS &&
        h0.y < Math.max(v0.y, v1.y) - EPS
      ) {
        n++;
      }
    }
  }
  return n;
}

/** Total proper crossings across every pair of routes. */
export function totalCrossings(routes: Pt[][]): number {
  let n = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) n += routeCrossings(routes[i], routes[j]);
  }
  return n;
}

/**
 * Collinear overlaps between DIFFERENT routes: co-axial segments at the same position whose
 * spans overlap — two cables drawn on top of each other. Reported separately from crossings
 * (which are perpendicular); this is the thing nudgeCollinearOverlaps exists to remove.
 */
export function totalOverlaps(routes: Pt[][]): number {
  type Seg = { ri: number; axis: "h" | "v"; pos: number; lo: number; hi: number };
  const segs: Seg[] = [];
  routes.forEach((r, ri) => {
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const b = r[i + 1];
      const ax = segAxis(a, b);
      if (!ax) continue;
      if (ax === "h") segs.push({ ri, axis: "h", pos: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      else segs.push({ ri, axis: "v", pos: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  });
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.ri !== t.ri && s.axis === t.axis && Math.abs(s.pos - t.pos) <= EPS && s.lo < t.hi - EPS && t.lo < s.hi - EPS) {
        n++;
      }
    }
  }
  return n;
}

/** Direction changes along a route (its bend count); degenerate segments are skipped. */
export function bendCount(route: Pt[]): number {
  let prev: "h" | "v" | null = null;
  let bends = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const ax = segAxis(route[i], route[i + 1]);
    if (!ax) continue;
    if (prev && ax !== prev) bends++;
    prev = ax;
  }
  return bends;
}

/** Total drawn length of a route. */
export function routeLength(route: Pt[]): number {
  let len = 0;
  for (let i = 0; i < route.length - 1; i++) {
    len += Math.hypot(route[i + 1].x - route[i].x, route[i + 1].y - route[i].y);
  }
  return len;
}

/**
 * Count segments of `route` whose interior passes through any obstacle rect — the
 * "never behind a device" violation. The caller supplies the rects to avoid (already
 * inflated by the clearance gutter and excluding the edge's own endpoint boxes), so this
 * is a pure geometric test reusing the router's own `segmentHitsRect`.
 */
export function boxInteriorHits(route: Pt[], rects: Rect[]): number {
  let n = 0;
  for (let i = 0; i < route.length - 1; i++) {
    if (segmentHitsRect(route[i].x, route[i].y, route[i + 1].x, route[i + 1].y, rects)) n++;
  }
  return n;
}

export type Side = "L" | "R" | "T" | "B";

/**
 * Reconstruct the full polyline `CableEdge` draws: the exact port endpoints plus the
 * router's interior waypoints, with the first/last bend snapped to the port's exit axis —
 * Y for a left/right exit, X for a top/bottom (bidi) exit. Mirrors CableEdge.tsx:42–54,
 * generalized to all four sides so bidi runs measure correctly. An empty interior is a
 * clean straight run, reconstructed as the direct segment (CableEdge's smooth-step fallback,
 * approximated orthogonally for measurement).
 */
export function stitchPolyline(source: Pt, target: Pt, sourceSide: Side, targetSide: Side, interior: Pt[]): Pt[] {
  if (!interior.length) return [source, target];
  const pts = [source, ...interior.map((p) => ({ ...p })), target];
  const snap = (p: Pt, end: Pt, side: Side) => {
    if (side === "L" || side === "R") p.y = end.y;
    else p.x = end.x;
  };
  snap(pts[1], source, sourceSide);
  snap(pts[pts.length - 2], target, targetSide);
  return pts;
}

/**
 * Build post-stitch polylines for every routed edge from a {@link RouteResult}. Endpoints
 * come from `result.ends` (the geometry the router worked in) and interiors from
 * `result.waypoints`. Legacy runs are all right-output → left-input (R→L); bidi/unrouted
 * edges have no `ends` entry and are excluded (the harness counts them separately).
 */
export function polylinesFromResult(result: Pick<RouteResult, "ends" | "waypoints">): { id: string; pts: Pt[] }[] {
  const out: { id: string; pts: Pt[] }[] = [];
  for (const [id, e] of result.ends) {
    const interior = result.waypoints.get(id) ?? [];
    out.push({ id, pts: stitchPolyline({ x: e.sx, y: e.sy }, { x: e.tx, y: e.ty }, "R", "L", interior) });
  }
  return out;
}

export type RouteMetrics = {
  /** Number of edges with a routed polyline (excludes unrouted bidi/bottom runs). */
  routed: number;
  crossings: number;
  bends: number;
  length: number;
  overlaps: number;
  cost: number;
  perEdge: Record<string, { bends: number; length: number }>;
};

/** Score a set of post-stitch polylines into the canonical metric. */
export function computeMetrics(polylines: { id: string; pts: Pt[] }[], weights: Weights = DEFAULT_WEIGHTS): RouteMetrics {
  const routes = polylines.map((p) => p.pts);
  const crossings = totalCrossings(routes);
  const overlaps = totalOverlaps(routes);
  let bends = 0;
  let length = 0;
  const perEdge: Record<string, { bends: number; length: number }> = {};
  for (const p of polylines) {
    const b = bendCount(p.pts);
    const l = routeLength(p.pts);
    bends += b;
    length += l;
    perEdge[p.id] = { bends: b, length: l };
  }
  const cost = weights.crossing * crossings + weights.bend * bends + weights.length * length;
  return { routed: polylines.length, crossings, bends, length, overlaps, cost, perEdge };
}

/** Convenience: route metrics straight from a {@link RouteResult}. */
export function metricsFromResult(result: Pick<RouteResult, "ends" | "waypoints">, weights: Weights = DEFAULT_WEIGHTS): RouteMetrics {
  return computeMetrics(polylinesFromResult(result), weights);
}
