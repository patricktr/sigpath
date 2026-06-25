import type { Revision, RevisionSnapshot } from "../schema";

/**
 * Revision-history helpers (p2-revisions). A revision is a full snapshot of the project's
 * working content captured on save; unnamed ones are automatic save points, named ones are
 * milestones. v1 embeds full snapshots in the `.sigpath` file.
 */

/** Most recent automatic (unnamed) save points to keep; named milestones are kept forever. */
export const MAX_SAVE_POINTS = 25;

/** Fast, dependency-free FNV-1a hash of a snapshot — used to skip a save that changed
 *  nothing. Same shape as deviceContentHash; not a security boundary. */
export function snapshotHash(snapshot: RevisionSnapshot): string {
  const s = JSON.stringify(snapshot);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Keep every named milestone plus the most recent {@link MAX_SAVE_POINTS} unnamed save
 *  points, preserving chronological order. */
export function pruneRevisions(revs: Revision[]): Revision[] {
  const unnamed = revs.filter((r) => !r.label);
  if (unnamed.length <= MAX_SAVE_POINTS) return revs;
  const keep = new Set(unnamed.slice(-MAX_SAVE_POINTS));
  return revs.filter((r) => r.label || keep.has(r));
}
