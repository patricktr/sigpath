import { crossContextOf, routeOrthogonalPruned } from "./orthogonalRoute";
import type { CrossContext, ExitDir, RoutePort, StubSpec } from "./orthogonalRoute";
import type { Rect, Pt } from "../obstacleRoute";
import {
  rectContains,
  pathHitsObstacle,
  defaultRoutePoints,
  centerDetourVerticals,
  spreadDetourBundles,
  nudgeCollinearOverlaps,
  simplifyOrthogonal,
} from "../obstacleRoute";
import { assignLanes, approxPortY } from "../parallelLanes";
import type { LaneInput } from "../parallelLanes";
import { inputPorts, outputPorts, bidirectionalPorts } from "../../schema";
import type { Port } from "../../schema";
import { isPortBearing } from "../types";
import type { PortBearingNode, SigNode } from "../types";
import type { EdgeEnds, PortAnchor, PortSide, Router, RouteRequest, RouteResult } from "./types";

/**
 * The general router (p2-router). It owns ALL cable runs through one pipeline:
 *
 *  - endpoints for every run are resolved uniformly via {@link portGeom} (left input, right
 *    output, bottom bidi). For a right-output → left-input run this reproduces the legacy
 *    endpoints exactly (node.x+w, approxPortY(index)).
 *  - a run whose straight path clears every box, AND is a standard output→input run, goes
 *    through the SAME tuned lane pass as before (assignLanes + nudgeCollinearOverlaps) — so the
 *    finely-tuned common case stays byte-identical and cannot regress.
 *  - every other run — blocked output→input runs, and all bidi/bottom-port runs — is routed by
 *    the direction-aware orthogonal A* ({@link routeOrthogonal}), which avoids every box on all
 *    sides (replacing the legacy x-corridor detour and its bail-out gaps).
 *
 * The legacy router stays available behind the flag for rollback until this is proven at parity
 * across the corpus (design/CABLE-ROUTING.html §4, P3 → P4).
 */

/** Box size, mirroring the legacy obstacleRects (measured first, port-count estimate fallback). */
function deviceSize(n: PortBearingNode): { w: number; h: number } {
  const w = n.measured?.width ?? n.width ?? 168;
  const ports = Math.max(inputPorts(n.data.model).length, outputPorts(n.data.model).length, 1);
  const h = n.measured?.height ?? n.height ?? approxPortY(ports - 1) + 24;
  return { w, h };
}

/** Every box a cable must avoid — devices/blocks, plus opted-in zone/note obstacles. Mirrors
 *  the legacy obstacle collection so the router (and the box-interior gate) see the same field. */
export function collectObstacleRects(nodes: SigNode[]): { id: string; rect: Rect }[] {
  const out: { id: string; rect: Rect }[] = [];
  for (const n of nodes) {
    if (isPortBearing(n)) {
      const { w, h } = deviceSize(n);
      out.push({ id: n.id, rect: { x: n.position.x, y: n.position.y, w, h } });
    } else if ((n.type === "zone" || n.type === "note") && n.data.obstacle) {
      const w = n.measured?.width ?? (typeof n.width === "number" ? n.width : undefined);
      const h = n.measured?.height ?? (typeof n.height === "number" ? n.height : undefined);
      if (w && h) out.push({ id: n.id, rect: { x: n.position.x, y: n.position.y, w, h } });
    }
  }
  return out;
}

const SIDE_DIR: Record<PortSide, ExitDir> = { L: "-x", R: "+x", T: "-y", B: "+y" };
type Geom = { x: number; y: number; side: PortSide; dir: ExitDir };

/** A box deflated to its true core, so only a real pass-through counts as a violation —
 *  the perpendicular exit stub touching a port's own edge, and edge-hugging (a routing
 *  QUALITY concern, not a constraint one), are exempt. Mirrors the gate's BOXCHECK_INSET. */
const CORE_INSET = 12;
const coreOf = (r: Rect): Rect => ({
  x: r.x + CORE_INSET,
  y: r.y + CORE_INSET,
  w: r.w - 2 * CORE_INSET,
  h: r.h - 2 * CORE_INSET,
});
const coresOf = (rects: Rect[]): Rect[] => rects.map(coreOf).filter((r) => r.w > 0 && r.h > 0);

