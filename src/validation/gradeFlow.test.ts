import { describe, it, expect } from "vitest";
import { propagateDemand } from "./gradeFlow";
import type { DeviceNodeType, CableEdgeType, SigNode } from "../flow/types";
import type { Port, SignalProfile } from "../schema";

function dev(id: string, ports: Port[], signalPins?: Record<string, string>): DeviceNodeType {
  return {
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: { model: { id: `m-${id}`, model: id, category: "other", source: "builtin", ports }, ...(signalPins ? { signalPins } : {}) },
  };
}

const out = (id: string, grade?: string): Port => ({ id, name: id, direction: "output", connector: "sdi", grade });
const inp = (id: string): Port => ({ id, name: id, direction: "input", connector: "sdi" });

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>): CableEdgeType {
  return { id, source, sourceHandle, target, targetHandle, type: "cable", data: { cableTypeId: "", ...data } };
}

// 2160p59.94 → sdi ceiling is sdi-12g.
const SHOW: SignalProfile = { videoFormat: "2160p59.94" };
const demand = (nodes: SigNode[], edges: CableEdgeType[], profile = SHOW) => propagateDemand(nodes, edges, profile).demandByEdge;

describe("propagateDemand — the router worst-case", () => {
  // camA, camB → router → monitor. Router ports ungraded (a router routes anything anywhere).
  const router = dev("R", [inp("in1"), inp("in2"), out("o")]);
  const mon = dev("M", [inp("in")]);
  const wires = [
    edge("a", "camA", "o", "R", "in1"),
    edge("b", "camB", "o", "R", "in2"),
    edge("down", "R", "o", "M", "in"),
  ];

  it("leaves 3G downstream when ALL sources are 3G", () => {
    const nodes = [dev("camA", [out("o", "sdi-3g")]), dev("camB", [out("o", "sdi-3g")]), router, mon];
    expect(demand(nodes, wires).get("down")).toBe("sdi-3g"); // not the 12G show format
  });

  it("flags 12G downstream as soon as ONE source is 12G", () => {
    const nodes = [dev("camA", [out("o", "sdi-3g")]), dev("camB", [out("o", "sdi-12g")]), router, mon];
    expect(demand(nodes, wires).get("down")).toBe("sdi-12g");
  });

  it("an unknown-grade source is treated as the show format (conservative, unchanged)", () => {
    const nodes = [dev("camA", [out("o", "sdi-3g")]), dev("camB", [out("o")]), router, mon]; // camB ungraded
    expect(demand(nodes, wires).get("down")).toBe("sdi-12g");
  });
});

describe("propagateDemand — overrides", () => {
  const router = dev("R", [inp("in1"), inp("in2"), out("o")]);
  const mon = dev("M", [inp("in")]);
  const wires = [
    edge("a", "camA", "o", "R", "in1"),
    edge("b", "camB", "o", "R", "in2"),
    edge("down", "R", "o", "M", "in"),
  ];

  it("a source-output pin caps the branch downstream", () => {
    // camB is 12G-capable but pinned to emit at most 3G; with camA also 3G, downstream stays 3G.
    const nodes = [dev("camA", [out("o", "sdi-3g")]), dev("camB", [out("o", "sdi-12g")], { o: "sdi-3g" }), router, mon];
    const d = demand(nodes, wires);
    expect(d.get("b")).toBe("sdi-3g"); // the pinned feed
    expect(d.get("down")).toBe("sdi-3g"); // and it propagates
  });

  it("a per-cable signalGrade override pins that cable", () => {
    const nodes = [dev("camA", [out("o", "sdi-12g")]), dev("camB", [out("o", "sdi-3g")]), router, mon];
    const wiresOv = [
      edge("a", "camA", "o", "R", "in1", { signalGrade: "sdi-6g" }), // assert this run is only 6G
      edge("b", "camB", "o", "R", "in2"),
      edge("down", "R", "o", "M", "in"),
    ];
    const d = demand(nodes, wiresOv);
    expect(d.get("a")).toBe("sdi-6g");
    expect(d.get("down")).toBe("sdi-6g"); // 6G (capped) beats camB's 3G
  });
});

describe("propagateDemand — converters reset the family", () => {
  it("a converter's output re-originates in its own family", () => {
    const cam = dev("cam", [out("o", "sdi-12g")]);
    const conv: DeviceNodeType = {
      id: "conv",
      type: "device",
      position: { x: 0, y: 0 },
      data: { model: { id: "m-conv", model: "conv", category: "converter", source: "builtin", ports: [
        { id: "in", name: "in", direction: "input", connector: "sdi" },
        { id: "out", name: "out", direction: "output", connector: "hdmi", grade: "hdmi-2.0" },
      ] } },
    };
    const mon = dev("mon", [{ id: "in", name: "in", direction: "input", connector: "hdmi" }]);
    const wires = [edge("sdi", "cam", "o", "conv", "in"), edge("hdmi", "conv", "out", "mon", "in")];
    const d = demand([cam, conv, mon], wires);
    expect(d.get("sdi")).toBe("sdi-12g");
    expect(d.get("hdmi")).toBe("hdmi-2.0"); // fresh HDMI origin — NOT influenced by the 12G SDI
  });
});

describe("propagateDemand — needsShowFormat + cycles", () => {
  it("prompts for a format when a graded image run has none", () => {
    const nodes = [dev("cam", [out("o", "sdi-3g")]), dev("mon", [inp("in")])];
    const wires = [edge("e", "cam", "o", "mon", "in")];
    expect(propagateDemand(nodes, wires, undefined).needsShowFormat).toBe(true);
    expect(propagateDemand(nodes, wires, SHOW).needsShowFormat).toBe(false);
  });

  it("converges on a feedback cycle without hanging", () => {
    // src(3G) → A; A ⇄ B (loop). The 3G propagates around and stabilizes.
    const nodes = [
      dev("src", [out("o", "sdi-3g")]),
      dev("A", [inp("from-src"), inp("from-B"), out("o")]),
      dev("B", [inp("in"), out("o")]),
    ];
    const wires = [
      edge("s", "src", "o", "A", "from-src"),
      edge("ab", "A", "o", "B", "in"),
      edge("ba", "B", "o", "A", "from-B"),
    ];
    const d = demand(nodes, wires);
    expect(d.get("ab")).toBe("sdi-3g");
    expect(d.get("ba")).toBe("sdi-3g");
  });
});
