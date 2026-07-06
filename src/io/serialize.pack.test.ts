import { describe, expect, it } from "vitest";
import { documentToText, packDocument, parseDocument, toDocument } from "./serialize";
import type { EditorDiagram, SigNode } from "../flow/types";
import type { Port, Revision } from "../schema";

const P = (id: string, direction: Port["direction"]): Port => ({ id, name: `${id} jack`, direction, connector: "sdi" });

const MODEL = {
  id: "m-cam",
  model: "Studio Camera",
  category: "other" as const,
  source: "custom" as const,
  ports: [P("o1", "output"), P("o2", "output")],
};

const dev = (id: string, x: number): SigNode =>
  ({ id, type: "device", position: { x, y: 0 }, data: { model: MODEL } }) as SigNode;

const diagram = (id: string, deviceIds: string[]): EditorDiagram => ({
  id,
  name: `Diagram ${id}`,
  nodes: deviceIds.map((d, i) => dev(d, i * 300)),
  edges: [],
});

/** A doc with repeated models across live diagrams AND revisions — the dedup target. */
function richDoc() {
  const live = [diagram("d1", ["a", "b", "c"]), diagram("d2", ["d", "e"])];
  const snapDiagrams = toDocument([diagram("d1", ["a", "b"])], { projectId: "p", projectName: "t" }).project.diagrams;
  const revisions: Revision[] = [
    { id: "r1", at: 1, hash: "h1", snapshot: { name: "t", diagrams: snapDiagrams } },
    { id: "r2", at: 2, label: "milestone", hash: "h2", snapshot: { name: "t", diagrams: snapDiagrams } },
  ];
  return toDocument(live, { projectId: "p", projectName: "t", revisions });
}

describe("content-addressed packing (schema v10)", () => {
  it("round-trips losslessly through pack → text → parse", () => {
    const doc = richDoc();
    const back = parseDocument(documentToText(doc));
    expect(back.project.diagrams).toEqual(doc.project.diagrams);
    expect(back.project.revisions).toEqual(doc.project.revisions);
    expect(back.project.name).toBe(doc.project.name);
  });

  it("stores each unique device model exactly once", () => {
    const text = documentToText(richDoc());
    // 7 instances (5 live + 2 in snapshots) share ONE model — its distinctive port name
    // must appear once in the pool, not once per instance.
    expect(text.match(/o1 jack/g)?.length).toBe(1);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed.project.models).length).toBe(1);
  });

  it("dedupes identical revision snapshots into one blob", () => {
    const parsed = JSON.parse(documentToText(richDoc()));
    // both revisions reference the same diagram content
    expect(Object.keys(parsed.project.blobs).length).toBe(1);
    expect(parsed.project.revisions[0].manifest.diagrams).toEqual(parsed.project.revisions[1].manifest.diagrams);
    expect(parsed.project.revisions[0].snapshot).toBeUndefined();
  });

  it("is dramatically smaller than the v9 pretty format", () => {
    const doc = richDoc();
    const v9 = JSON.stringify(doc, null, 2).length;
    const v10 = documentToText(doc).length;
    expect(v10).toBeLessThan(v9 * 0.4);
  });

  it("still reads v9 files (inline models, full snapshots) unchanged", () => {
    const doc = richDoc();
    const v9Text = JSON.stringify(doc, null, 2); // the old writer format
    const back = parseDocument(v9Text);
    expect(back.project.diagrams).toEqual(doc.project.diagrams);
    expect(back.project.revisions).toEqual(doc.project.revisions);
  });

  it("inflates a missing model ref to a placeholder instead of crashing", () => {
    const packed = packDocument(richDoc());
    const damaged = JSON.parse(JSON.stringify(packed));
    damaged.project.models = {}; // wipe the pool
    const back = parseDocument(JSON.stringify(damaged));
    expect(back.project.diagrams[0].devices[0].model.model).toBe("Missing model");
  });

  it("drops a revision whose blob is missing but keeps the live project", () => {
    const packed = packDocument(richDoc());
    const damaged = JSON.parse(JSON.stringify(packed));
    damaged.project.blobs = {}; // wipe the revision pool
    const back = parseDocument(JSON.stringify(damaged));
    expect(back.project.revisions ?? []).toHaveLength(0);
    expect(back.project.diagrams).toHaveLength(2); // live content intact
  });
});