/** Preferred first/last straight-run length on a horizontal (L/R) exit — long enough for the
 *  cable-ID badge to ride the run before the first bend. SOFT: when routing with this much
 *  room fails, we retry with the plain port stub (shrink under pressure). */
const LABEL_STUB = 64;
const labelStubs = (from: Geom, to: Geom): StubSpec | undefined => {
  const f = from.side === "L" || from.side === "R" ? LABEL_STUB : undefined;
  const t = to.side === "L" || to.side === "R" ? LABEL_STUB : undefined;
  return f || t ? { from: f, to: t } : undefined;
};

/** Detour with label room when possible, plain stubs when not. */
function detour(
  from: RoutePort,
  to: RoutePort,
  fromG: Geom,
  toG: Geom,
  obstacles: Rect[],
  own: Rect[],
  cross?: CrossContext,
): Pt[] | null {
  const want = labelStubs(fromG, toG);
  if (want) {
    const roomy = routeOrthogonalPruned(from, to, obstacles, own, want, cross);
    if (roomy) return roomy;
  }
  return routeOrthogonalPruned(from, to, obstacles, own, undefined, cross);
}

/** Resolve a port's canvas anchor + which side it exits. A MEASURED anchor (real handle
 *  center from React Flow) wins outright; otherwise estimate — input→left, output→right,
 *  bidirectional→bottom (anchor X by even spacing; CableEdge snaps the real jack). */
function portGeom(node: PortBearingNode, port: Port, anchor?: PortAnchor): Geom {
  if (anchor) return { x: anchor.x, y: anchor.y, side: anchor.side, dir: SIDE_DIR[anchor.side] };
  const model = node.data.model;
  const { w, h } = deviceSize(node);
  if (port.direction === "input") {
    const i = inputPorts(model).findIndex((p) => p.id === port.id);
    return { x: node.position.x, y: node.position.y + approxPortY(i < 0 ? 0 : i), side: "L", dir: SIDE_DIR.L };
  }
  if (port.direction === "output") {
    const i = outputPorts(model).findIndex((p) => p.id === port.id);
    return { x: node.position.x + w, y: node.position.y + approxPortY(i < 0 ? 0 : i), side: "R", dir: SIDE_DIR.R };
  }
  const bidi = bidirectionalPorts(model);
  const i = Math.max(0, bidi.findIndex((p) => p.id === port.id));
  const frac = (i + 1) / (bidi.length + 1);
  return { x: node.position.x + w * frac, y: node.position.y + h, side: "B", dir: SIDE_DIR.B };
}

