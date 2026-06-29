import { deviceTitle } from "../schema";
import type { BoundaryPort, Port } from "../schema";
import type { EditorDiagram, PortBearingNode } from "./types";
import { isPortBearing } from "./types";

/**
 * Boundary drift detection + refresh (p2-blockdrift — design/ZONE-TAB.html §11 Phase C).
 *
 * A diagram's `boundary` is a PUBLISHED snapshot of the ports it exposes when embedded as a
 * block. Editing the room can leave it stale — an inner device/port deleted, or a published
 * port's mirrored connector/grade re-spec'd. These pure helpers detect that drift (a derived
 * layer, computed per render) and plan a refresh that re-mirrors / prunes the published set
 * while keeping boundary-port ids stable, so the host cables attached to them survive.
 */

/**
 * A stable FNV-1a hash of a boundary-port set's published face — used as `boundary.rev` so a
 * cosmetic room edit that doesn't touch the boundary leaves the rev untouched (no false
 * drift), and as a cheap "did a refresh actually change anything?" key. 32-bit, like
 * {@link deviceContentHash}; collisions only cost a missed/extra drift hint, never data.
 */
export function boundaryHash(ports: BoundaryPort[]): number {
  const canonical = JSON.stringify(
    ports.map((p) => [
      p.id,
      p.name,
      p.direction,
      p.connector,
      p.accepts ?? [],
      p.grade ?? "",
      p.internal.instanceId,
      p.internal.portId,
      p.hidden ?? false, // curation hide changes the embedded face → must register as drift
    ]),
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Has the inner port a boundary mirrors changed shape (direction / connector / accepts / grade)? */
function mirrorChanged(bp: BoundaryPort, live: Port): boolean {
  return (
    bp.direction !== live.direction ||
    bp.connector !== live.connector ||
    (bp.grade ?? "") !== (live.grade ?? "") ||
    JSON.stringify(bp.accepts ?? []) !== JSON.stringify(live.accepts ?? [])
  );
}

/**
 * The auto-derived public label for a boundary port — its inner device's title + the inner port
 * name (e.g. "Switcher · PGM"). Shared by deriveBoundary (expose-time) and remirror (refresh) so
 * an un-renamed port's name tracks the room, and a no-op refresh stays byte-identical (no false
 * drift).
 */
export function autoBoundaryName(node: PortBearingNode, port: Port): string {
  return `${deviceTitle(node.data.model, node.data.label)} · ${port.name}`;
}

/** Re-mirror one published port from its (re-matched) inner port — keeps the stable id and
 *  curation (hidden / renamed). `name` is supplied by the caller: the custom label for a renamed
 *  port, else the re-derived auto-name so an un-renamed port tracks an inner rename. */
function remirror(bp: BoundaryPort, instanceId: string, live: Port, name: string): BoundaryPort {
  return {
    id: bp.id,
    name,
    direction: live.direction,
    connector: live.connector,
    internal: { instanceId, portId: live.id },
    ...(live.accepts ? { accepts: live.accepts } : {}),
    ...(live.grade ? { grade: live.grade } : {}),
    ...(bp.hidden ? { hidden: true } : {}),
    ...(bp.renamed ? { renamed: true } : {}),
  };
}

export type BoundaryRefreshPlan = {
  /** The re-published port set: re-mirrored + re-bound, pruned of dead ports. */
  nextPorts: BoundaryPort[];
  /** Ports whose inner device is gone (or has no matching port) — pruned. Host cables to
   *  these are left in place and surface as "Broken connection" in validation. */
  removed: BoundaryPort[];
  /** Ports whose inner port id changed (e.g. a wholesale model replace) but were re-matched
   *  by signature — the bp id (and its host cables) survive. */
  rebound: BoundaryPort[];
  /** Ports whose mirrored shape (connector / grade / direction / accepts) was re-mirrored. */
  changed: BoundaryPort[];
};

/**
 * Plan a boundary refresh against the room's live content. For each currently-published port,
 * in priority order:
 *  1. exact — `internal.{instanceId, portId}` still resolves → re-mirror in place;
 *  2. semantic fallback — the device exists but the port id changed → re-match an inner port by
 *     (direction + connector + ordinal), re-bind `internal.portId`, keep the bp id;
 *  3. prune — the device is gone (or no signature match) → drop the port.
 * Never ADDS ports (decision: prune & re-mirror only; new ports are a deliberate act).
 */
export function planBoundaryRefresh(room: EditorDiagram): BoundaryRefreshPlan {
  const ports = room.boundary?.ports ?? [];
  const nodeById = new Map<string, PortBearingNode>();
  for (const n of room.nodes) if (isPortBearing(n)) nodeById.set(n.id, n);

  // Each port's ordinal among siblings sharing (instance, direction, connector) — the sticky
  // key that survives an inner port-id change.
  const ordinalOf = new Map<BoundaryPort, number>();
  const counter = new Map<string, number>();
  for (const bp of ports) {
    const k = `${bp.internal.instanceId}|${bp.direction}|${bp.connector}`;
    const i = counter.get(k) ?? 0;
    ordinalOf.set(bp, i);
    counter.set(k, i + 1);
  }

  const nextPorts: BoundaryPort[] = [];
  const removed: BoundaryPort[] = [];
  const rebound: BoundaryPort[] = [];
  const changed: BoundaryPort[] = [];

  for (const bp of ports) {
    const dev = nodeById.get(bp.internal.instanceId);
    if (!dev) {
      removed.push(bp);
      continue;
    }
    let live = dev.data.model.ports.find((p) => p.id === bp.internal.portId);
    let didRebind = false;
    if (!live) {
      const sibs = dev.data.model.ports.filter((p) => p.direction === bp.direction && p.connector === bp.connector);
      live = sibs[ordinalOf.get(bp) ?? 0];
      if (!live) {
        removed.push(bp);
        continue;
      }
      didRebind = true;
    }
    const name = bp.renamed ? bp.name : autoBoundaryName(dev, live);
    nextPorts.push(remirror(bp, bp.internal.instanceId, live, name));
    if (didRebind) rebound.push(bp);
    if (mirrorChanged(bp, live) || name !== bp.name) changed.push(bp);
  }

  return { nextPorts, removed, rebound, changed };
}

/**
 * Does the room's published boundary no longer match its live content? True iff a refresh would
 * change the published set (prune a dead port, re-bind an id-changed port, or re-mirror a
 * re-spec'd one). Cheap enough to run as a per-render derived layer; memoize on room content
 * for deeply nested projects.
 */
export function hasBoundaryDrift(room: EditorDiagram): boolean {
  const cur = room.boundary?.ports;
  if (!cur || cur.length === 0) return false;
  const plan = planBoundaryRefresh(room);
  return plan.removed.length > 0 || boundaryHash(plan.nextPorts) !== boundaryHash(cur);
}
