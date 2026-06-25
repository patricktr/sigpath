import type { Router } from "./types";
import { legacyRouter } from "./legacyRouter";

export type { Router, RouteRequest, RouteResult } from "./types";

/**
 * Which routing engine to use. Resolution mirrors `catalogSource.ts`:
 *  1. `localStorage["sigpath.router"]` — a runtime dev override.
 *  2. `VITE_ROUTER` — a build-time override.
 *  3. `"legacy"` (default).
 *
 * `"new"` selects the general router and `"shadow"` renders legacy while running both for
 * a metrics diff — both land with p2-bidiroute / p2-router. See design/CABLE-ROUTING.html §4.
 */
export type RouterChoice = "legacy" | "new" | "shadow";

export function routerChoice(): RouterChoice {
  try {
    const override = localStorage.getItem("sigpath.router");
    if (override === "legacy" || override === "new" || override === "shadow") return override;
  } catch {
    /* localStorage unavailable — fall through */
  }
  const env = import.meta.env?.VITE_ROUTER;
  if (env === "legacy" || env === "new" || env === "shadow") return env;
  return "legacy";
}

/**
 * The active router. The flag is read now so the seam and override path exist and can be
 * exercised in dev; until the general router lands (p2-bidiroute → p2-router) every choice
 * resolves to the lifted legacy pipeline.
 */
export function pickRouter(): Router {
  switch (routerChoice()) {
    case "legacy":
    case "new":
    case "shadow":
    default:
      return legacyRouter;
  }
}
