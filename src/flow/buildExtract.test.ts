import { describe, it, expect } from "vitest";
import { collectClosure, extractTabAsBuild, extractZoneAsBuild, remapBuildIds } from "./buildExtract";
import type { BlockNodeType, CableEdgeType, DeviceNodeType, EditorDiagram, ZoneNodeType } from "./types";
import type { Build } from "../schema";
import type { Port } from "../schema";

const PORTS: Port[] = [
  { id: "out", name: "Out", direction: "output", connector: "sdi" },
  { id: "in", name: "In", direction: "input", connector: "sdi" },
];

function devNode(id: string, pos: { x: number; y: number }): DeviceNodeType {
  return {
    id,
    type: "device",
    position: pos,
    data: { model: { id: `m-${id}`, model: id, category: "other", source: "builtin", ports: PORTS } },
  };
}

function blockNode(id: string, refDiagramId: string, pos: { x: number; y: number }): BlockNodeType {
  return {
    id,
    type: "block",
    position: pos,
    data: {
      refDiagramId,
      model: { id: `block:${refDiagramId}`, model: "ref", category: "other", source: "builtin", ports: [] },
      boundaryRev: 1,
    },
  };
}

function zoneNode(id: string, pos: { x: number; y: number }, size: { w: number; h: number }): ZoneNodeType {
  return {
    id,
    type: "zone",
    position: pos,
    width: size.w,
    height: size.h,
    style: { width: size.w, height: size.h },
    data: { label: "Stage", color: "#000" },
  };
}

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): CableEdgeType {
  return { id, source, sourceHandle, target, targetHandle, type: "cable", data: { cableTypeId: "" } };
}

const META = { name: "Flypack", id: "build-1", now: 1000 };
const asBuild = (r: Build | { error: string }): Build => {
  if ("error" in r) throw new Error(`expected a Build, got error: ${r.error}`);
  return r;
};

describe("collectClosure", () => {
  it("returns just the root when it embeds nothing", () => {
    const d: EditorDiagram = { id: "r", name: "r", nodes: [devNode("a", { x: 0, y: 0 })], edges: [] };
    expect(collectClosure("r", [d]).map((x) => x.id)).toEqual(["r"]);
  });

  it("includes transitively embedded diagrams, root first", () => {
    const root: EditorDiagram = { id: "r", name: "r", nodes: [blockNode("b", "child", { x: 0, y: 0 })], edges: [] };
    const child: EditorDiagram = { id: "child", name: "child", nodes: [blockNode("b2", "grand", { x: 0, y: 0 })], edges: [] };
    const grand: EditorDiagram = { id: "grand", name: "grand", nodes: [devNode("a", { x: 0, y: 0 })], edges: [] };
    expect(collectClosure("r", [root, child, grand]).map((x) => x.id)).toEqual(["r", "child", "grand"]);
  });
});

describe("extractTabAsBuild", () => {
  it("saves a flat tab, deriving a boundary from its un-wired ports", () => {
    const tab: EditorDiagram = {
      id: "tab",
      name: "tab",
      nodes: [devNode("a", { x: 0, y: 0 }), devNode("b", { x: 300, y: 0 })],
      edges: [edge("e", "a", "out", "b", "in")], // a.out → b.in wired; a.in + b.out dangle
    };
    const build = asBuild(extractTabAsBuild("tab", [tab], META));
    expect(build.rootDiagramId).toBe("tab");
    expect(build.diagrams).toHaveLength(1);
    expect(build.diagrams[0].devices).toHaveLength(2);
    expect(build.diagrams[0].connections).toHaveLength(1);
    // a.in and b.out are un-wired → exposed as the build's boundary face.
    expect(build.diagrams[0].boundary?.ports).toHaveLength(2);
  });

  it("carries the full embed closure so a nested build stays complete", () => {
    const root: EditorDiagram = {
      id: "root",
      name: "root",
      nodes: [devNode("a", { x: 0, y: 0 }), blockNode("blk", "child", { x: 300, y: 0 })],
      edges: [],
    };
    const child: EditorDiagram = { id: "child", name: "child", nodes: [devNode("c", { x: 0, y: 0 })], edges: [] };
    const build = asBuild(extractTabAsBuild("root", [root, child], META));
    expect(build.diagrams.map((d) => d.id).sort()).toEqual(["child", "root"]);
  });

  it("refuses an empty or missing tab", () => {
    const empty: EditorDiagram = { id: "tab", name: "tab", nodes: [], edges: [] };
    expect(extractTabAsBuild("tab", [empty], META)).toEqual({ error: expect.any(String) });
    expect(extractTabAsBuild("nope", [empty], META)).toEqual({ error: expect.any(String) });
  });
});