function route(req: RouteRequest): RouteResult {
  const { nodes, edges } = req;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rects = collectObstacleRects(nodes);

  // Resolve every run's two endpoints. A standard output→input run is "horizontal" (R→L) and
  // keeps the legacy lane treatment; everything else is routed by the general A*.
  const geom = new Map<string, { from: Geom; to: Geom; horizontal: boolean }>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!isPortBearing(src) || !isPortBearing(tgt)) continue;
    const sp = src.data.model.ports.find((p) => p.id === e.sourceHandle);
    const tp = tgt.data.model.ports.find((p) => p.id === e.targetHandle);
    if (!sp || !tp) continue;
    const from = portGeom(src, sp, req.anchors?.get(e.source)?.get(`source:${sp.id}`));
    const to = portGeom(tgt, tp, req.anchors?.get(e.target)?.get(`target:${tp.id}`));
    geom.set(e.id, { from, to, horizontal: from.side === "R" && to.side === "L" });
  }

  const othersOf = (e: { source: string; target: string }, from: Geom, to: Geom): Rect[] =>
    rects
      .filter(
        (d) =>
          d.id !== e.source &&
          d.id !== e.target &&
          !rectContains(d.rect, { x: from.x, y: from.y }) &&
          !rectContains(d.rect, { x: to.x, y: to.y }),
      )
      .map((d) => d.rect);
  const ownOf = (e: { source: string; target: string }): Rect[] =>
    rects.filter((d) => d.id === e.source || d.id === e.target).map((d) => d.rect);

  // Detour pass: blocked output→input runs, and every bidi/non-horizontal run.
  //
  // Classify first: a CLEAR forward run joins the lane pass and seeds the crossing context
  // with its default Z (a close stand-in for its final lane). Everything else routes
  // SEQUENTIALLY, shortest run first, each finished route joining the context — so the A*'s
  // soft crossing penalty sees what is already on the canvas (locally-good crossing
  // minimization; no global optimizer).
  const waypointsById = new Map<string, Pt[]>();
  const giveUps: string[] = [];
  type Work = { e: (typeof edges)[number]; g: NonNullable<ReturnType<typeof geom.get>>; obstacles: Rect[]; own: Rect[]; centerWith: Rect[] | null };
  const work: Work[] = [];
  const ctxEntries: { id: string | null; pts: Pt[] }[] = [];
  for (const e of edges) {
    const g = geom.get(e.id);
    if (!g) continue;
    const { from, to, horizontal } = g;
    const obstacles = othersOf(e, from, to);
    const fromPt = { x: from.x, y: from.y };
    const toPt = { x: to.x, y: to.y };
    if (horizontal) {
      // Only reroute when the straight Z is actually blocked (else the lane pass handles it) —
      // identical trigger to legacy for the forward case. A forward run's side exit can't
      // re-enter its own device, but a BACKWARDS run (target behind the source, e.g. a power
      // conditioner feeding a device up-left of it) doubles the default Z straight back over
      // its own box — so own boxes count as blockers too, deflated to their cores so the
      // legitimate port-edge exit is exempt.
      const midX = (from.x + to.x) / 2;
      const own = ownOf(e);
      const defaultZ = defaultRoutePoints(fromPt, toPt, midX);
      const hitsOwn = pathHitsObstacle(defaultZ, coresOf(own));
      const blocked = hitsOwn || (obstacles.length > 0 && pathHitsObstacle(defaultZ, obstacles));
      if (!blocked) {
        ctxEntries.push({ id: e.id, pts: defaultZ });
        continue;
      }
      work.push({ e, g, obstacles, own: hitsOwn ? own : [], centerWith: hitsOwn ? [...obstacles, ...own] : obstacles });
    } else {
      // Bidi/bottom-port (and any non-output→input) run: route around boxes incl. its own two
      // devices, so a bottom port whose target is above routes around, not up through, itself.
      work.push({ e, g, obstacles, own: ownOf(e), centerWith: null });
    }
  }
  const span = (w: Work) => Math.abs(w.g.from.x - w.g.to.x) + Math.abs(w.g.from.y - w.g.to.y);
  work.sort((a, b) => span(a) - span(b) || (a.e.id < b.e.id ? -1 : 1));
  const ctx = crossContextOf(ctxEntries.map((en) => en.pts));
  for (const w of work) {
    const { from, to, horizontal } = w.g;
    const fromPt = { x: from.x, y: from.y };
    const toPt = { x: to.x, y: to.y };
    const interior = detour({ ...fromPt, dir: from.dir }, { ...toPt, dir: to.dir }, from, to, w.obstacles, w.own, ctx);
    if (interior) {
      let final: Pt[];
      if (horizontal) {
        final = centerDetourVerticals([fromPt, ...interior, toPt], w.centerWith ?? w.obstacles);
        waypointsById.set(w.e.id, final.slice(1, -1));
      } else {
        final = [fromPt, ...interior, toPt];
        waypointsById.set(w.e.id, interior);
      }
      ctxEntries.push({ id: w.e.id, pts: final });
      const add = crossContextOf([final]);
      ctx.h.push(...add.h);
      ctx.v.push(...add.v);
    } else {
      giveUps.push(w.e.id); // no clean detour — the default path may cross a box (warned upstream)
    }
  }

  // Fan apart co-located HORIZONTAL detours into separate lines (bidi detours keep their path).
  const hDetours = [...waypointsById].filter(([id]) => geom.get(id)?.horizontal);
  if (hDetours.length > 1) {
    const routes = hDetours.map(([id, interior]) => {
      const g = geom.get(id)!;
      return { id, pts: [{ x: g.from.x, y: g.from.y }, ...interior, { x: g.to.x, y: g.to.y }] };
    });
    const spread = spreadDetourBundles(routes, rects.map((d) => d.rect));
    for (const [id, interior] of spread) waypointsById.set(id, interior);
  }

  // Lane pass — clear output→input runs only, exactly as the legacy pipeline.
  const laneInputs: LaneInput[] = [];
  for (const e of edges) {
    const g = geom.get(e.id);
    if (!g || !g.horizontal || waypointsById.has(e.id)) continue;
    if (e.data?.jogOffset != null) continue;
    const { from, to } = g;
    laneInputs.push({
      id: e.id,
      axis: "h",
      jog: (from.x + to.x) / 2,
      lo: Math.min(from.y, to.y),
      hi: Math.max(from.y, to.y),
      sx: from.x,
      sy: from.y,
      tx: to.x,
      ty: to.y,
    });
  }
  const laneJogX = assignLanes(laneInputs);

  const polylines: { id: string; pts: Pt[] }[] = [];
  const jogInfo = new Map<string, { midX: number; jogX: number }>();
  for (const e of edges) {
    const g = geom.get(e.id);
    if (!g || !g.horizontal || waypointsById.has(e.id)) continue;
    const { from, to } = g;
    const midX = (from.x + to.x) / 2;
    const jogX = e.data?.jogOffset != null ? midX + e.data.jogOffset : laneJogX.get(e.id) ?? midX;
    jogInfo.set(e.id, { midX, jogX });
    polylines.push({
      id: e.id,
      pts: simplifyOrthogonal([
        { x: from.x, y: from.y },
        { x: jogX, y: from.y },
        { x: jogX, y: to.y },
        { x: to.x, y: to.y },
      ]),
    });
  }
  const nudged = nudgeCollinearOverlaps(polylines);

  // Post-lane hard-constraint recheck: assignLanes/nudge move a run's jog without consulting
  // boxes, so a lane can land inside a device the midpoint Z cleared. Any run whose FINAL
  // polyline pierces a box core is demoted to the general A* detour — it loses its lane slot
  // but keeps the "never behind a device" constraint. User-pinned jogs (jogOffset) are
  // respected as-is: an explicit drag outranks the automatic constraint.
  for (const e of edges) {
    const g = geom.get(e.id);
    if (!g || !g.horizontal || waypointsById.has(e.id)) continue;
    if (e.data?.jogOffset != null) continue;
    const interior = nudged.get(e.id);
    if (!interior) continue;
    const { from, to } = g;
    const full: Pt[] = [{ x: from.x, y: from.y }, ...interior, { x: to.x, y: to.y }];
    const obstacles = othersOf(e, from, to);
    const own = ownOf(e);
    if (!pathHitsObstacle(full, coresOf(obstacles)) && !pathHitsObstacle(full, coresOf(own))) continue;
    const wp = detour(
      { x: from.x, y: from.y, dir: from.dir },
      { x: to.x, y: to.y, dir: to.dir },
      from,
      to,
      obstacles,
      own,
      crossContextOf(ctxEntries.filter((en) => en.id !== e.id).map((en) => en.pts)),
    );
    if (wp) {
      nudged.delete(e.id);
      jogInfo.delete(e.id);
      waypointsById.set(e.id, wp);
    } else {
      giveUps.push(e.id);
    }
  }

  // A detour's spread path wins over the nudged Z (disjoint by construction).
  const waypoints = new Map<string, Pt[]>(nudged);
  for (const [id, wp] of waypointsById) waypoints.set(id, wp);

  const ends = new Map<string, EdgeEnds>();
  for (const [id, g] of geom) {
    ends.set(id, { sx: g.from.x, sy: g.from.y, tx: g.to.x, ty: g.to.y, sourceSide: g.from.side, targetSide: g.to.side });
  }
  return { waypoints, jogInfo, ends, giveUps };
}

export const newRouter: Router = { route };
