import { describe, it, expect } from "vitest";
import { signalLayers, edgeSignalGroups, matchesActive, computeNodeDimming } from "./signalFilter";
import type { SignalKind } from "../schema";
import type { CableEdgeType, DeviceNodeType, SigNode } from "./types";
import type { Port } from "../schema";

function dev(id: string, ports: Port[]): DeviceNodeType {
  return {
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: { model: { id: `m-${id}`, model: id, category: "other", source: "builtin", ports } },
  };
}
const edge = (id: string, s: string, sh: string, t: string, th: string): CableEdgeType => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
});

describe("signalLayers", () => {
  it("lists present layers in canonical order with cable counts", () => {
    const A = dev("A", [
      { id: "v", name: "SDI", direction: "output", connector: "sdi" }, // video
      { id: "a", name: "XLR", direction: "output", connector: "xlr3" }, // audio
      { id: "n", name: "Net", direction: "output", connector: "rj45" }, // network — port only, no cable
    ]);
    const B = dev("B", [
      { id: "v", name: "SDI", direction: "input", connector: "sdi" },
      { id: "a", name: "XLR", direction: "input", connector: "xlr3" },
    ]);
    const layers = signalLayers([A, B], [edge("e1", "A", "v", "B", "v"), edge("e2", "A", "a", "B", "a")]);
    expect(layers.map((l) => l.kind)).toEqual(["video", "audio", "network"]); // canonical SIGNAL_KINDS order
    expect(layers.find((l) => l.kind === "video")?.count).toBe(1);
    expect(layers.find((l) => l.kind === "audio")?.count).toBe(1);
    expect(layers.find((l) => l.kind === "network")?.count).toBe(0); // present via a port, but no cable
  });
});

describe("edgeSignalGroups", () => {
  it("returns both endpoint groups for an adapter cable that crosses layers", () => {
    const A = dev("A", [{ id: "v", name: "SDI", direction: "output", connector: "sdi" }]); // video
    const B = dev("B", [{ id: "av", name: "HDMI", direction: "input", connector: "hdmi" }]); // av
    const byId = new Map<string, SigNode>([
      ["A", A],
      ["B", B],
    ]);
    const groups = edgeSignalGroups(edge("e", "A", "v", "B", "av"), byId);
    expect([...groups].sort()).toEqual(["av", "video"]);
  });
});

describe("matchesActive", () => {
  const set = (...k: SignalKind[]) => new Set<SignalKind>(k);
  it("matches everything when no filter is active (empty set)", () => {
    expect(matchesActive(set("video"), set())).toBe(true);
  });
  it("matches when any of the item's groups is active", () => {
    expect(matchesActive(set("av", "video"), set("video"))).toBe(true); // adapter cable, video active
    expect(matchesActive(set("audio"), set("video", "network"))).toBe(false);
  });
});

describe("computeNodeDimming", () => {
  const A = dev("A", [
    { id: "v", name: "SDI", direction: "output", connector: "sdi" }, // video
    { id: "a", name: "XLR", direction: "output", connector: "xlr3" }, // audio
    { id: "n", name: "Net", direction: "output", connector: "rj45" }, // network, left unwired
  ]);
  const B = dev("B", [
    { id: "v", name: "SDI", direction: "input", connector: "sdi" },
    { id: "a", name: "XLR", direction: "input", connector: "xlr3" },
  ]);
  const nodes: SigNode[] = [A, B];
  const edges = [edge("e1", "A", "v", "B", "v")]; // one video cable

  it("flow mode: active only if a matching cable touches it; only carried ports stay lit", () => {
    const video = computeNodeDimming(nodes, edges, new Set(["video"]), false);
    expect([...video.activeNodeIds].sort()).toEqual(["A", "B"]);
    expect([...(video.litPorts.get("A") ?? [])]).toEqual(["v"]); // a, n unlit — no cable carries them
    const audio = computeNodeDimming(nodes, edges, new Set(["audio"]), false);
    expect(audio.activeNodeIds.size).toBe(0); // no audio cable → audio layer lights nothing
  });

  it("capability mode: active if it has a matching port, lit wired-or-not", () => {
    const audio = computeNodeDimming(nodes, edges, new Set(["audio"]), true);
    expect([...audio.activeNodeIds].sort()).toEqual(["A", "B"]); // both have an XLR
    expect([...(audio.litPorts.get("A") ?? [])]).toEqual(["a"]);
    const net = computeNodeDimming(nodes, edges, new Set(["network"]), true);
    expect([...net.activeNodeIds]).toEqual(["A"]); // only A has rj45
    expect([...(net.litPorts.get("A") ?? [])]).toEqual(["n"]); // unwired, but lit for patching
  });
});
