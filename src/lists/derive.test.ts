import { describe, it, expect } from "vitest";
import { deriveLists } from "./derive";
import type { DeviceNodeType, SigNode } from "../flow/types";
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
