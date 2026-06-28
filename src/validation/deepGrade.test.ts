import { describe, it, expect } from "vitest";
import { deepGrade } from "./deepGrade";
import type { BlockNodeType, CableEdgeType, DeviceNodeType, EditorDiagram } from "../flow/types";
import type { BoundaryPort, Port, SignalProfile } from "../schema";

const SHOW: SignalProfile = { videoFormat: "2160p59.94" }; // sdi ceiling = sdi-12g

const p = (id: string, direction: Port["direction"], grade?: string): Port => ({ id, name: id, direction, connector: "sdi", grade });

function dev(id: string, ports: Port[]): DeviceNodeType {
  return { id, type: "device", position: { x: 0, y: 0 }, data: { model: { id: `m-${id}`, model: id, category: "other", source: "builtin", ports } } };
}
function block(id: string, refDiagramId: string, ports: BoundaryPort[]): BlockNodeType {
  return {
    id, type: "block", position: { x: 0, y: 0 },
    data: { refDiagramId, model: { id: `block:${refDiagramId}`, model: "ref", category: "other", source: "builtin", ports }, boundaryRev: 1 },
  };
}
function edge(id: string, s: string, sh: string, t: string, th: string, data?: Record<string, unknown>): CableEdgeType {
  return { id, source: s, sourceHandle: sh, target: t, targetHandle: th, type: "cable", data: { cableTypeId: "", ...data } };
}

// A "Control Room": a 3G-rated inner cable behind a boundary input port.
const BP: BoundaryPort = { id: "bpi", name: "In", direction: "input", connector: "sdi", internal: { instanceId: "in", portId: "i" } };
const room = (): EditorDiagram => ({
  id: "R",
  name: "Control Room",
  nodes: [dev("in", [p("i", "input"), p("o", "output")]), dev("sink", [p("i", "input")])],
  edges: [edge("inner", "in", "o", "sink", "i", { cableGrade: "sdi-3g" })], // a 3G inner cable
  boundary: { ports: [BP], rev: 1 },
});

describe("deepGrade — propagation across a block boundary", () => {
  it("flags a 3G inner cable when a 12G host source feeds the room", () => {
    const host: EditorDiagram = {
      id: "H", name: "Event",
      nodes: [dev("src", [p("o", "output", "sdi-12g")]), block("blk", "R", [BP])],
      edges: [edge("host", "src", "o", "blk", "bpi")],
    };
    const res = deepGrade([host, room()], "H", SHOW);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].roomName).toBe("Control Room");
    expect(res.groups[0].issues.map((i) => i.title)).toContain("Cable under-rated");
    expect(res.errorBlockNodes.has("blk")).toBe(true);
  });

  it("does NOT flag when the host feed is only 3G", () => {
    const host: EditorDiagram = {
      id: "H", name: "Event",
      nodes: [dev("src", [p("o", "output", "sdi-3g")]), block("blk", "R", [BP])],
      edges: [edge("host", "src", "o", "blk", "bpi")],
    };
    const res = deepGrade([host, room()], "H", SHOW);
    expect(res.groups).toHaveLength(0);
    expect(res.errorBlockNodes.size).toBe(0);
  });

  it("N-embed: badges only the embed fed 12G, one deduped row at worst case", () => {
    const host: EditorDiagram = {
      id: "H", name: "Event",
      nodes: [
        dev("s3", [p("o", "output", "sdi-3g")]),
        dev("s12", [p("o", "output", "sdi-12g")]),
        block("blk3", "R", [BP]),
        block("blk12", "R", [BP]),
      ],
      edges: [edge("h3", "s3", "o", "blk3", "bpi"), edge("h12", "s12", "o", "blk12", "bpi")],
    };
    const res = deepGrade([host, room()], "H", SHOW);
    // Only the 12G-fed embed's block is badged.
    expect(res.errorBlockNodes.has("blk12")).toBe(true);
    expect(res.errorBlockNodes.has("blk3")).toBe(false);
    // One room group, one deduped issue (the cable is one physical cable in the room).
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].issues).toHaveLength(1);
  });

  it("returns nothing when no rooms are embedded", () => {
    const flat: EditorDiagram = {
      id: "H", name: "Event",
      nodes: [dev("src", [p("o", "output", "sdi-12g")]), dev("mon", [p("i", "input")])],
      edges: [edge("e", "src", "o", "mon", "i", { cableGrade: "sdi-3g" })],
    };
    const res = deepGrade([flat], "H", SHOW);
    expect(res.groups).toHaveLength(0);
  });
});
