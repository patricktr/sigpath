export type FlowRect = { x: number; y: number; w: number; h: number };

/**
 * Does the rectangle touch an orthogonal cable polyline — the run's REAL drawn geometry
 * (router waypoints, detours, trunk spines, smooth-step reconstruction)? For axis-aligned
 * segments, "segment bbox overlaps rect" IS intersection, so this stays exact and cheap.
 * Preferred over {@link rectHitsRun}, whose standard-Z approximation places a bidi run's
 * phantom hit-line at port row 0 (a marquee then "selects" a cable that isn't there).
 */
export function rectHitsPolyline(pts: { x: number; y: number }[], r: FlowRect): boolean {
  const rx2 = r.x + r.w;
  const ry2 = r.y + r.h;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (
      Math.max(a.x, b.x) >= r.x &&
      Math.min(a.x, b.x) <= rx2 &&
      Math.max(a.y, b.y) >= r.y &&
      Math.min(a.y, b.y) <= ry2
    ) {
      return true;
    }
  }
  return false;
}

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
