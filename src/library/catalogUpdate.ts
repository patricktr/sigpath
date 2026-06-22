import type { DeviceModel } from "../schema";
import {
  catalogRev,
  getCommunityModels,
  setCommunityModels,
} from "./communityLibrary";
import { getCatalogSource } from "./catalogSource";
import { syncCatalog } from "./catalogSync";
import { idbGet, idbSet } from "./idbKv";

/**
 * Glue between the pull protocol ({@link syncCatalog}), the on-disk cache
 * ({@link idbGet}/{@link idbSet}), and the live store ({@link setCommunityModels}).
 * Offline-first: the bundled snapshot always works; a cached snapshot supersedes
 * it on launch; a newer remote snapshot supersedes both and is cached for next time.
 */
const CACHE_KEY = "community-catalog";

export type CatalogUpdate =
  | { status: "updated"; rev: number; count: number }
  | { status: "current"; rev: number }
  | { status: "offline" }
  | { status: "disabled" }
  | { status: "error"; reason: string };

/** Apply a previously-synced catalog from cache if it's newer than the bundle. */
export async function hydrateCatalogFromCache(): Promise<void> {
  try {
    const cached = await idbGet<DeviceModel[]>(CACHE_KEY);
    if (Array.isArray(cached) && catalogRev(cached) > catalogRev(getCommunityModels())) {
      setCommunityModels(cached);
    }
  } catch {
    /* no cache / IndexedDB unavailable — the bundled snapshot stays in effect */
  }
}

/** Check the remote catalog; if newer, apply it to the store and cache it. */
export async function checkForCatalogUpdate(): Promise<CatalogUpdate> {
  const source = getCatalogSource();
  if (!source) return { status: "disabled" };

  const res = await syncCatalog({ source, currentRev: catalogRev(getCommunityModels()) });
  if (res.status !== "updated") return res;

  setCommunityModels(res.models);
  try {
    await idbSet(CACHE_KEY, res.models);
  } catch {
    /* cache write is best-effort — the update still applied this session */
  }
  return { status: "updated", rev: res.rev, count: res.count };
}
