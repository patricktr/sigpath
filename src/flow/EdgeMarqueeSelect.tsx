import { useEffect, useRef } from "react";
import { useStore } from "@xyflow/react";

/**
 * React Flow's marquee selects nodes and the edges *connected to* those nodes — so a
 * box drawn over the middle of cables (with their devices outside the box) selects
 * nothing. This invisible helper closes that gap: it watches the store's user-selection
 * rectangle and, when the marquee ends, hands the rect (+ viewport transform) to App,
 * which adds any cable whose path the rectangle intersects. Must live inside <ReactFlow>
 * to read the store. See App.selectEdgesInMarquee.
 */
type Rect = { x: number; y: number; width: number; height: number };
type Transform = [number, number, number];

export function EdgeMarqueeSelect({
  onMarqueeEnd,
}: {
  onMarqueeEnd: (rect: Rect, transform: Transform) => void;
}) {
  const active = useStore((s) => s.userSelectionActive);
  const rect = useStore((s) => s.userSelectionRect);
  const transform = useStore((s) => s.transform);
  // Remember the last live rect: when the drag ends the store clears it, but we still
  // need its final bounds to test against.
  const last = useRef<{ rect: Rect; transform: Transform } | null>(null);

  useEffect(() => {
    if (active && rect) last.current = { rect, transform };
  }, [active, rect, transform]);

  useEffect(() => {
    if (!active && last.current) {
      onMarqueeEnd(last.current.rect, last.current.transform);
      last.current = null;
    }
  }, [active, onMarqueeEnd]);

  return null;
}
