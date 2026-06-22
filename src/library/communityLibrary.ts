import type { DeviceModel } from "../schema";
import snapshot from "./communityCatalog.json";

/**
 * The community catalog as a small reactive store. It starts as the snapshot
 * bundled with the app (`dist/catalog-<rev>.json`, copied in) and can be replaced
 * at runtime by a newer synced snapshot (see catalogUpdate.ts) without an app
 * update. Consumers read {@link getCommunityModels} and re-render via
 * {@link subscribeCommunityModels}.
 *
 * To refresh the *bundled* snapshot after adding devices to the catalog:
 *   cp ../sigpath-catalog/dist/catalog-1.json src/library/communityCatalog.json
 *
 * Cast through `unknown`: the JSON's string fields are wider than DeviceModel's
 * unions (category/direction/source), but the build validated them on the way out.
 */
export const BUNDLED_COMMUNITY_MODELS = snapshot as unknown as DeviceModel[];

let current: DeviceModel[] = BUNDLED_COMMUNITY_MODELS;
const listeners = new Set<() => void>();

/** The catalog in effect right now (bundled, cached, or freshly synced). */
export function getCommunityModels(): DeviceModel[] {
  return current;
}

/** Replace the catalog and notify subscribers (no-op if it's the same array). */
export function setCommunityModels(models: DeviceModel[]): void {
  if (models === current) return;
  current = models;
  for (const listener of listeners) listener();
}

/** Subscribe to catalog changes; returns an unsubscribe fn. */
export function subscribeCommunityModels(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * The catalog's revision = the max `rev` stamped on its rows (the build stamps
 * every row with the same REV), so we can compare against a remote manifest's
 * rev without bookkeeping a separate version.
 */
export function catalogRev(models: DeviceModel[]): number {
  return models.reduce((max, m) => Math.max(max, m.rev ?? 0), 0);
}
