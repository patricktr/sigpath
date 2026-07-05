import { describe, expect, it } from "vitest";
import { arrangeDiagram, autoHubId } from "./arrange";
import type { CableEdgeType, SigNode } from "./types";
import type { Port } from "../schema";

const P = (id: string, direction: Port["direction"], connector = "sdi"): Port => ({
  id,
  name: id,
  direction,
  connector,
});

const dev = (id: string, x: number, y: number, ports: Port[]): SigNode =>
  ({
    id,
    type: "device",
    position: { x, y },
    data: { model: { id: `m-${id}`, model: id, category: "other", source: "custom", ports } },
  }) as SigNode;

const zone = (id: string, x: number, y: number, w: number, h: number): SigNode =>
  ({
    id,
    type: "zone",
    position: { x, y },
    width: w,
    height: h,
    style: { width: w, height: h },
    data: { label: id, color: "#888" },
  }) as SigNode;

const cable = (id: string, source: string, sh: string, target: string, th: string): CableEdgeType =>
  ({
    id,
    source,
    target,
    sourceHandle: sh,
    targetHandle: th,
    type: "cable",
    data: { cableTypeId: "sdi" },
  }) as CableEdgeType;

const rectOf = (n: SigNode) => {
  const w = (typeof n.width === "number" ? n.width : undefined) ?? 168;
  const h = (typeof n.height === "number" ? n.height : undefined) ?? 96;
  return { x: n.position.x, y: n.position.y, w, h };
};
const overlaps = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const chainNodes = () => [
  dev("src", 500, 500, [P("o1", "output")]),
  dev("mid", 0, 0, [P("i1", "input"), P("o1", "output")]),
  dev("dst", 250, 900, [P("i1", "input")]),
];
const chainEdges = () => [cable("c1", "src", "o1", "mid", "i1"), cable("c2", "mid", "o1", "dst", "i1")];

describe("arrangeDiagram — flow mode", () => {
  it("ranks a chain left to right regardless of starting positions", () => {
    const out = arrangeDiagram(chainNodes(), chainEdges(), "flow");
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(x.src).toBeLessThan(x.mid);
    expect(x.mid).toBeLessThan(x.dst);
  });

  it("orients bidirectional runs instead of fighting the flow", () => {
    const nodes = [
      dev("cam", 0, 0, [P("o1", "output")]),
      dev("sw", 0, 200, [P("i1", "input"), P("net", "bidirectional", "rj45")]),
      dev("router", 0, 400, [P("net", "bidirectional", "rj45")]),
    ];
    const edges = [cable("c1", "cam", "o1", "sw", "i1"), cable("n1", "router", "net", "sw", "net")];
    const out = arrangeDiagram(nodes, edges, "flow");
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(x.cam).toBeLessThan(x.sw); // signal flow intact
  });

  it("never overlaps device boxes", () => {
    const nodes = [
      ...chainNodes(),
      dev("extra1", 10, 20, [P("i1", "input")]),
      dev("extra2", 12, 24, [P("i1", "input")]),
    ];
    const edges = [...chainEdges(), cable("c3", "src", "o1", "extra1", "i1"), cable("c4", "mid", "o1", "extra2", "i1")];
    const out = arrangeDiagram(nodes, edges, "flow").filter((n) => n.type === "device");
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(overlaps(rectOf(out[i]), rectOf(out[j]))).toBe(false);
      }
    }
  });

  it("keeps zone members inside their re-fitted zone rect (contiguity)", () => {
    const nodes = [
      zone("z1", -50, -50, 700, 700),
      ...chainNodes(), // src(500,500) + mid(0,0) centers inside z1; dst(250,900) outside
    ];
    const out = arrangeDiagram(nodes, chainEdges(), "flow");
    const z = rectOf(out.find((n) => n.id === "z1")!);
    for (const id of ["src", "mid"]) {
      const r = rectOf(out.find((n) => n.id === id)!);
      expect(r.x).toBeGreaterThanOrEqual(z.x);
      expect(r.y).toBeGreaterThanOrEqual(z.y);
      expect(r.x + r.w).toBeLessThanOrEqual(z.x + z.w);
      expect(r.y + r.h).toBeLessThanOrEqual(z.y + z.h);
    }
    // the outsider stays outside the zone rect
    const outR = rectOf(out.find((n) => n.id === "dst")!);
    expect(overlaps(outR, z)).toBe(false);
  });

  it("snaps positions to the 24px grid", () => {
    const out = arrangeDiagram(chainNodes(), chainEdges(), "flow");
    for (const n of out.filter((n) => n.type === "device")) {
      expect(n.position.x % 24).toBe(0);
      expect(n.position.y % 24).toBe(0);
    }
  });
});

