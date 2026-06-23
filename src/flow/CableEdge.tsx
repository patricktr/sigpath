import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import type { CableEdgeType } from "./types";
import type { Pt } from "./obstacleRoute";
import { orthogonalPathD, polylineMidpoint } from "./obstacleRoute";
import { LANE_GAP } from "./parallelLanes";
import "./CableEdge.css";

/** Corner rounding for the obstacle-detour path (matches the smooth-step feel). */
const BEND_RADIUS = 8;

/**
 * The cable edge. Draws the smooth-step path; when a run changes connector but not
 * signal (a transition / adapter cable), its two ends differ in color, so we stroke
 * it with a source→target gradient — "the cable that is the converter." Straight
 * runs (same color both ends) carry no gradient and render as a flat color. The
 * gradient uses userSpaceOnUse coords so it follows the cable's real direction and
 * updates as nodes move. Validation overrides (red error / amber warning) win — they
 * set a solid stroke and clear the gradient before this renders. A cable ID, when
 * set, rides at the path midpoint as a small badge.
 *
 * When the run is rerouted around device boxes, `data.waypoints` carries the detour's
 * interior bend points; we draw that rounded orthogonal path instead, stitching the
 * exact port endpoints onto its ends. Obstacle detours take precedence over the
 * parallel-lane jog offset (a rerouted run never participates in a lane bundle).
 */
export function CableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
  markerEnd,
}: EdgeProps<CableEdgeType>) {
  let path: string;
  let labelX: number;
  let labelY: number;

  const waypoints = data?.waypoints;
  if (waypoints && waypoints.length) {
    // Stitch exact ports onto the routed interior. The first/last bend share the
    // port's Y (the run leaves/enters horizontally), so snap them to the exact port
    // Y — the approximate routing Y can be a pixel or two off — keeping it orthogonal.
    const pts: Pt[] = [
      { x: sourceX, y: sourceY },
      ...waypoints.map((p) => ({ ...p })),
      { x: targetX, y: targetY },
    ];
    pts[1].y = sourceY;
    pts[pts.length - 2].y = targetY;
    path = orthogonalPathD(pts, BEND_RADIUS);
    const mid = polylineMidpoint(pts);
    labelX = mid.x;
    labelY = mid.y;
  } else {
    // One of a bundle of parallel runs? Fan its smooth-step jog into its own lane.
    // For a horizontal run the jog is set by centerX (centerY only moves the label),
    // so we offset centerX for "h" and centerY for "v". The returned labelX/labelY
    // already follow the offset path. (Verified against @xyflow/system; see
    // parallelLanes.ts.)
    const lane = data?.parallel;
    let center: { centerX?: number; centerY?: number } = {};
    if (lane) {
      const off = (lane.index - (lane.count - 1) / 2) * LANE_GAP;
      if (off !== 0) {
        center =
          lane.axis === "h"
            ? { centerX: (sourceX + targetX) / 2 + off }
            : { centerY: (sourceY + targetY) / 2 + off };
      }
    }
    const [p, lx, ly] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      ...center,
    });
    path = p;
    labelX = lx;
    labelY = ly;
  }

  const gradient = data?.gradient;
  const gradientId = `cablegrad-${id}`;
  const edgeStyle = gradient ? { ...style, stroke: `url(#${gradientId})` } : style;
  const number = data?.number;

  return (
    <>
      {gradient && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={gradient.from} />
            <stop offset="100%" stopColor={gradient.to} />
          </linearGradient>
        </defs>
      )}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle} />
      {number && (
        <EdgeLabelRenderer>
          <div
            className="cable-id-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {number}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
