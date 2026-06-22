import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import type { CableEdgeType } from "./types";
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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
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
