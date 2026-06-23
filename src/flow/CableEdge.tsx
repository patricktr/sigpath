import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import type { CableEdgeType } from "./types";
import { LANE_GAP } from "./parallelLanes";
import "./CableEdge.css";

/**
 * The cable edge. Draws the smooth-step path; when a run changes connector but not
 * signal (a transition / adapter cable), its two ends differ in color, so we stroke
 * it with a source→target gradient — "the cable that is the converter." Straight
 * runs (same color both ends) carry no gradient and render as a flat color. The
 * gradient uses userSpaceOnUse coords so it follows the cable's real direction and
 * updates as nodes move. Validation overrides (red error / amber warning) win — they
 * set a solid stroke and clear the gradient before this renders. A cable ID, when
 * set, rides at the path midpoint as a small badge.
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
  // One of a bundle of parallel runs? Fan its smooth-step jog into its own lane.
  // For a horizontal run the jog is set by centerX (centerY only moves the label),
  // so we offset centerX for "h" and centerY for "v". The returned labelX/labelY
  // already follow the offset path — no separate label math. (Verified against
  // @xyflow/system getSmoothStepPath; see parallelLanes.ts.)
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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    ...center,
  });

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
