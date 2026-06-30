import { describe, it, expect } from "vitest";
import { computeHops, cablePath, smoothStepPolyline } from "./cableHops";
import { orthogonalPathD } from "./obstacleRoute";
import type { Pt } from "./obstacleRoute";

const line = (...pts: [number, number][]): Pt[] => pts.map(([x, y]) => ({ x, y }));

describe("computeHops", () => {
  it("hops the horizontal cable over the vertical at a true crossing", () => {
    const hops = computeHops(
      new Map<string, Pt[]>([
        ["h", line([0, 10], [20, 10])], // horizontal
        ["v", line([10, 0], [10, 20])], // vertical — crosses at (10,10)
      ]),
    );
    expect(hops.get("h")).toEqual([{ x: 10, y: 10 }]); // the horizontal wire bumps
    expect(hops.get("v")).toBeUndefined(); // the vertical stays flat
  });

  it("draws no hop for parallel runs or a shared endpoint (junction, not a crossing)", () => {
    const parallel = computeHops(
      new Map<string, Pt[]>([
        ["a", line([0, 0], [20, 0])],
        ["b", line([0, 5], [20, 5])],
      ]),
    );
    expect(parallel.size).toBe(0);
    // An L-joint meeting exactly at (10,10) is an endpoint, not a strict-interior crossing.
    const joint = computeHops(
      new Map<string, Pt[]>([
        ["h", line([0, 10], [10, 10])],
        ["v", line([10, 10], [10, 20])],
      ]),
    );
    expect(joint.size).toBe(0);
  });

  it("bumps once per crossing when a horizontal run spans several verticals", () => {
    const hops = computeHops(
      new Map<string, Pt[]>([
        ["h", line([0, 10], [30, 10])],
        ["v1", line([10, 0], [10, 20])],
        ["v2", line([20, 0], [20, 20])],
      ]),
    );
    expect(hops.get("h")).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]);
  });

  it("ignores far-apart cables via the bounding-box prefilter (no false crossing)", () => {
    const hops = computeHops(
      new Map<string, Pt[]>([
        ["h", line([0, 10], [20, 10])],
        ["v", line([100, 0], [100, 20])], // nowhere near h
      ]),
    );
    expect(hops.size).toBe(0);
  });
});

describe("smoothStepPolyline", () => {
  it("reconstructs a midpoint Z for horizontal ports at different heights", () => {
    expect(smoothStepPolyline(0, 0, true, 100, 40, true)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it("is a straight line when horizontal ports are level", () => {
    expect(smoothStepPolyline(0, 10, true, 100, 10, true)).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
  });

  it("lets two no-waypoint runs hop where their reconstructed paths cross", () => {
    const a = smoothStepPolyline(0, 50, true, 200, 50, true); // straight horizontal at y=50
    const b = smoothStepPolyline(100, 0, false, 100, 100, false); // straight vertical at x=100
    const hops = computeHops(
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );
    expect(hops.get("a")).toEqual([{ x: 100, y: 50 }]); // the horizontal run bumps over the vertical
    expect(hops.get("b")).toBeUndefined();
  });
});

describe("cablePath", () => {
  it("draws identically to orthogonalPathD when there are no hops", () => {
    const pts = line([0, 0], [10, 0], [10, 10]);
    expect(cablePath(pts, 8, [])).toBe(orthogonalPathD(pts, 8));
  });

  it("splices an arc bump into the horizontal run at a hop", () => {
    const pts = line([0, 10], [40, 10]); // a horizontal run
    const d = cablePath(pts, 8, [{ x: 20, y: 10 }]);
    expect(d).toContain("A 6 6 0 0 1"); // a hop arc (sweep 1 = travelling +x, bulging up)
    expect(d).toContain("L 14,10"); // line up to HOP_RADIUS before the crossing (20-6)
  });

  it("skips a hop too close to a run end (would collide a corner)", () => {
    const pts = line([0, 10], [40, 10]);
    expect(cablePath(pts, 8, [{ x: 3, y: 10 }])).not.toContain("A "); // 3px in — within HOP_RADIUS
  });
});
