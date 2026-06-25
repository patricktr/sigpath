import type { Router } from "./types";
import { legacyRouter } from "./legacyRouter";
import { newRouter } from "./newRouter";

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
 * The active router. `"new"`/`"shadow"` select the general router, which owns the bidi/bottom
 * runs and delegates the tuned output→input case back to legacy (p2-bidiroute). The default is
 * still `"legacy"`; it flips to `"new"` at P4 once the full corpus passes the parity gate.
 */
export function pickRouter(): Router {
  switch (routerChoice()) {
    case "new":
    case "shadow":
      return newRouter;
    case "legacy":
    default:
      return legacyRouter;
  }
}
