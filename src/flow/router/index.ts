import type { Router } from "./types";
import { legacyRouter } from "./legacyRouter";
import { newRouter } from "./newRouter";

export type { Router, RouteRequest, RouteResult } from "./types";

/**
 * Which routing engine to use. Resolution mirrors `catalogSource.ts`:
 *  1. `localStorage["sigpath.router"]` — a runtime dev override.
 *  2. `VITE_ROUTER` — a build-time override.
 *  3. `"new"` (default, since P4).
 *
 * `"legacy"` selects the old five-pass pipeline (rollback). `"shadow"` is reserved for a
 * dual-run metrics diff. See design/CABLE-ROUTING.html §4.
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
  // P4: the general router is now the default — it owns all runs at parity with the old
  // pipeline (output→input byte-identical) and additionally routes bidi/bottom-port cables.
  // Set localStorage["sigpath.router"]="legacy" (or VITE_ROUTER=legacy) to roll back.
  return "new";
}

/**
 * The active router. The general router ({@link newRouter}) is the default: it owns every run,
 * reproducing the tuned output→input case byte-identically and routing bidi/bottom-port runs
 * around boxes (p2-router). `"legacy"` selects the old five-pass pipeline, kept for rollback.
 */
export function pickRouter(): Router {
  switch (routerChoice()) {
    case "legacy":
      return legacyRouter;
    case "new":
    case "shadow":
    default:
      return newRouter;
  }
}
