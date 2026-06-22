import type { DeviceModel } from "../schema";

/**
 * A tiny built-in fallback, available even before the community catalog syncs. The
 * real catalog lives in the community database (Phase 4) and is merged ahead of these
 * in `loadCatalog()`; a built-in is superseded when the catalog has the same
 * manufacturer + model. Ports carry only their connector — color/grouping/validation
 * derive from it.
 */

export const appleTv: DeviceModel = {
  id: "apple-tv-4k",
  manufacturer: "Apple",
  model: "TV 4K",
  category: "source",
  type: "Media source",
  source: "builtin",
  ports: [
    { id: "hdmi", name: "HDMI", direction: "output", connector: "hdmi", grade: "hdmi-2.1" },
    // Apple TV's inlet is a figure-8 (IEC C7/C8), not a wall plug.
    { id: "power", name: "Power", direction: "input", connector: "iec-c7" },
  ],
};

export const BUILTIN_MODELS: DeviceModel[] = [appleTv];
