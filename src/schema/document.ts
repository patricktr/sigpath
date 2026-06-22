import type { DeviceInstance } from "./device";
import type { Connection } from "./connection";
import type { GradeScaleId, GradeId } from "./grades";

/**
 * Bumped whenever the persisted shape changes, so a future loader can migrate older
 * `.sigpath` files. v2 (2026-06-22) added the optional `Project.signalProfile` plus
 * optional grade fields on ports and connections — all additive, so a v1 file loads
 * unchanged: with no `signalProfile`, grade validation simply stays dormant.
 */
export const SIGPATH_SCHEMA_VERSION = 2;

/** A labeled, colored region grouping devices (stage, rack, control room). */
export type Zone = {
  id: string;
  label: string;
  color: string;
  rect: { x: number; y: number; width: number; height: number };
};

/** Free-floating note on the canvas (rich text comes later). */
export type Annotation = {
  id: string;
  text: string;
  position: { x: number; y: number };
};

/** A single signal-flow drawing. */
export type Diagram = {
  id: string;
  name: string;
  devices: DeviceInstance[];
  connections: Connection[];
  zones: Zone[];
  annotations: Annotation[];
  orientation?: "left-right" | "free";
};

/**
 * The show's target signal format — the demand ceiling for grade validation.
 * `videoFormat` is the friendly handle AV folks use ("1080p59.94", "2160p59.94")
 * and resolves to image-domain grades (SDI/HDMI/DisplayPort); `targets` carries
 * explicit per-family ceilings for the independent domains (network, USB). Both
 * optional — absent ⇒ grade checks stay paused and the app prompts the user to pick
 * a format rather than guessing. See design/SIGNAL-GRADE.html §3.
 */
export type SignalProfile = {
  videoFormat?: string;
  targets?: Partial<Record<GradeScaleId, GradeId>>;
};

/** A project groups multiple diagrams (Phase 2). */
export type Project = {
  id: string;
  name: string;
  diagrams: Diagram[];
  /** Project-wide signal demand ceiling for grade validation. Added in schema v2. */
  signalProfile?: SignalProfile;
};

/** Root persisted document — the contents of a `.sigpath` file (Phase 1). */
export type SigpathDocument = {
  schemaVersion: number;
  project: Project;
};

/** An empty diagram with sensible defaults. */
export function emptyDiagram(id: string, name: string): Diagram {
  return {
    id,
    name,
    devices: [],
    connections: [],
    zones: [],
    annotations: [],
    orientation: "free",
  };
}
