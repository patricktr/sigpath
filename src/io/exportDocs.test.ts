import { describe, it, expect } from "vitest";
import { scheduleToTsv, listsToPdfBase64, listsToXlsxBase64, labelsToPdfBase64 } from "./exportDocs";
import type { DerivedLists } from "../lists/derive";

const lists: DerivedLists = {
  devices: [{ key: "a", name: "Apple TV 4K", count: 2 }],
  cables: [{ id: "hdmi", label: "HDMI", color: "#3b82f6", count: 1, lengthMeters: 3 }],
  adapters: [{ key: "psu-x", label: "PSU — X", color: "#f87171", count: 1, kind: "psu" }],
  patches: [
    {
      id: "e1",
      cableId: "AV-001",
      length: 3,
      fromDevice: "Apple TV 4K",
      fromPort: "HDMI",
      fromConnector: "HDMI",
      toDevice: "LG OLED C3",
      toPort: "HDMI 1",
      toConnector: "HDMI",
      cableType: "HDMI",
      cableColor: "#3b82f6",
      note: "service loop",
    },
  ],
};

const empty: DerivedLists = { devices: [], cables: [], adapters: [], patches: [] };

describe("exportDocs (p3-cableschedule)", () => {
  it("scheduleToTsv emits a header + one row per patch, in the chosen unit", () => {
    const lines = scheduleToTsv(lists, "imperial").split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split("\t")).toContain("A-end");
    expect(lines[0]).toContain("Length (ft)");
    expect(lines[1]).toContain("AV-001");
    expect(lines[1]).toContain("service loop");
    expect(lines[1].split("\t")).toContain("9.8"); // 3 m → 9.8 ft
  });

  it("listsToPdfBase64 returns a PDF (base64 %PDF header)", () => {
    expect(listsToPdfBase64(lists, { projectName: "Test", unit: "metric" }).startsWith("JVBER")).toBe(true);
  });

  it("listsToXlsxBase64 returns an xlsx (base64 PK zip header)", async () => {
    const b64 = await listsToXlsxBase64(lists, { projectName: "Test", unit: "metric" });
    expect(b64.startsWith("UEsD")).toBe(true);
  });

  it("labelsToPdfBase64 returns a PDF, and throws with no cables", () => {
    expect(labelsToPdfBase64(lists).startsWith("JVBER")).toBe(true);
    expect(() => labelsToPdfBase64(empty)).toThrow("No cables to label");
  });

  it("throws on an empty diagram", () => {
    expect(() => listsToPdfBase64(empty, { projectName: "x", unit: "metric" })).toThrow("Nothing to export");
  });
});
