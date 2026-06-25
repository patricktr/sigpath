import { assignLanes, approxPortY } from "../parallelLanes";
import type { LaneInput } from "../parallelLanes";
import {
  routeAroundObstacles,
  centerDetourVerticals,
  pathHitsObstacle,
  defaultRoutePoints,
  spreadDetourBundles,
  nudgeCollinearOverlaps,
  simplifyOrthogonal,
  rectContains,
} from "../obstacleRoute";
import type { Rect, Pt } from "../obstacleRoute";
import { inputPorts, outputPorts } from "../../schema";
import { isPortBearing } from "../types";
import type { Router, RouteRequest, RouteResult } from "./types";

/**
 * The original five-pass routing pipeline, lifted verbatim out of App's `displayEdges`
 * memo (P0 — lossless lift). Pure geometry, no React Flow / DOM:
 *
 *   1. collect device/block obstacle rects (zones/notes opt in)
 *   2. resolve output→input endpoints — the `App.tsx:558` gate is preserved HERE, so
 *      bidirectional/bottom-port runs are dropped and carry no waypoints (they fall back
 *      to smooth-step, exactly as before). The general router will own those.
 *   3. A* detour around any box a straight run would cross (routeAroundObstacles)
 *   4. fan co-located detours into lanes (spreadDetourBundles)
 *   5. crossing-minimizing lane assignment for clear runs (assignLanes) + collinear
 *      separation (nudgeCollinearOverlaps)
 *
 * The two output maps (detour waypoints, nudged Z interiors) are disjoint by construction
 * — the lane/nudge passes skip any edge already routed as a detour — and are merged with
 * the detour winning, reproducing the old `waypointsById.get(id) ?? nudged.get(id)`.
 */
