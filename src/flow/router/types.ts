import type { Pt } from "../obstacleRoute";
import type { SigNode, CableEdgeType } from "../types";

/**
 * The cable-routing seam. Everything between App's `displayEdges` memo and the screen
 * is a pure function of geometry: nodes + edges in, interior waypoints out. The legacy
 * five-pass pipeline and the future general router (p2-router) both implement {@link Router},
 * so they are swappable behind one flag without touching the render path (validation
 * styling, gradients, the cable-ID badges, or the jogOffset nudge bar). See
 * design/CABLE-ROUTING.html §4.
 */

export type RouteRequest = {
  nodes: SigNode[];
  edges: CableEdgeType[];
};

/** Which edge of its device a port sits on: left input, right output, top, bottom (bidi). */
export type PortSide = "L" | "R" | "T" | "B";

/** The resolved endpoints of a routed run, in the geometry the router worked in. `*Side`
 *  drives the perpendicular exit (and the metric's post-stitch snap): Y for L/R, X for T/B. */
export type EdgeEnds = {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourceSide: PortSide;
  targetSide: PortSide;
};

export type RouteResult = {
  /**
   * Interior bend points per edge — the `CableEdge` `data.waypoints` contract (the exact
   * port endpoints are stitched on at render). Absent or empty ⇒ a clean straight run that
   * falls back to React Flow's smooth-step path.
   */
  waypoints: Map<string, Pt[]>;
  /**
   * Per-run jog geometry `{ midX, jogX }` consumed by the manual-nudge bar (jogInfoRef), so
   * the first ◀ ▶ nudge starts from where the run currently sits instead of jumping.
   */
  jogInfo: Map<string, { midX: number; jogX: number }>;
  /**
   * Resolved endpoints per routed edge — the geometry the router itself worked in. Exposed
   * (App ignores it) so routeMetrics / the shadow overlay can reconstruct the full post-stitch
   * polyline without duplicating endpoint resolution. Unrouted edges (bidi/bottom, today) are
   * absent. The single source of endpoint truth, per design §3.4.
   */
  ends: Map<string, EdgeEnds>;
};

export interface Router {
  route(req: RouteRequest): RouteResult;
}
