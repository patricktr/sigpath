import { segmentsCross } from "./obstacleRoute";
import type { Pt } from "./obstacleRoute";

/**
 * Crossing hops / bumps (p2-hops). Where two cables cross WITHOUT connecting, the schematic
 * convention is to draw a small arc on one so it reads as "passes over", not a junction. Cable
 * paths are orthogonal polylines, so every true crossing is exactly one horizontal × one vertical
 * segment — the HORIZONTAL wire always gets the hop (a deterministic, tie-free rule). These pure
 * helpers find the hop points per edge; the render layer splices the arcs into the path.
 */

/** A hop on one of an edge's horizontal segments — centered at (crossing x, that segment's y). */
export type Hop = { x: number; y: number };

const isHorizontal = (a: Pt, b: Pt) => Math.abs(a.y - b.y) <= 0.5;

type Bbox = { minX: number; minY: number; maxX: number; maxY: number };

function bboxOf(pts: Pt[]): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

const bboxesOverlap = (a: Bbox, b: Bbox) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * Hop points per edge for a set of cable polylines. A crossing is a true geometric crossing —
 * `segmentsCross` already excludes shared endpoints (junctions) and parallel/collinear runs — and
 * the horizontal segment's edge takes the hop at (the vertical's x, the horizontal's y). A
 * bounding-box prefilter skips edge pairs that can't meet, so the O(E²·S²) worst case rarely bites.
 */
export function computeHops(polylines: Map<string, Pt[]>): Map<string, Hop[]> {
  const ids: string[] = [];
  const segList: [Pt, Pt][][] = [];
  const bboxes: Bbox[] = [];
  for (const [id, pts] of polylines) {
    const segs: [Pt, Pt][] = [];
    for (let k = 1; k < pts.length; k++) segs.push([pts[k - 1], pts[k]]);
    ids.push(id);
    segList.push(segs);
    bboxes.push(bboxOf(pts));
  }

  const hops = new Map<string, Hop[]>();
  const push = (id: string, h: Hop) => {
    const list = hops.get(id);
    if (list) list.push(h);
    else hops.set(id, [h]);
  };

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!bboxesOverlap(bboxes[i], bboxes[j])) continue;
      for (const a of segList[i]) {
        for (const b of segList[j]) {
          if (!segmentsCross(a[0], a[1], b[0], b[1])) continue;
          // Exactly one segment is horizontal (segmentsCross requires perpendicular). The
          // horizontal one's edge hops, at (vertical's x, horizontal's y).
          if (isHorizontal(a[0], a[1])) push(ids[i], { x: b[0].x, y: a[0].y });
          else push(ids[j], { x: a[0].x, y: b[0].y });
        }
      }
    }
  }
  return hops;
}

// --- Render: the cable path string, with hop bumps spliced in --------------------------------

/** Radius of a hop bump — the little semicircle a horizontal wire arcs over a crossing with. */
const HOP_RADIUS = 6;

const manhattan = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** A point `r` from `corner` toward `toward` (segments are axis-aligned). */
function towards(corner: Pt, toward: Pt, r: number): Pt {
  const dx = toward.x - corner.x;
  const dy = toward.y - corner.y;
  const len = Math.abs(dx) + Math.abs(dy) || 1;
  return { x: corner.x + (dx / len) * r, y: corner.y + (dy / len) * r };
}

/** The straight run `start`→`end`, bumping UP over each hop on it (only a horizontal run carries
 *  hops). Hops within `HOP_RADIUS` of either end are skipped so a bump never collides a corner. */
function runWithHops(start: Pt, end: Pt, hops: Hop[]): string {
  if (Math.abs(start.y - end.y) > 0.5 || hops.length === 0) return ` L ${end.x},${end.y}`;
  const y = start.y;
  const lo = Math.min(start.x, end.x);
  const hi = Math.max(start.x, end.x);
  const dir = end.x >= start.x ? 1 : -1;
  const onRun = hops
    .filter((h) => Math.abs(h.y - y) <= 1.5 && h.x - lo > HOP_RADIUS && hi - h.x > HOP_RADIUS)
    .sort((a, b) => (a.x - b.x) * dir);
  if (onRun.length === 0) return ` L ${end.x},${end.y}`;
  let d = "";
  for (const h of onRun) {
    // Sweep 1 when travelling +x, 0 when −x, so the arc always bulges to smaller y (up/over).
    d += ` L ${h.x - HOP_RADIUS * dir},${y} A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 ${dir > 0 ? 1 : 0} ${h.x + HOP_RADIUS * dir},${y}`;
  }
  return d + ` L ${end.x},${y}`;
}

/**
 * Rounded-corner SVG path through an orthogonal polyline, with hop bumps (p2-hops) spliced into
 * the horizontal runs. Same corner geometry as `orthogonalPathD`, so a cable with no hops draws
 * identically — the bumps are the only addition.
 */
export function cablePath(points: Pt[], radius: number, hops: Hop[] = []): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x},${points[0].y}`;
  let cursor = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p = points[i];
    const p1 = points[i + 1];
    const r = Math.min(radius, manhattan(p0, p) / 2, manhattan(p, p1) / 2);
    d += runWithHops(cursor, towards(p, p0, r), hops); // straight run up to the corner entry
    const b = towards(p, p1, r);
    d += ` Q ${p.x},${p.y} ${b.x},${b.y}`; // rounded corner
    cursor = b;
  }
  return d + runWithHops(cursor, points[points.length - 1], hops);
}
