import type { Diagram } from "./document";

/**
 * Bumped whenever the {@link Build} record (a "Custom builds" library entry / `.sigbuild`
 * file) shape changes. Independent of SIGPATH_SCHEMA_VERSION, which versions the
 * embedded {@link Diagram}s — a build can carry diagrams of any past schema version while
 * its own wrapper evolves separately. v1 (2026-06-26): initial save-a-build format
 * (p2-savebuild).
 */
export const BUILD_FORMAT_VERSION = 1;

/**
 * A reusable, self-contained sub-assembly — a saved zone/tab plus the transitive closure of
 * every sub-diagram it references through blocks — that can be stamped into future projects
 * (p2-savebuild, design/ZONE-TAB.html companion). Like a {@link DeviceInstance} embeds a
 * {@link DeviceModel} snapshot, a Build embeds full {@link Diagram} snapshots, so it never
 * depends on the live library and survives library drift. Carries fork/dedup metadata
 * (`rev` + `contentHash`) mirroring the device-catalog system so a future community-share
 * path can detect divergence without a reformat.
 */
export type Build = {
  /** The Build-record format version (this wrapper) — see {@link BUILD_FORMAT_VERSION}. */
  formatVersion: number;
  /** Stable build identity — survives re-saves; the unit a future share/sync keys on. */
  id: string;
  name: string;
  /** Freeform classification for the library, e.g. "Flypack", "Control room". */
  category?: string;
  author?: string;
  /** Bumped each time this build id is re-saved from a changed source. */
  rev: number;
  /**
   * Stable FNV-1a hash of the build's content — keyed on devices, cables, zones, boundary,
   * and layout, but independent of the diagram ids that {@link insertBuild} re-mints. Powers
   * dedup, drift detection, and future share deltas. Produced by {@link buildContentHash}.
   */
  contentHash: string;
  /** Epoch ms when first saved. */
  createdAt: number;
  /** Epoch ms of the most recent re-save. */
  updatedAt: number;
  /** The schema version the embedded {@link diagrams} use (SIGPATH_SCHEMA_VERSION at save). */
  schemaVersion: number;
  /** Which diagram in {@link diagrams} is the build's entry point (the saved zone/tab). */
  rootDiagramId: string;
  /** The root diagram + every diagram it transitively embeds via blocks (the embed closure). */
  diagrams: Diagram[];
};

/** Root persisted shape of a `.sigbuild` file — a versioned wrapper around one {@link Build}. */
export type SigbuildDocument = {
  formatVersion: number;
  build: Build;
};

/**
 * Order a build's diagram closure deterministically from its root (root first, then each
 * embedded diagram in encounter order, then any stragglers in array order). Used so the
 * content hash is independent of how the diagrams happen to be ordered in the array.
 */
function orderedClosure(diagrams: Diagram[], rootId: string): Diagram[] {
  const byId = new Map(diagrams.map((d) => [d.id, d]));
  const out: Diagram[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    const d = byId.get(id);
    if (!d || seen.has(id)) return;
    seen.add(id);
    out.push(d);
    for (const b of d.blocks ?? []) visit(b.refDiagramId);
  };
  visit(rootId);
  for (const d of diagrams) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/**
 * A stable, dependency-free hash of a build's content. Mirrors {@link deviceContentHash}: a
 * fast non-cryptographic FNV-1a (32-bit) → 8-char hex, for per-build change detection, dedup,
 * and share deltas — NOT a security boundary. Identity is keyed on everything that defines the
 * sub-assembly (devices, cables, zones, boundary ports, positions) EXCEPT the diagram ids —
 * those are replaced by their closure index because `insertBuild` re-mints them on every
 * stamp, so two builds that differ only in diagram ids are the same content. Device /
 * connection / block-instance ids are preserved on insert (diagram-scoped), so they stay
 * part of the identity.
 */
export function buildContentHash(diagrams: Diagram[], rootId: string): string {
  const ordered = orderedClosure(diagrams, rootId);
  const indexOf = new Map(ordered.map((d, i) => [d.id, i] as const));
  const canonical = JSON.stringify(
    ordered.map((d) => ({
      ...d,
      id: indexOf.get(d.id),
      blocks: (d.blocks ?? []).map((b) => ({ ...b, refDiagramId: indexOf.get(b.refDiagramId) ?? -1 })),
    })),
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Total devices and cables defined across a build's diagrams (each tab counted once) — the
 *  headline "how big is this build" figure for the library list. */
export function buildPartCounts(build: Build): { devices: number; cables: number } {
  let devices = 0;
  let cables = 0;
  for (const d of build.diagrams) {
    devices += d.devices.length;
    cables += d.connections.length;
  }
  return { devices, cables };
}
