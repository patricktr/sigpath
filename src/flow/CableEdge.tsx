import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
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
    // Stitch the exact (measured) ports onto the routed interior, then snap the first/last
    // bend to the port's exit axis so the stub is exactly perpendicular: Y for a left/right
    // port (horizontal exit), X for a top/bottom (bidi) port (vertical exit). This both
    // absorbs the pixel-or-two of routing approximation AND pins a bidi run's exit to the
    // real jack X regardless of the router's estimated bottom-port anchor.
    const pts: Pt[] = [
      { x: sourceX, y: sourceY },
      ...waypoints.map((p) => ({ ...p })),
      { x: targetX, y: targetY },
    ];
    if (sourcePosition === Position.Left || sourcePosition === Position.Right) pts[1].y = sourceY;
    else pts[1].x = sourceX;
    if (targetPosition === Position.Left || targetPosition === Position.Right) pts[pts.length - 2].y = targetY;
    else pts[pts.length - 2].x = targetX;
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

  // The cable ID rides near BOTH ports (just OUTSIDE each, along its exit stub), not at
  // the midpoint, so a run reads at whichever end you trace from even when the middle is a
  // dense tangle. The badge follows the port's actual side — outward, never inset toward
  // the far end (which buries it inside the port's own device when a run doubles back) and
  // never on a horizontal offset for a bottom/top jack (where it would hide under the node).
  const inset = Math.min(34, Math.max(14, Math.abs(targetX - sourceX) * 0.38));
  const place = (x: number, y: number, pos: Position) => {
    switch (pos) {
      case Position.Left:
        return { x: x - inset, y };
      case Position.Top:
        return { x, y: y - 20 };
      case Position.Bottom:
        return { x, y: y + 20 };
      case Position.Right:
      default:
        return { x: x + inset, y };
    }
  };
  const srcLabel = place(sourceX, sourceY, sourcePosition);
  const tgtLabel = place(targetX, targetY, targetPosition);

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
            style={{ transform: `translate(-50%, -50%) translate(${srcLabel.x}px, ${srcLabel.y}px)` }}
          >
            {number}
          </div>
          <div
            className="cable-id-label"
            style={{ transform: `translate(-50%, -50%) translate(${tgtLabel.x}px, ${tgtLabel.y}px)` }}
          >
            {number}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
