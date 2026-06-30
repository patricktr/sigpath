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
