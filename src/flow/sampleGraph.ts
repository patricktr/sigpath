import { appleTv, blurayPlayer, avReceiver, livingRoomTv, soundbar } from "../library/builtins";
import { CABLE_TYPES, DEFAULT_CABLE_COLOR } from "../schema";
import type { DeviceModel } from "../schema";
import type { DeviceNodeType, CableEdgeType } from "./types";

function deviceNode(id: string, model: DeviceModel, x: number, y: number): DeviceNodeType {
  return { id, type: "device", position: { x, y }, data: { model } };
}

export const initialNodes: DeviceNodeType[] = [
  deviceNode("appletv", appleTv, 0, 0),
  deviceNode("bluray", blurayPlayer, 0, 170),
  deviceNode("avr", avReceiver, 320, 60),
  deviceNode("tv", livingRoomTv, 660, 0),
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
