export type FlowRect = { x: number; y: number; w: number; h: number };

/**
 * Does an axis-aligned rectangle intersect the orthogonal smooth-step run from
 * (sx,sy) to (tx,ty)? The run is approximated by its three segments — a horizontal
 * stub at sy, a vertical jog at the mid-x, and a horizontal stub at ty — which is how
 * getSmoothStepPath draws a standard output→input cable. Exact for axis-aligned
 * segments; the rounded corners and any parallel-lane offset are sub-pixel here and
 * ignored. Pure + unit-tested.
 */
export function rectHitsRun(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  r: FlowRect,
): boolean {
  const rx2 = r.x + r.w;
  const ry2 = r.y + r.h;
  const hSeg = (y: number, x1: number, x2: number) =>
    y >= r.y && y <= ry2 && Math.max(x1, x2) >= r.x && Math.min(x1, x2) <= rx2;
  const vSeg = (x: number, y1: number, y2: number) =>
    x >= r.x && x <= rx2 && Math.max(y1, y2) >= r.y && Math.min(y1, y2) <= ry2;
  const cx = (sx + tx) / 2;
  return hSeg(sy, sx, cx) || vSeg(cx, sy, ty) || hSeg(ty, cx, tx);
}
