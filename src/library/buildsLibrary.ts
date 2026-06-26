import { idbGet, idbSet } from "./idbKv";
import type { Build } from "../schema";

/**
 * The user's local "Custom builds" library (p2-savebuild): saved zone/tab sub-assemblies the
 * user can stamp into future projects. Mirrors {@link personalLibrary} but persists to
 * IndexedDB (via {@link idbKv}) rather than localStorage — a 15-device / 100-cable flypack
 * with full embedded device snapshots outgrows localStorage's ~5 MB cap. Best-effort: a
 * storage failure surfaces as an empty library, never a crash. The community-share path
 * (publishing builds like community devices) is a later layer on top of this.
 */
const KEY = "sigpath.builds.v1";

export async function loadBuilds(): Promise<Build[]> {
  const data = await idbGet<Build[]>(KEY);
  return Array.isArray(data) ? data : [];
}

export async function getBuild(id: string): Promise<Build | undefined> {
  return (await loadBuilds()).find((b) => b.id === id);
}

/**
 * Insert or replace a build by id, returning the updated library. Re-saving an existing id
 * bumps `rev` and `updatedAt` (and keeps `createdAt`) so the share/dedup metadata stays
 * meaningful; a fresh id is stored as-is.
 */
export async function saveBuild(build: Build): Promise<Build[]> {
  const existing = await loadBuilds();
  const prior = existing.find((b) => b.id === build.id);
  const next: Build = prior
    ? { ...build, rev: prior.rev + 1, createdAt: prior.createdAt, updatedAt: build.updatedAt }
    : build;
  const merged = [...existing.filter((b) => b.id !== build.id), next];
  await idbSet(KEY, merged);
  return merged;
}

/** Rename a build (the only field users edit in-place for v1). */
export async function renameBuild(id: string, name: string): Promise<Build[]> {
  const next = (await loadBuilds()).map((b) => (b.id === id ? { ...b, name } : b));
  await idbSet(KEY, next);
  return next;
}

export async function removeBuild(id: string): Promise<Build[]> {
  const next = (await loadBuilds()).filter((b) => b.id !== id);
  await idbSet(KEY, next);
  return next;
}
