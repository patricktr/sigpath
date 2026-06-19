/**
 * Signal categories — the highest-level classification of what a port or cable
 * carries. Drives port/cable color and coarse compatibility grouping.
 *
 * `av` covers embedded video+audio over a single connector (HDMI, SDI, DisplayPort).
 */
export type SignalKind =
  | "video"
  | "audio"
  | "av"
  | "data"
  | "network"
  | "control"
  | "power";

export type SignalMeta = {
  label: string;
  /** Hex color used for port dots, cable defaults, and the legend. */
  color: string;
};

export const SIGNAL_META: Record<SignalKind, SignalMeta> = {
  video: { label: "Video", color: "#3b82f6" },
  audio: { label: "Audio", color: "#22c55e" },
  av: { label: "A/V", color: "#8b5cf6" },
  data: { label: "Data", color: "#ec4899" },
  network: { label: "Network", color: "#06b6d4" },
  control: { label: "Control", color: "#f59e0b" },
  power: { label: "Power", color: "#ef4444" },
};

/** All signal kinds, in display order. */
export const SIGNAL_KINDS = Object.keys(SIGNAL_META) as SignalKind[];
