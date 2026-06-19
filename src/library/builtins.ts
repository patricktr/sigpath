import type { DeviceModel } from "../schema";

/**
 * A small starter set of built-in device models for the quick-add palette and
 * the sample diagram. The large catalog will come from the community database
 * (Phase 4); this is just enough to be useful on day one. Ports carry only their
 * connector — color/grouping/validation derive from it.
 */

export const appleTv: DeviceModel = {
  id: "apple-tv-4k",
  manufacturer: "Apple",
  model: "TV 4K",
  category: "source",
  type: "Media source",
  source: "builtin",
  ports: [{ id: "hdmi", name: "HDMI", direction: "output", connector: "hdmi" }],
};

export const blurayPlayer: DeviceModel = {
  id: "bluray-player",
  model: "Blu-ray Player",
  category: "source",
  type: "Media source",
  source: "builtin",
  ports: [{ id: "hdmi", name: "HDMI", direction: "output", connector: "hdmi" }],
};

export const laptop: DeviceModel = {
  id: "laptop",
  model: "Laptop",
  category: "source",
  type: "Computer",
  source: "builtin",
  ports: [
    { id: "usbc", name: "USB-C", direction: "output", connector: "usb-c" },
    { id: "hdmi", name: "HDMI", direction: "output", connector: "hdmi" },
  ],
};

export const ptzCamera: DeviceModel = {
  id: "ptz-camera",
  model: "PTZ Camera",
  category: "source",
  type: "Camera",
  source: "builtin",
  ports: [
    { id: "sdi", name: "3G-SDI", direction: "output", connector: "sdi" },
    { id: "lan", name: "LAN", direction: "bidirectional", connector: "rj45" },
  ],
};

export const avReceiver: DeviceModel = {
  id: "av-receiver",
  model: "AV Receiver",
  category: "switcher",
  type: "AV receiver",
  source: "builtin",
  rackUnits: 3,
  ports: [
    { id: "in1", name: "HDMI 1", direction: "input", connector: "hdmi" },
    { id: "in2", name: "HDMI 2", direction: "input", connector: "hdmi" },
    { id: "out", name: "HDMI Out", direction: "output", connector: "hdmi" },
    { id: "opt", name: "Optical", direction: "output", connector: "toslink" },
  ],
};

export const networkSwitch: DeviceModel = {
  id: "network-switch",
  model: "Network Switch",
  category: "network",
  type: "Network switch",
  source: "builtin",
  rackUnits: 1,
  ports: [
    { id: "p1", name: "Port 1", direction: "bidirectional", connector: "rj45" },
    { id: "p2", name: "Port 2", direction: "bidirectional", connector: "rj45" },
    { id: "p3", name: "Port 3", direction: "bidirectional", connector: "rj45" },
    { id: "p4", name: "Port 4", direction: "bidirectional", connector: "rj45" },
  ],
};

export const projector: DeviceModel = {
  id: "projector",
  model: "Projector",
  category: "display",
  type: "Projector",
  source: "builtin",
  ports: [
    { id: "hdmi1", name: "HDMI 1", direction: "input", connector: "hdmi" },
    { id: "vga", name: "VGA", direction: "input", connector: "vga" },
  ],
};

export const livingRoomTv: DeviceModel = {
  id: "living-room-tv",
  manufacturer: "Sony",
  model: "Living Room TV",
  category: "display",
  type: "Display",
  source: "builtin",
  ports: [
    { id: "hdmi1", name: "HDMI 1", direction: "input", connector: "hdmi" },
    { id: "earc", name: "eARC", direction: "input", connector: "hdmi" },
  ],
};

export const soundbar: DeviceModel = {
  id: "soundbar",
  model: "Soundbar",
  category: "audio",
  type: "Speaker",
  source: "builtin",
  ports: [{ id: "opt", name: "Optical", direction: "input", connector: "toslink" }],
};

export const BUILTIN_MODELS: DeviceModel[] = [
  appleTv,
  blurayPlayer,
  laptop,
  ptzCamera,
  avReceiver,
  networkSwitch,
  projector,
  livingRoomTv,
  soundbar,
];
