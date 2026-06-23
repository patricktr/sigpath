/**
 * Parallel-cable de-overlap. Cables between (roughly) the same corridor render as one
 * thick band because React Flow's smooth-step router puts every run's vertical jog at
 * the same centerX. This module clusters runs that share a visual corridor and assigns
 * each a lane index; CableEdge turns that index into a per-run centerX (horizontal runs)
 * or centerY (vertical runs) offset, fanning the jogs apart. See ROADMAP "Parallel
 * cables stay independent". Verified against @xyflow/system getSmoothStepPath: for a
 * Right→Left run the path's vertical jog is set by centerX (centerY only moves the label),
 * so centerX is the lever for horizontal runs and centerY for vertical ones.
 *
 * The clusterer is pure + deterministic (unit-tested). The geometry it consumes is
 * approximated from node positions + port indices in App's displayEdges; the actual
 * pixel offset is computed from real endpoints in CableEdge, so small approximation
 * error only affects which runs cluster and their order, never the final spacing.
 */

export type LaneAxis = "h" | "v";

/** A run reduced to what lane-grouping needs (approximate geometry is fine). */
export type LaneInput = {
  id: string;
  axis: LaneAxis;
  /** Natural jog coordinate spread per lane: centerX for "h", centerY for "v". */
  jog: number;
  /** Perpendicular span the run occupies (y-range for "h", x-range for "v"). */
  lo: number;
  hi: number;
  /** Stable ordering within a cluster (top→bottom for h, left→right for v). */
  order: number;
  /** Travel sign along the run: +1 when the target sits past the source in the
   *  ordering axis (h: target below source — run goes down), -1 when it runs back.
   *  Drives the lane-order flip so a downward fan nests instead of self-crossing. */
  dir: number;
};

export type Lane = { index: number; count: number; axis: LaneAxis };

/** Px the per-lane jogs are spread apart. Small — ports sit ~22px apart. Tunable. */
export const LANE_GAP = 18;

/** Two jogs within this many px (with overlapping spans) are the same corridor. */
const JOG_TOL = 40;

// --- Approximate handle-Y within a device node. Kept in sync with DeviceNode.css:
// header (6+6 pad + ~13 text ≈ 25) + body top pad (8) + half a port (8) = first port
// center ≈ 41 from the node top; ports stack at 16px height + 6px gap = 22px pitch.
export const NODE_FIRST_PORT_Y = 41;
export const NODE_PORT_PITCH = 22;
/** Approx vertical center of the i-th port in its column, relative to the node top. */
export const approxPortY = (indexInColumn: number) =>
  NODE_FIRST_PORT_Y + indexInColumn * NODE_PORT_PITCH;

const overlaps = (aLo: number, aHi: number, bLo: number, bHi: number) =>
  aLo < bHi && bLo < aHi;

/**
 * Cluster runs sharing a visual corridor (same axis, near-equal jog, overlapping
 * perpendicular spans) and assign each a lane index within its cluster. Singletons —
 * and runs that don't overlap anything — are omitted (no offset, today's exact look).
 * O(n²) over edges; fine for typical diagrams. Deterministic: ties broken by id.
 */
export function assignLanes(inputs: LaneInput[]): Map<string, Lane> {
  const n = inputs.length;
  const parent = inputs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = inputs[i];
      const b = inputs[j];
      if (a.axis === b.axis && Math.abs(a.jog - b.jog) <= JOG_TOL && overlaps(a.lo, a.hi, b.lo, b.hi)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const lanes = new Map<string, Lane>();
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    idxs.sort((x, y) => inputs[x].order - inputs[y].order || (inputs[x].id < inputs[y].id ? -1 : 1));
    // Lane index maps to jog position (lane 0 → leftmost jog for "h"). With the
    // runs ordered top→bottom, the topmost run jogs leftmost: that nests cleanly
    // when the bundle runs UP (target above source) — each lower run fans out
    // below the one before without crossing it. When the bundle runs DOWN the same
    // order self-crosses (every lower run's lead-in cuts across the descending
    // verticals above it), so flip the order: the BOTTOM run takes the leftmost
    // jog and the fan nests downward instead. Direction is the cluster's majority
    // sign — a clean device-to-device fan is unanimous; ties keep the up layout.
    const downward = idxs.reduce((sum, i) => sum + inputs[i].dir, 0) > 0;
    if (downward) idxs.reverse();
    const count = idxs.length;
    idxs.forEach((idx, lane) =>
      lanes.set(inputs[idx].id, { index: lane, count, axis: inputs[idx].axis }),
    );
  }
  return lanes;
}
