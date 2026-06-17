import { CABLE_TYPES, DEFAULT_CABLE_COLOR } from "../schema";
import type { DeviceModel } from "../schema";
import type { DeviceNodeType, CableEdgeType } from "./types";

/* ---- Library models (would normally come from the equipment database) ---- */

const appleTv: DeviceModel = {
  id: "apple-tv-4k",
  manufacturer: "Apple",
  model: "TV 4K",
  category: "source",
  source: "builtin",
  ports: [{ id: "hdmi", name: "HDMI", direction: "output", connector: "hdmi", signal: "av" }],
};

const bluray: DeviceModel = {
  id: "bluray-player",
  model: "Blu-ray Player",
  category: "source",
  source: "builtin",
  ports: [{ id: "hdmi", name: "HDMI", direction: "output", connector: "hdmi", signal: "av" }],
};

const avr: DeviceModel = {
  id: "av-receiver",
  model: "AV Receiver",
  category: "switcher",
  source: "builtin",
  rackUnits: 3,
  ports: [
    { id: "in1", name: "HDMI 1", direction: "input", connector: "hdmi", signal: "av" },
    { id: "in2", name: "HDMI 2", direction: "input", connector: "hdmi", signal: "av" },
    { id: "out", name: "HDMI Out", direction: "output", connector: "hdmi", signal: "av" },
    { id: "opt", name: "Optical", direction: "output", connector: "toslink", signal: "audio" },
  ],
};

const tv: DeviceModel = {
  id: "living-room-tv",
  manufacturer: "Sony",
  model: "Living Room TV",
  category: "display",
  source: "builtin",
  ports: [
    { id: "hdmi1", name: "HDMI 1", direction: "input", connector: "hdmi", signal: "av" },
    { id: "earc", name: "eARC", direction: "input", connector: "hdmi", signal: "audio" },
  ],
};

const soundbar: DeviceModel = {
  id: "soundbar",
  model: "Soundbar",
  category: "audio",
  source: "builtin",
  ports: [{ id: "opt", name: "Optical", direction: "input", connector: "toslink", signal: "audio" }],
};

/* ---- Placed instances + cable runs ---- */

function deviceNode(id: string, model: DeviceModel, x: number, y: number): DeviceNodeType {
  return { id, type: "device", position: { x, y }, data: { model } };
}

export const initialNodes: DeviceNodeType[] = [
  deviceNode("appletv", appleTv, 0, 0),
  deviceNode("bluray", bluray, 0, 170),
  deviceNode("avr", avr, 320, 60),
  deviceNode("tv", tv, 660, 0),
  deviceNode("soundbar", soundbar, 660, 210),
];

function cable(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  cableTypeId: string,
): CableEdgeType {
  const color = CABLE_TYPES[cableTypeId]?.color ?? DEFAULT_CABLE_COLOR;
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep",
    style: { stroke: color, strokeWidth: 2 },
    data: { cableTypeId },
  };
}

export const initialEdges: CableEdgeType[] = [
  cable("e-atv-avr", "appletv", "hdmi", "avr", "in1", "hdmi"),
  cable("e-bd-avr", "bluray", "hdmi", "avr", "in2", "hdmi"),
  cable("e-avr-tv", "avr", "out", "tv", "hdmi1", "hdmi"),
  cable("e-avr-sb", "avr", "opt", "soundbar", "opt", "toslink"),
];
