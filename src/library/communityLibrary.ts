import type { DeviceModel } from "../schema";
import snapshot from "./communityCatalog.json";

/**
 * The bundled community catalog snapshot, compiled from the `sigpath-catalog` repo
 * (`dist/catalog-<rev>.json`). For now it's imported directly — the interim
 * "bundled snapshot" read path. The background sync client + local DB (Phase 4)
 * will eventually replace this static import with a synced, updatable store.
 *
 * To refresh after adding devices to the catalog:
 *   cp ../sigpath-catalog/dist/catalog-1.json src/library/communityCatalog.json
 *
 * Cast through `unknown`: the JSON's string fields are wider than DeviceModel's
 * unions (category/direction/source), but the build validated them on the way out.
 */
export const COMMUNITY_MODELS = snapshot as unknown as DeviceModel[];
