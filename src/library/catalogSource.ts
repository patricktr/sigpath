/**
 * Where to pull the community catalog from — the base URL holding `manifest.json`
 * and the snapshot it points at.
 *
 * Resolution order:
 *  1. `localStorage["sigpath.catalogUrl"]` — a runtime dev override, e.g. to test
 *     against a local server without rebuilding.
 *  2. `VITE_CATALOG_URL` — a build-time override (staging, forks).
 *  3. The published GitHub Pages host (default).
 */
const DEFAULT_CATALOG_URL = "https://patricktr.github.io/sigpath-catalog";

export function getCatalogSource(): string | null {
  try {
    const override = localStorage.getItem("sigpath.catalogUrl");
    if (override) return override;
  } catch {
    /* localStorage unavailable — fall through */
  }
  const env = import.meta.env?.VITE_CATALOG_URL;
  if (typeof env === "string" && env.length > 0) return env;
  return DEFAULT_CATALOG_URL;
}
