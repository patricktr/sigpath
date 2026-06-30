import { describe, it, expect } from "vitest";
import { deriveLists } from "./derive";
import type { CableEdgeType, DeviceNodeType, SigNode } from "../flow/types";
import type { DeviceModel } from "../schema";

const device = (instanceId: string, model: DeviceModel): DeviceNodeType => ({
  id: instanceId,
  type: "device",
  position: { x: 0, y: 0 },
  data: { model },
});

// A network switch with an external 12V brick (DC barrel input).
const GS308: DeviceModel = {
  id: "gs308",
  manufacturer: "Netgear",
  model: "GS308v3",
  category: "network",
  source: "builtin",
  ports: [
    { id: "pwr", name: "DC In", direction: "input", connector: "dc-barrel" },
    { id: "1", name: "Port 1", direction: "bidirectional", connector: "rj45" },
  ],
};
// A mains-powered amp (IEC inlet — internal supply, no brick).
const AMP: DeviceModel = {
  id: "amp",
  manufacturer: "QSC",
  model: "Amp",
  category: "amplifier",
  source: "builtin",
  ports: [{ id: "ac", name: "Mains", direction: "input", connector: "iec" }],
};

describe("deriveLists — PSU pack-list lines (p3-psupacklist)", () => {
  it("lists a PSU named for each DC-powered device, counted by instance, even with no power wired", () => {
    const nodes: SigNode[] = [device("a", GS308), device("b", GS308), device("c", AMP)];
    const psus = deriveLists(nodes, []).adapters.filter((a) => a.kind === "psu");
    expect(psus).toHaveLength(1);
    expect(psus[0].label).toBe("PSU — Netgear GS308v3");
    expect(psus[0].count).toBe(2); // two switches → one PSU line ×2, traceable to its gear
  });

  it("does not list a PSU for a mains (IEC) device", () => {
    const psus = deriveLists([device("c", AMP)], []).adapters.filter((a) => a.kind === "psu");
    expect(psus).toEqual([]);
  });
});

// A PDU: its own IEC feed (input) + IEC outlets (output).
const PDU: DeviceModel = {
  id: "pdu",
  manufacturer: "Furman",
  model: "PL-8C",
  category: "power",
  source: "builtin",
  ports: [
    { id: "feed", name: "Feed", direction: "input", connector: "iec" },
    { id: "out1", name: "Out 1", direction: "output", connector: "iec" },
  ],
};
// Redundant dual-PSU device — two IEC inlets.
const DUAL: DeviceModel = {
  id: "dual",
  manufacturer: "Cisco",
  model: "C9300",
  category: "network",
  source: "builtin",
  ports: [
    { id: "ps1", name: "PSU 1", direction: "input", connector: "iec" },
    { id: "ps2", name: "PSU 2", direction: "input", connector: "iec" },
  ],
};
// Figure-8 (C7/C8) and cloverleaf (C5/C6) mains devices — laptop / Apple-TV-style bricks.
const FIG8: DeviceModel = {
  id: "fig8",
  manufacturer: "Apple",
  model: "Apple TV 4K",
  category: "source",
  source: "builtin",
  ports: [
    { id: "pwr", name: "Power", direction: "input", connector: "iec-c7" },
    { id: "hdmi", name: "HDMI", direction: "output", connector: "hdmi" },
  ],
};
const CLOVER: DeviceModel = {
  id: "clover",
  manufacturer: "Dell",
  model: "Latitude",
  category: "other",
  source: "builtin",
  ports: [{ id: "pwr", name: "Power", direction: "input", connector: "iec-c5" }],
};
const cord = (nodes: SigNode[], edges: CableEdgeType[], conn = "iec") =>
  deriveLists(nodes, edges).cables.find((c) => c.id === `cord-${conn}`);

describe("deriveLists — IEC C13 power cords (p3-psupacklist)", () => {
  it("adds one IEC C13 cord per unwired C14 device, with no power drawn", () => {
    const row = cord([device("a", AMP), device("b", AMP)], []);
    expect(row?.label).toBe("IEC C13 power cord");
    expect(row?.count).toBe(2);
  });

  it("counts a redundant dual-inlet device once (no double-pack)", () => {
    expect(cord([device("a", DUAL)], [])?.count).toBe(1);
  });

  it("skips a device whose mains is wired, but still cords the upstream feed", () => {
    const edge: CableEdgeType = { id: "e", source: "p", sourceHandle: "out1", target: "a", targetHandle: "ac" };
    const row = cord([device("p", PDU), device("a", AMP)], [edge]);
    expect(row?.count).toBe(1); // the AMP is wired (its run is a cable) → only the PDU's feed cords
  });

  it("adds no cord for a DC-only device", () => {
    expect(cord([device("g", GS308)], [])).toBeUndefined();
  });

  it("gives a figure-8 (C7) device its own C7 cord", () => {
    const row = cord([device("a", FIG8), device("b", FIG8)], [], "iec-c7");
    expect(row?.label).toBe("IEC C7 figure-8 power cord");
    expect(row?.count).toBe(2);
  });

  it("gives a cloverleaf (C5) device its own C5 cord", () => {
    const row = cord([device("a", CLOVER)], [], "iec-c5");
    expect(row?.label).toBe("IEC C5 cloverleaf power cord");
    expect(row?.count).toBe(1);
  });

  it("keeps each mains family as its own cord line", () => {
    const cables = deriveLists([device("a", AMP), device("b", FIG8), device("c", CLOVER)], []).cables;
    const cords = cables.filter((c) => c.id.startsWith("cord-")).map((c) => c.id).sort();
    expect(cords).toEqual(["cord-iec", "cord-iec-c5", "cord-iec-c7"]);
  });
});
