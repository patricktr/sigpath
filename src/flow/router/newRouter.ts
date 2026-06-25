import { routeOrthogonal } from "./orthogonalRoute";
import type { ExitDir } from "./orthogonalRoute";
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
import type { EdgeEnds, PortSide, Router, RouteRequest, RouteResult } from "./types";

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

/** Resolve a port's canvas anchor + which side it exits. Input→left, output→right,
 *  bidirectional→bottom (anchor X estimated by even spacing; CableEdge snaps the real jack). */
function portGeom(node: PortBearingNode, port: Port): Geom {
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
    const from = portGeom(src, sp);
    const to = portGeom(tgt, tp);
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
  const waypointsById = new Map<string, Pt[]>();
  for (const e of edges) {
    const g = geom.get(e.id);
    if (!g) continue;
    const { from, to, horizontal } = g;
    const obstacles = othersOf(e, from, to);
    const fromPt = { x: from.x, y: from.y };
    const toPt = { x: to.x, y: to.y };
    if (horizontal) {
      // Only reroute when the straight Z is actually blocked (else the lane pass handles it) —
      // identical trigger to legacy. Own devices are NOT obstacles here (a side exit can't
      // re-enter its own device), matching legacy and keeping the common case unchanged.
      const midX = (from.x + to.x) / 2;
      if (obstacles.length === 0) continue;
      if (!pathHitsObstacle(defaultRoutePoints(fromPt, toPt, midX), obstacles)) continue;
      const interior = routeOrthogonal({ ...fromPt, dir: from.dir }, { ...toPt, dir: to.dir }, obstacles, []);
      if (interior) {
        const centered = centerDetourVerticals([fromPt, ...interior, toPt], obstacles);
        waypointsById.set(e.id, centered.slice(1, -1));
      }
    } else {
      // Bidi/bottom-port (and any non-output→input) run: route around boxes incl. its own two
      // devices, so a bottom port whose target is above routes around, not up through, itself.
      const interior = routeOrthogonal({ ...fromPt, dir: from.dir }, { ...toPt, dir: to.dir }, obstacles, ownOf(e));
      if (interior && interior.length) waypointsById.set(e.id, interior);
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

  // A detour's spread path wins over the nudged Z (disjoint by construction).
  const waypoints = new Map<string, Pt[]>(nudged);
  for (const [id, wp] of waypointsById) waypoints.set(id, wp);

  const ends = new Map<string, EdgeEnds>();
  for (const [id, g] of geom) {
    ends.set(id, { sx: g.from.x, sy: g.from.y, tx: g.to.x, ty: g.to.y, sourceSide: g.from.side, targetSide: g.to.side });
  }
  return { waypoints, jogInfo, ends };
}

export const newRouter: Router = { route };