describe("arrangeDiagram — hub mode", () => {
  const star = () => {
    const hub = dev("hub", 0, 0, [P("i1", "input"), P("i2", "input"), P("o1", "output"), P("o2", "output")]);
    const cams = [dev("cam1", 900, 0, [P("o1", "output")]), dev("cam2", 900, 300, [P("o1", "output")])];
    const outs = [dev("mon1", -900, 0, [P("i1", "input")]), dev("mon2", -900, 300, [P("i1", "input")])];
    const edges = [
      cable("e1", "cam1", "o1", "hub", "i1"),
      cable("e2", "cam2", "o1", "hub", "i2"),
      cable("e3", "hub", "o1", "mon1", "i1"),
      cable("e4", "hub", "o2", "mon2", "i1"),
    ];
    return { nodes: [hub, ...cams, ...outs], edges };
  };

  it("auto-detects the highest-degree device as hub", () => {
    const { nodes, edges } = star();
    expect(autoHubId(nodes, edges)).toBe("hub");
  });

  it("centers the hub with sources left and sinks right", () => {
    const { nodes, edges } = star();
    const out = arrangeDiagram(nodes, edges, "hub");
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(x.cam1).toBeLessThan(x.hub);
    expect(x.cam2).toBeLessThan(x.hub);
    expect(x.mon1).toBeGreaterThan(x.hub);
    expect(x.mon2).toBeGreaterThan(x.hub);
  });
});

describe("arrangeDiagram — zones + grid modes", () => {
  it("zones mode keeps each zone's members inside its rect and zones apart", () => {
    const nodes = [
      zone("za", -10, -10, 400, 300),
      zone("zb", 990, -10, 400, 300),
      dev("a1", 0, 0, [P("o1", "output")]),
      dev("a2", 0, 150, [P("o1", "output")]),
      dev("b1", 1000, 0, [P("i1", "input")]),
      dev("b2", 1000, 150, [P("i1", "input")]),
    ];
    const edges = [cable("c1", "a1", "o1", "b1", "i1"), cable("c2", "a2", "o1", "b2", "i1")];
    const out = arrangeDiagram(nodes, edges, "zones");
    const za = rectOf(out.find((n) => n.id === "za")!);
    const zb = rectOf(out.find((n) => n.id === "zb")!);
    expect(overlaps(za, zb)).toBe(false);
    for (const [zid, ids] of [
      ["za", ["a1", "a2"]],
      ["zb", ["b1", "b2"]],
    ] as const) {
      const z = zid === "za" ? za : zb;
      for (const id of ids) {
        const r = rectOf(out.find((n) => n.id === id)!);
        expect(r.x).toBeGreaterThanOrEqual(z.x);
        expect(r.y + r.h).toBeLessThanOrEqual(z.y + z.h);
      }
    }
  });

  it("grid mode packs without overlaps", () => {
    const nodes = Array.from({ length: 9 }, (_, i) => dev(`d${i}`, i * 3, i * 5, [P("i1", "input")]));
    const out = arrangeDiagram(nodes, [], "grid");
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(overlaps(rectOf(out[i]), rectOf(out[j]))).toBe(false);
      }
    }
  });
});
