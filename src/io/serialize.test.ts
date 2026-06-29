import { describe, it, expect } from "vitest";
import { toDocument, fromDocument, synthesizeBlockModel } from "./serialize";
import type { EditorDiagram } from "../flow/types";
import type { BoundaryPort } from "../schema";

describe("serialize round-trip", () => {
  it("preserves a device's per-output-port signal pins (p2-deepgrade)", () => {
    const diagram: EditorDiagram = {
      id: "d1",
      name: "Stage",
      nodes: [
        {
          id: "cam",
          type: "device",
          position: { x: 0, y: 0 },
          data: {
            model: { id: "m", model: "Camera", category: "source", source: "builtin", ports: [
              { id: "sdi", name: "SDI Out", direction: "output", connector: "sdi", grade: "sdi-12g" },
            ] },
            signalPins: { sdi: "sdi-3g" },
          },
        },
      ],
      edges: [],
    };
    const doc = toDocument([diagram], { projectId: "p", projectName: "P" });
    const back = fromDocument(doc).diagrams[0];
    const cam = back.nodes.find((n) => n.id === "cam");
    expect(cam?.type).toBe("device");
    expect(cam?.type === "device" ? cam.data.signalPins : undefined).toEqual({ sdi: "sdi-3g" });
  });
});

describe("synthesizeBlockModel — curation seam (p2-zonetab Phase C)", () => {
  const bp = (id: string, hidden?: boolean): BoundaryPort => ({
    id,
    name: id,
    direction: "output",
    connector: "sdi",
    internal: { instanceId: "d", portId: id },
    ...(hidden ? { hidden: true } : {}),
  });

  it("drops hidden boundary ports from the block face, preserving order", () => {
    const ports = [bp("a"), bp("b", true), bp("c")];
    expect(synthesizeBlockModel("ref", { name: "Room", ports }).ports.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("yields an empty model for a missing reference", () => {
    expect(synthesizeBlockModel("ref").ports).toEqual([]);
  });
});
