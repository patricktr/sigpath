import { describe, it, expect } from "vitest";
import { toDocument, fromDocument, synthesizeBlockModel } from "./serialize";
import type { EditorDiagram } from "../flow/types";
import type { BomRules, BoundaryPort } from "../schema";

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

  it("preserves cable note + install status and diagram bomProgress (p3-cableschedule)", () => {
    const diagram: EditorDiagram = {
      id: "d1",
      name: "Job",
      nodes: [
        {
          id: "a",
          type: "device",
          position: { x: 0, y: 0 },
          data: { model: { id: "m1", model: "Src", category: "source", source: "builtin", ports: [
            { id: "o", name: "Out", direction: "output", connector: "hdmi" },
          ] } },
        },
        {
          id: "b",
          type: "device",
          position: { x: 0, y: 0 },
          data: { model: { id: "m2", model: "Dst", category: "display", source: "builtin", ports: [
            { id: "i", name: "In", direction: "input", connector: "hdmi" },
          ] } },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          sourceHandle: "o",
          targetHandle: "i",
          type: "cable",
          data: { cableTypeId: "hdmi", note: "service loop", install: "terminated" },
        },
      ],
      bomProgress: { m1: 2 },
    };
    const back = fromDocument(toDocument([diagram], { projectId: "p", projectName: "P" })).diagrams[0];
    expect(back.edges[0].data?.note).toBe("service loop");
    expect(back.edges[0].data?.install).toBe("terminated");
    expect(back.bomProgress).toEqual({ m1: 2 });
  });

  it("preserves project BOM spare rules (p3-bomrules)", () => {
    const rules: BomRules = {
      default: { roundToStock: true, minSpares: 1, flatSpares: 0, ratioPerN: 8, percent: 10 },
      byType: { sdi: { roundToStock: false, minSpares: 0, flatSpares: 2, ratioPerN: 0, percent: 0 } },
    };
    const diagram: EditorDiagram = { id: "d1", name: "Job", nodes: [], edges: [] };
    const back = fromDocument(toDocument([diagram], { projectId: "p", projectName: "P", bomRules: rules }));
    expect(back.bomRules).toEqual(rules);
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
