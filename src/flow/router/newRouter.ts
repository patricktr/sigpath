import { legacyRouter } from "./legacyRouter";
import { routeOrthogonal } from "./orthogonalRoute";
import type { ExitDir } from "./orthogonalRoute";
import type { Rect } from "../obstacleRoute";
import { rectContains } from "../obstacleRoute";
import { inputPorts, outputPorts, bidirectionalPorts } from "../../schema";
import type { Port } from "../../schema";
import { approxPortY } from "../parallelLanes";
import { isPortBearing } from "../types";
import type { PortBearingNode, SigNode } from "../types";
import type { PortSide, Router, RouteRequest, RouteResult } from "./types";

/**
 * The general router (p2-bidiroute, first slice). It DELEGATES the tuned common case —
 * right-output → left-input runs — to {@link legacyRouter} unchanged (so that path cannot
 * regress), and itself owns ONLY the runs the legacy gate drops today: any run touching a
 * bidirectional/bottom (or otherwise non-output→input) port, which currently fall through to
 * React Flow's smooth-step and cut straight through device boxes. It routes those with the
 * direction-aware orthogonal A* (orthogonalRoute), avoiding every box on all sides.
 *
 * Geometry note: for a bottom (bidi) jack the anchor X is estimated by even spacing along the
 * device's bottom edge — the exact handle position isn't needed here because CableEdge stitches
 * the real measured endpoint and snaps the exit perpendicular (the axis-aware snap). Device
 * size uses measured dims when present, falling back to the same port-count estimate as the
 * obstacle pass; the estimate under-covers a bidi device's bottom bank for the transient
 * pre-measure frame only (the steady state is measured-correct — see design §3.1 / risk #2).
 */

/** Box size, mirroring legacyRouter's obstacleRects (measured first, port-count estimate fallback). */
function deviceSize(n: PortBearingNode): { w: number; h: number } {
  const w = n.measured?.width ?? n.width ?? 168;
  const ports = Math.max(inputPorts(n.data.model).length, outputPorts(n.data.model).length, 1);
  const h = n.measured?.height ?? n.height ?? approxPortY(ports - 1) + 24;
  return { w, h };
}

/** Every box a cable must avoid — devices/blocks, plus opted-in zone/note obstacles. Mirrors
 *  the legacy obstacle collection so both routers (and the box-interior gate) see the same field. */
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

/** Resolve a port's canvas anchor + which side it exits. Input→left, output→right,
 *  bidirectional→bottom (anchor X estimated by even spacing along the bottom edge). */
function portGeom(node: PortBearingNode, port: Port): { x: number; y: number; side: PortSide; dir: ExitDir } {
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
  // bidirectional → bottom edge, evenly spaced by index among the device's bidi ports.
  const bidi = bidirectionalPorts(model);
  const i = Math.max(0, bidi.findIndex((p) => p.id === port.id));
  const frac = (i + 1) / (bidi.length + 1);
  return { x: node.position.x + w * frac, y: node.position.y + h, side: "B", dir: SIDE_DIR.B };
}

function route(req: RouteRequest): RouteResult {
  const { nodes, edges } = req;
  // The tuned common case stays byte-identical — legacy owns every output→input run.
  const base = legacyRouter.route(req);
  const waypoints = new Map(base.waypoints);
  const ends = new Map(base.ends);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rects = collectObstacleRects(nodes);

  for (const e of edges) {
    if (base.ends.has(e.id)) continue; // already routed by legacy (output→input)
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!isPortBearing(src) || !isPortBearing(tgt)) continue;
    const sp = src.data.model.ports.find((p) => p.id === e.sourceHandle);
    const tp = tgt.data.model.ports.find((p) => p.id === e.targetHandle);
    if (!sp || !tp) continue;

    const from = portGeom(src, sp);
    const to = portGeom(tgt, tp);
    // Avoid every box except this run's own two ends, and any region wrapping an endpoint.
    const obstacles = rects
      .filter(
        (d) =>
          d.id !== e.source &&
          d.id !== e.target &&
          !rectContains(d.rect, { x: from.x, y: from.y }) &&
          !rectContains(d.rect, { x: to.x, y: to.y }),
      )
      .map((d) => d.rect);

    // The run's own two devices: A* obstacles (route around them) but allowed for the stub.
    const ownRects = rects.filter((d) => d.id === e.source || d.id === e.target).map((d) => d.rect);
    const interior = routeOrthogonal(from, to, obstacles, ownRects);
    ends.set(e.id, { sx: from.x, sy: from.y, tx: to.x, ty: to.y, sourceSide: from.side, targetSide: to.side });
    if (interior && interior.length) waypoints.set(e.id, interior);
  }

  return { waypoints, jogInfo: base.jogInfo, ends };
}

export const newRouter: Router = { route };
