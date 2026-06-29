import type { PortDirection } from "./device";
import type { ConnectorId } from "./connectors";
import type { GradeId } from "./grades";
import type { PortRef } from "./connection";

/**
 * The outward face a Diagram exposes when it is embedded elsewhere as a block
 * (roadmap p2-zonetab — see design/ZONE-TAB.html). A boundary port is deliberately
 * Port-shaped — `id`/`name`/`direction`/`connector`/`grade` mirror a device Port — so
 * the connector-compatibility check, the grade gate, and cable-prefix logic all run
 * across a boundary through one shared seam, with no parallel code path.
 *
 * A boundary port is a *projection* of exactly one inner device port (`internal`), not a
 * separate cable endpoint: you never run a "device → boundary" wire inside the sub-tab.
 * So a run that crosses the boundary stays a single physical cable — `flatten()` rewrites
 * the block endpoint to `internal`, and the BOM/cable-numbering see one cable, not two
 * (design/ZONE-TAB.html §6). A real patch panel / wall plate is modeled as an actual
 * device instead.
 *
 * `id` is minted once and is stable — it survives an internal rename/renumber/re-spec, so
 * a top-level cable attached to this boundary is never silently orphaned. Re-derivation
 * after an inner edit matches on the semantic tuple (internal.instanceId + direction +
 * connector + ordinal), never the inner port id.
 */
export type BoundaryPort = {
  id: string;
  name: string;
  direction: PortDirection;
  /** Mirrored from the inner port at expose-time. */
  connector: ConnectorId;
  accepts?: ConnectorId[];
  /** Mirrored from the inner port at expose-time. */
  grade?: GradeId;
  /** The single internal device port this boundary proxies. */
  internal: PortRef;
  /** Curation (p2-zonetab Phase C): kept out of the embedded block's face. The port stays in
   *  the published set — so it can be un-hidden and drift still tracks its inner port — and is
   *  dropped only at the `synthesizeBlockModel` seam. */
  hidden?: boolean;
  /** Curation (p2-zonetab Phase C): `name` is a user override, not the auto-derived
   *  `Device · Port` label. Lets a refresh keep the custom name and the panel offer
   *  "reset to auto". */
  renamed?: boolean;
};