describe("extractZoneAsBuild", () => {
  // Zone rect (0,0)-(400,400). Device fallback box is 168x96, so a node centers at pos+(84,48).
  const inA = devNode("A", { x: 50, y: 50 }); // center (134, 98) — inside
  const inB = devNode("B", { x: 150, y: 150 }); // center (234, 198) — inside
  const out = devNode("C", { x: 600, y: 600 }); // center (684, 648) — outside
  const zone = zoneNode("z", { x: 0, y: 0 }, { w: 400, h: 400 });

  it("extracts only zone members, moving internal cables and publishing the full interface", () => {
    const nodes = [zone, inA, inB, out];
    const edges = [
      edge("internal", "A", "out", "B", "in"), // both inside → moves into the build (wires A.out, B.in)
      edge("crossing", "C", "out", "A", "in"), // enters the zone → boundary on A.in
    ];
    const build = asBuild(extractZoneAsBuild(zone, nodes, edges, [], META));
    expect(build.diagrams).toHaveLength(1);
    const root = build.diagrams[0];
    expect(root.id).toBe(build.rootDiagramId);
    expect(root.devices.map((d) => d.id).sort()).toEqual(["A", "B"]); // C excluded
    expect(root.connections).toHaveLength(1); // only the internal run moved
    // Full interface (parity with embed): the crossing port (A.in) AND the dangling port
    // (B.out) are published — A.out and B.in are wired internally so they stay hidden.
    expect(root.boundary?.ports).toHaveLength(2);
    const refs = root.boundary?.ports.map((p) => `${p.internal.instanceId}:${p.internal.portId}`).sort();
    expect(refs).toEqual(["A:in", "B:out"]);
  });

  it("refuses an empty zone", () => {
    const result = extractZoneAsBuild(zone, [zone, out], [], [], META);
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("remapBuildIds", () => {
  it("re-mints diagram ids and rewires refDiagramId, preserving device ids", () => {
    const tab: EditorDiagram = {
      id: "root",
      name: "root",
      nodes: [devNode("a", { x: 0, y: 0 }), blockNode("blk", "child", { x: 300, y: 0 })],
      edges: [],
    };
    const child: EditorDiagram = { id: "child", name: "child", nodes: [devNode("c", { x: 0, y: 0 })], edges: [] };
    const build = asBuild(extractTabAsBuild("root", [tab, child], META));

    const { diagrams, rootId } = remapBuildIds(build);
    const oldIds = new Set(build.diagrams.map((d) => d.id));
    // Every diagram id is fresh...
    expect(diagrams.every((d) => !oldIds.has(d.id))).toBe(true);
    // ...the root id points at a real remapped diagram...
    const newRoot = diagrams.find((d) => d.id === rootId)!;
    expect(newRoot).toBeTruthy();
    // ...the block's refDiagramId was rewired to the remapped child...
    const childRef = newRoot.blocks?.[0].refDiagramId;
    expect(diagrams.some((d) => d.id === childRef)).toBe(true);
    expect(oldIds.has(childRef!)).toBe(false);
    // ...and device ids (diagram-scoped) are untouched.
    expect(newRoot.devices.map((d) => d.id)).toEqual(["a"]);
  });
});
