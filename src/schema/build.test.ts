import { describe, it, expect } from "vitest";
import { buildContentHash, buildPartCounts } from "./build";
import type { Build } from "./build";
import type { Connection } from "./connection";
import type { DeviceInstance } from "./device";
import type { BlockInstance, Diagram } from "./document";

function device(id: string): DeviceInstance {
  return {
    id,
    model: {
      id: `m-${id}`,
      model: id,
      category: "other",
      source: "builtin",
      ports: [
        { id: "out", name: "Out", direction: "output", connector: "sdi" },
        { id: "in", name: "In", direction: "input", connector: "sdi" },
      ],
    },
    position: { x: 0, y: 0 },
  };
}

// Name is held constant: it's content the hash includes (insert preserves it), so the
// id-independence tests must vary the diagram id alone, not the name.
function diagram(id: string, devices: DeviceInstance[], connections: Connection[] = [], blocks?: BlockInstance[]): Diagram {
  return { id, name: "tab", devices, connections, zones: [], annotations: [], ...(blocks ? { blocks } : {}) };
}

const block = (id: string, refDiagramId: string): BlockInstance => ({
  id,
  refDiagramId,
  position: { x: 0, y: 0 },
  boundaryRev: 1,
});

describe("buildContentHash", () => {
  it("is independent of the diagram ids that insert re-mints", () => {
    const a = diagram("d1", [device("x")]);
    const b = diagram("d1-renamed", [device("x")]); // identical content, different diagram id
    expect(buildContentHash([a], "d1")).toBe(buildContentHash([b], "d1-renamed"));
  });

  it("changes when device-level content changes", () => {
    const a = diagram("d1", [device("x")]);
    const b = diagram("d1", [device("y")]); // device id is content (preserved on insert)
    expect(buildContentHash([a], "d1")).not.toBe(buildContentHash([b], "d1"));
  });

  it("is independent of diagram ids and array order across a nested closure", () => {
    const childA = diagram("c", [device("z")]);
    const rootA = diagram("r", [device("x")], [], [block("blk", "c")]);
    const childB = diagram("c2", [device("z")]);
    const rootB = diagram("r2", [device("x")], [], [block("blk", "c2")]);
    // rootB/childB use different diagram ids AND are passed in the opposite array order.
    expect(buildContentHash([rootA, childA], "r")).toBe(buildContentHash([childB, rootB], "r2"));
  });
});

describe("buildPartCounts", () => {
  it("sums devices and cables across every diagram in the build", () => {
    const conn: Connection = {
      id: "c1",
      from: { instanceId: "a", portId: "out" },
      to: { instanceId: "b", portId: "in" },
      cableTypeId: "",
    };
    const build = {
      diagrams: [diagram("r", [device("a"), device("b")], [conn]), diagram("c", [device("d")])],
    } as Build;
    expect(buildPartCounts(build)).toEqual({ devices: 3, cables: 1 });
  });
});
