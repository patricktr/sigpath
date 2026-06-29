import { describe, it, expect } from "vitest";
import { boundaryHash, hasBoundaryDrift, planBoundaryRefresh } from "./boundaryDrift";
import { deriveBoundary } from "./nesting";
import type { DeviceNodeType, EditorDiagram, SigNode } from "./types";
import type { BoundaryPort, Port } from "../schema";

function dev(id: string, ports: Port[]): DeviceNodeType {
  return {
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: { model: { id: `m-${id}`, model: id, category: "other", source: "builtin", ports } },
  };
}

function room(nodes: SigNode[]): EditorDiagram {
  return { id: "r", name: "Room", nodes, edges: [] };
}

const PORTS: Port[] = [
  { id: "pgm", name: "PGM", direction: "output", connector: "sdi" },
  { id: "in", name: "In", direction: "input", connector: "sdi" },
];

// A room with one switcher, both ports un-wired → deriveBoundary publishes both.
const base = room([dev("SW", PORTS)]);
const boundary = deriveBoundary(base);
const published: EditorDiagram = { ...base, boundary };

describe("deriveBoundary rev", () => {
  it("is a content hash of the published ports, not a constant", () => {
    expect(boundary.ports.map((p) => p.id)).toEqual(["bp-SW-pgm", "bp-SW-in"]);
    expect(boundary.rev).toBe(boundaryHash(boundary.ports));
  });
});

describe("boundaryHash", () => {
  it("is stable, and changes when a published port changes", () => {
    expect(boundaryHash(boundary.ports)).toBe(boundaryHash(boundary.ports));
    const renamed = boundary.ports.map((p, i) => (i === 0 ? { ...p, name: "Program" } : p));
    expect(boundaryHash(renamed)).not.toBe(boundaryHash(boundary.ports));
  });

  it("changes when a port is hidden (curation alters the embedded face)", () => {
    const hidden = boundary.ports.map((p, i) => (i === 0 ? { ...p, hidden: true } : p));
    expect(boundaryHash(hidden)).not.toBe(boundaryHash(boundary.ports));
  });
});

describe("hasBoundaryDrift", () => {
  it("is false when the boundary matches the live room", () => {
    expect(hasBoundaryDrift(published)).toBe(false);
  });
  it("is true when an inner device is deleted", () => {
    expect(hasBoundaryDrift({ ...room([]), boundary })).toBe(true);
  });
  it("is true when an inner port's connector is re-spec'd", () => {
    const respecced = { ...room([dev("SW", [PORTS[0], { ...PORTS[1], connector: "hdmi" }])]), boundary };
    expect(hasBoundaryDrift(respecced)).toBe(true);
  });
});

describe("planBoundaryRefresh", () => {
  it("is a no-op when nothing changed", () => {
    const plan = planBoundaryRefresh(published);
    expect(plan.removed).toEqual([]);
    expect(plan.changed).toEqual([]);
    expect(plan.rebound).toEqual([]);
    expect(boundaryHash(plan.nextPorts)).toBe(boundaryHash(boundary.ports));
  });

  it("preserves curation — hidden, renamed, and order — across a refresh (p2-zonetab Phase C)", () => {
    // A curated face: ports reordered (in before pgm), pgm hidden + renamed.
    const curated: BoundaryPort[] = [
      { ...boundary.ports[1] }, // bp-SW-in
      { ...boundary.ports[0], name: "Program", hidden: true, renamed: true }, // bp-SW-pgm
    ];
    const plan = planBoundaryRefresh({ ...base, boundary: { ports: curated, rev: boundaryHash(curated) } });
    expect(plan.nextPorts.map((p) => p.id)).toEqual(["bp-SW-in", "bp-SW-pgm"]); // order kept
    const pgm = plan.nextPorts.find((p) => p.id === "bp-SW-pgm");
    expect(pgm?.hidden).toBe(true);
    expect(pgm?.renamed).toBe(true);
    expect(pgm?.name).toBe("Program"); // custom name kept
  });

  it("prunes ports whose inner device is gone", () => {
    const plan = planBoundaryRefresh({ ...room([]), boundary });
    expect(plan.removed.map((p) => p.id)).toEqual(["bp-SW-pgm", "bp-SW-in"]);
    expect(plan.nextPorts).toEqual([]);
  });

  it("re-mirrors a re-spec'd port, keeping its id", () => {
    const respecced = { ...room([dev("SW", [PORTS[0], { ...PORTS[1], connector: "hdmi" }])]), boundary };
    const plan = planBoundaryRefresh(respecced);
    expect(plan.removed).toEqual([]);
    expect(plan.changed.map((p) => p.id)).toEqual(["bp-SW-in"]);
    const next = plan.nextPorts.find((p) => p.id === "bp-SW-in");
    expect(next?.connector).toBe("hdmi");
    expect(next?.internal.portId).toBe("in"); // same inner port, just re-spec'd
  });

  it("re-binds across a wholesale model replace (new port ids, same signature), keeping bp ids", () => {
    // The host-cable-survival case: the inspector swaps the model, so port ids change but the
    // shape is identical. Refresh must re-match by signature and KEEP the boundary-port ids.
    const replaced = {
      ...room([
        dev("SW", [
          { id: "x", name: "X", direction: "output", connector: "sdi" },
          { id: "y", name: "Y", direction: "input", connector: "sdi" },
        ]),
      ]),
      boundary,
    };
    const plan = planBoundaryRefresh(replaced);
    expect(plan.removed).toEqual([]);
    expect(plan.rebound.map((p) => p.id).sort()).toEqual(["bp-SW-in", "bp-SW-pgm"]);
    const pgm = plan.nextPorts.find((p) => p.id === "bp-SW-pgm");
    expect(pgm?.id).toBe("bp-SW-pgm"); // stable id → host cable survives
    expect(pgm?.internal.portId).toBe("x"); // re-bound to the new output port
  });
});

describe("name re-mirror on refresh (p2-zonetab Phase C3)", () => {
  // The inner PGM port renamed in the room, with the published boundary still on the old label.
  const innerRenamed = room([dev("SW", [{ ...PORTS[0], name: "Program Bus" }, PORTS[1]])]);

  it("re-mirrors an un-renamed boundary port's label from its inner port", () => {
    const plan = planBoundaryRefresh({ ...innerRenamed, boundary });
    const pgm = plan.nextPorts.find((p) => p.id === "bp-SW-pgm");
    expect(pgm?.name.endsWith("· Program Bus")).toBe(true); // tracks the inner rename
    expect(plan.changed.map((p) => p.id)).toContain("bp-SW-pgm"); // counted as a re-mirror
  });

  it("keeps a user-renamed boundary label even when the inner port name changes", () => {
    const curated = boundary.ports.map((p) =>
      p.id === "bp-SW-pgm" ? { ...p, name: "Main PGM", renamed: true } : p,
    );
    const plan = planBoundaryRefresh({ ...innerRenamed, boundary: { ports: curated, rev: boundaryHash(curated) } });
    const pgm = plan.nextPorts.find((p) => p.id === "bp-SW-pgm");
    expect(pgm?.name).toBe("Main PGM"); // user override survives the inner rename
  });
});