function route(req: RouteRequest): RouteResult {
  const { nodes, edges } = req;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Cable obstacles: every device box, plus any zone/note explicitly flagged as an
  // obstacle. Zones are pass-through containers and notes are annotations, so they
  // only block routing when opted in (data.obstacle). Device height falls back to a
  // port-count estimate; a region's size needs React Flow's measure (skip until then).
  const obstacleRects: { id: string; rect: Rect }[] = [];
  for (const n of nodes) {
    // Devices and blocks are box obstacles; cables route around them. (A block is just
    // another port-bearing box here — its size comes from its synthesized port model.)
    if (isPortBearing(n)) {
      const w = n.measured?.width ?? n.width ?? 168;
      const ports = Math.max(inputPorts(n.data.model).length, outputPorts(n.data.model).length, 1);
      const h = n.measured?.height ?? n.height ?? approxPortY(ports - 1) + 24;
      obstacleRects.push({ id: n.id, rect: { x: n.position.x, y: n.position.y, w, h } });
    } else if ((n.type === "zone" || n.type === "note") && n.data.obstacle) {
      const w = n.measured?.width ?? (typeof n.width === "number" ? n.width : undefined);
      const h = n.measured?.height ?? (typeof n.height === "number" ? n.height : undefined);
      if (w && h) obstacleRects.push({ id: n.id, rect: { x: n.position.x, y: n.position.y, w, h } });
    }
  }

  // Approx output→input endpoints per standard horizontal run, shared by obstacle
  // routing and the parallel-lane pass. Only output(right)→input(left) device runs;
  // bidi (bottom) ports are deferred. The real offset is computed from exact
  // endpoints in CableEdge — this approximation only drives grouping + reroute.
  type Ends = { sx: number; sy: number; tx: number; ty: number };
  const endsById = new Map<string, Ends>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!isPortBearing(src) || !isPortBearing(tgt)) continue;
    const sp = src.data.model.ports.find((p) => p.id === e.sourceHandle);
    const tp = tgt.data.model.ports.find((p) => p.id === e.targetHandle);
    if (sp?.direction !== "output" || tp?.direction !== "input") continue;
    const si = outputPorts(src.data.model).findIndex((p) => p.id === sp.id);
    const ti = inputPorts(tgt.data.model).findIndex((p) => p.id === tp.id);
    const srcW = src.measured?.width ?? src.width ?? 168;
    endsById.set(e.id, {
      sx: src.position.x + srcW,
      sy: src.position.y + approxPortY(si < 0 ? 0 : si),
      tx: tgt.position.x,
      ty: tgt.position.y + approxPortY(ti < 0 ? 0 : ti),
    });
  }

  // Obstacle avoidance: a run whose straight Z passes through a device box (other
  // than its own two ends) is rerouted around the boxes. Only blocked runs reroute;
  // every clear run stays on the default path and joins the lane pass below.
  const waypointsById = new Map<string, Pt[]>();
  for (const e of edges) {
    const ends = endsById.get(e.id);
    if (!ends) continue;
    const from = { x: ends.sx, y: ends.sy };
    const to = { x: ends.tx, y: ends.ty };
    // Drop a cable's own two devices, and any region-obstacle it starts/ends inside
    // (a zone wrapping its endpoint can't be routed around).
    const obstacles = obstacleRects
      .filter(
        (d) =>
          d.id !== e.source &&
          d.id !== e.target &&
          !rectContains(d.rect, from) &&
          !rectContains(d.rect, to),
      )
      .map((d) => d.rect);
    if (obstacles.length === 0) continue;
    if (!pathHitsObstacle(defaultRoutePoints(from, to, (ends.sx + ends.tx) / 2), obstacles)) {
      continue;
    }
    const wp = routeAroundObstacles(from, to, obstacles);
    if (wp) {
      // Slide each descent to the middle of its open corridor — not hugging the box it
      // cleared or the device it enters.
      const centered = centerDetourVerticals([from, ...wp, to], obstacles);
      waypointsById.set(e.id, centered.slice(1, -1));
    }
  }

  // Fan apart detours that share a trunk (a whole bundle routing around one box)
  // so they read as separate lines instead of one merged trunk.
  if (waypointsById.size > 1) {
    const routes = [...waypointsById].map(([id, interior]) => {
      const ends = endsById.get(id)!;
      return { id, pts: [{ x: ends.sx, y: ends.sy }, ...interior, { x: ends.tx, y: ends.ty }] };
    });
    const spread = spreadDetourBundles(
      routes,
      obstacleRects.map((d) => d.rect),
    );
    for (const [id, interior] of spread) waypointsById.set(id, interior);
  }

  // Parallel-cable de-overlap: group clear runs sharing a corridor so CableEdge can
  // fan their jogs into lanes. Rerouted runs are excluded — their detour already
  // sets them apart.
  const laneInputs: LaneInput[] = [];
  for (const e of edges) {
    if (waypointsById.has(e.id)) continue;
    if (e.data?.jogOffset != null) continue; // pinned by the user — out of the optimizer
    const ends = endsById.get(e.id);
    if (!ends) continue;
    laneInputs.push({
      id: e.id,
      axis: "h",
      jog: (ends.sx + ends.tx) / 2,
      lo: Math.min(ends.sy, ends.ty),
      hi: Math.max(ends.sy, ends.ty),
      sx: ends.sx,
      sy: ends.sy,
      tx: ends.tx,
      ty: ends.ty,
    });
  }
  // Crossing-minimizing jog X per clustered run (unclustered runs keep their midpoint).
  const laneJogX = assignLanes(laneInputs);

  // Final de-overlap for the non-detour runs: build each as a lane-offset Z, then nudge
  // any runs of different cables that still lie on the same line a few px apart
  // (scrambled / cross-device overlaps the lane pass can't reach). Detours keep their
  // spread path untouched — it's already de-overlapped and crossing-minimized, and the
  // nudge (separation-only) would reintroduce crossings.
  const polylines: { id: string; pts: Pt[] }[] = [];
  const jogInfo = new Map<string, { midX: number; jogX: number }>();
  for (const e of edges) {
    if (waypointsById.has(e.id)) continue;
    const ends = endsById.get(e.id);
    if (!ends) continue;
    const midX = (ends.sx + ends.tx) / 2;
    const jogX = e.data?.jogOffset != null ? midX + e.data.jogOffset : laneJogX.get(e.id) ?? midX;
    jogInfo.set(e.id, { midX, jogX });
    polylines.push({
      id: e.id,
      pts: simplifyOrthogonal([
        { x: ends.sx, y: ends.sy },
        { x: jogX, y: ends.sy },
        { x: jogX, y: ends.ty },
        { x: ends.tx, y: ends.ty },
      ]),
    });
  }
  const nudged = nudgeCollinearOverlaps(polylines);

  // A detour's spread path wins over the nudged Z. The two are disjoint (the lane/nudge
  // loops skip any edge in waypointsById), so this reproduces `waypointsById.get(id) ??
  // nudged.get(id)` exactly. App still guards on `wp.length`, so empty interiors (a
  // straight run) fall back to smooth-step.
  const waypoints = new Map<string, Pt[]>(nudged);
  for (const [id, wp] of waypointsById) waypoints.set(id, wp);
  return { waypoints, jogInfo };
}

export const legacyRouter: Router = { route };
