import { describe, it, expect } from "vitest";
import { planPromoteZone } from "./nesting";
import type { CableEdgeType, DeviceNodeType, SigNode, ZoneNodeType } from "./types";
import type { Port } from "../schema";

function dev(id: string, position: { x: number; y: number }, ports: Port[]): DeviceNodeType {
  return {
    id,
    type: "device",
    position,
    data: { model: { id: `m-${id}`, model: id, category: "other", source: "builtin", ports } },
  };
}

// A zone big enough that a node placed near its origin counts as a member (center-point test).
function zone(id: string): ZoneNodeType {
  return {
    id,
    type: "zone",
    position: { x: 0, y: 0 },
    width: 600,
    height: 400,
    data: { label: "Room", color: "#888" },
  };
}

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): CableEdgeType {
  return { id, source, sourceHandle, target, targetHandle };
}

const ids = { diagramId: "d-room", blockId: "blk-room" };

describe("planPromoteZone — boundary parity with embed", () => {
  it("publishes dangling and crossing member ports, but not internally-wired ones", () => {
    const A = dev("A", { x: 40, y: 40 }, [
      { id: "ao", name: "Out", direction: "output", connector: "sdi" },
      { id: "ai", name: "In", direction: "input", connector: "sdi" },
    ]);
    const B = dev("B", { x: 300, y: 40 }, [
      { id: "bo", name: "Out", direction: "output", connector: "sdi" },
      { id: "bi", name: "In", direction: "input", connector: "sdi" },
    ]);
    const X = dev("X", { x: 1000, y: 1000 }, [{ id: "xo", name: "Feed", direction: "output", connector: "sdi" }]);
    const nodes: SigNode[] = [zone("z"), A, B, X];
    const edges: CableEdgeType[] = [
      edge("e-int", "A", "ao", "B", "bi"), // both inside → internal run, wires A:ao and B:bi
      edge("e-cross", "X", "xo", "A", "ai"), // outside → inside → crossing, publishes A:ai
    ];

    const plan = planPromoteZone(nodes[0] as ZoneNodeType, nodes, edges, ids);
    const bpIds = plan.boundary.ports.map((p) => p.id).sort();

    // A:ai is published because a cable crosses into it; B:bo is published because it's a
    // dangling output (the new parity behavior). A:ao and B:bi are wired internally → hidden.
    expect(bpIds).toEqual(["bp-A-ai", "bp-B-bo"]);
    expect(bpIds).not.toContain("bp-A-ao");
    expect(bpIds).not.toContain("bp-B-bi");

    // The internal run moves into the sub-diagram; the crossing run re-points onto the block.
    expect(plan.subEdges.map((e) => e.id)).toEqual(["e-int"]);
    const crossed = plan.hostEdges.find((e) => e.id === "e-cross");
    expect(crossed?.target).toBe(ids.blockId);
    expect(crossed?.targetHandle).toBe("bp-A-ai");
    expect(plan.movedDeviceCount).toBe(2);
  });

  it("exposes the full interface of a wholly-unwired room (no longer an unwireable block)", () => {
    const C = dev("C", { x: 40, y: 40 }, [
      { id: "co", name: "Out", direction: "output", connector: "sdi" },
      { id: "ci", name: "In", direction: "input", connector: "sdi" },
    ]);
    const nodes: SigNode[] = [zone("z"), C];

    const plan = planPromoteZone(nodes[0] as ZoneNodeType, nodes, [], ids);

    expect(plan.boundary.ports.map((p) => p.id)).toEqual(["bp-C-co", "bp-C-ci"]);
    expect(plan.boundary.ports.every((p) => p.internal.instanceId === "C")).toBe(true);
  });
});
