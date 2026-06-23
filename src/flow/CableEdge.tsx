import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import type { CableEdgeType } from "./types";
import type { Pt } from "./obstacleRoute";
import { orthogonalPathD } from "./obstacleRoute";
import "./CableEdge.css";

/** Corner rounding for the orthogonal cable path (matches the smooth-step feel). */
const BEND_RADIUS = 8;

/**
 * The cable edge. App computes each device run's full orthogonal path (lane-offset Z or
 * obstacle detour, de-overlapped) and hands the interior bend points via `data.waypoints`;
 * we draw that rounded path, stitching the exact port endpoints onto its ends. A clean
 * straight run carries no waypoints and falls back to React Flow's smooth-step path.
 *
 * When a run changes connector but not signal (a transition / adapter cable), its two
 * ends differ in color, so we stroke it with a source→target gradient — "the cable that
 * is the converter." The gradient uses userSpaceOnUse coords so it follows the cable's
 * real direction. Validation overrides (red error / amber warning) win. The cable ID,
 * when set, rides near both ports as small badges.
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
  } else {
    // A clean straight run (no waypoints) — React Flow's default smooth-step path.
    const [p] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    path = p;
  }

  const gradient = data?.gradient;
  const gradientId = `cablegrad-${id}`;
  const edgeStyle = gradient ? { ...style, stroke: `url(#${gradientId})` } : style;
  const number = data?.number;

  // The cable ID rides near BOTH ports (just outside each), not at the midpoint, so a
  // run reads at whichever end you trace from even when the middle is a dense tangle.
  // Ports exit/enter horizontally, so the badges sit at the port Y, a short way along
  // the cable; the offset shrinks on a short run so the two badges don't collide.
  const dir = targetX >= sourceX ? 1 : -1;
  const inset = Math.min(34, Math.max(12, Math.abs(targetX - sourceX) * 0.38));
  const srcLabelX = sourceX + dir * inset;
  const tgtLabelX = targetX - dir * inset;

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
            style={{ transform: `translate(-50%, -50%) translate(${srcLabelX}px, ${sourceY}px)` }}
          >
            {number}
          </div>
          <div
            className="cable-id-label"
            style={{ transform: `translate(-50%, -50%) translate(${tgtLabelX}px, ${targetY}px)` }}
          >
            {number}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
