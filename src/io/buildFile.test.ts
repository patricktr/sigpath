import { describe, it, expect } from "vitest";
import { normalizeBuild, parseSigbuild, serializeBuild } from "./buildFile";
import type { Build } from "../schema";
import type { BlockInstance, Diagram } from "../schema";
import type { DeviceInstance } from "../schema";

function device(id: string): DeviceInstance {
  return {
    id,
    model: { id: `m-${id}`, model: id, category: "other", source: "builtin", ports: [] },
    position: { x: 0, y: 0 },
  };
}

function diagram(id: string, devices: DeviceInstance[], blocks?: BlockInstance[]): Diagram {
  return { id, name: id, devices, connections: [], zones: [], annotations: [], ...(blocks ? { blocks } : {}) };
}

const block = (id: string, refDiagramId: string): BlockInstance => ({ id, refDiagramId, position: { x: 0, y: 0 }, boundaryRev: 1 });

function build(diagrams: Diagram[], rootDiagramId: string): Build {
  return {
    formatVersion: 1,
    id: "b1",
    name: "Flypack",
    rev: 1,
    contentHash: "deadbeef",
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 6,
    rootDiagramId,
    diagrams,
  };
}

describe("serializeBuild / parseSigbuild", () => {
  it("round-trips a build through the .sigbuild wrapper", () => {
    const original = build([diagram("r", [device("a")])], "r");
    const parsed = parseSigbuild(serializeBuild(original));
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.build).toEqual(original);
  });

  it("rejects a file that isn't a build", () => {
    expect(() => parseSigbuild("{}")).toThrow();
    expect(() => parseSigbuild('{"build":{"diagrams":"nope"}}')).toThrow();
  });
});

describe("normalizeBuild", () => {
  it("drops a block that would close an embed cycle", () => {
    const d1 = diagram("d1", [device("a")], [block("b12", "d2")]);
    const d2 = diagram("d2", [device("b")], [block("b21", "d1")]); // back-edge d2 → d1
    const normalized = normalizeBuild(build([d1, d2], "d1"));
    const nd1 = normalized.diagrams.find((d) => d.id === "d1");
    const nd2 = normalized.diagrams.find((d) => d.id === "d2");
    expect(nd1?.blocks).toHaveLength(1); // forward edge kept
    expect(nd2?.blocks ?? []).toHaveLength(0); // back-edge dropped
  });
});
