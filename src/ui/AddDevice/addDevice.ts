import { BUILTIN_MODELS } from "../../library/builtins";
import { getCommunityModels } from "../../library/communityLibrary";
import { loadPersonalLibrary } from "../../library/personalLibrary";
import { cableColor } from "../../schema";
import type { DeviceModel } from "../../schema";

/** Which surface of the Add-Device flow is open. */
export type AddSurface = "none" | "palette" | "browser" | "wizard";

export type SortKey = "model" | "mfr" | "type" | "rack";

/** Identity key for de-duplication: manufacturer + model, case-insensitive. */
function modelKey(m: DeviceModel): string {
  return `${m.manufacturer ?? ""}|${m.model}`.toLowerCase();
}

/**
 * The full catalog the user can place from: the bundled community snapshot, the
 * built-in starters, and their personal library. The community snapshot supersedes
 * any built-in it overlaps (several built-ins were the seed for community entries),
 * so built-ins act as an offline fallback when the snapshot lacks an equivalent.
 */
export function loadCatalog(): DeviceModel[] {
  const community = getCommunityModels();
  const communityKeys = new Set(community.map(modelKey));
  const builtinsKept = BUILTIN_MODELS.filter((m) => !communityKeys.has(modelKey(m)));
  return [...community, ...builtinsKept, ...loadPersonalLibrary()];
}

/** Friendly type if present, else the coarse category. */
export function typeLabel(model: DeviceModel): string {
  return model.type ?? model.category;
}

/** e.g. "4 in · 2 out · 8 I/O" — pure inputs, pure outputs, then bidirectional. */
export function ioSummary(model: DeviceModel): string {
  const inN = model.ports.filter((p) => p.direction === "input").length;
  const outN = model.ports.filter((p) => p.direction === "output").length;
  const ioN = model.ports.filter((p) => p.direction === "bidirectional").length;
  const parts: string[] = [];
  if (inN) parts.push(`${inN} in`);
  if (outN) parts.push(`${outN} out`);
  if (ioN) parts.push(`${ioN} I/O`);
  return parts.join(" · ") || "no ports";
}

/** Up to 6 distinct connector colors used by the model, in port order. */
export function portColors(model: DeviceModel): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const p of model.ports) {
    if (seen.has(p.connector)) continue;
    seen.add(p.connector);
    colors.push(cableColor(p.connector));
    if (colors.length >= 6) break;
  }
  return colors;
}

/** Case-insensitive substring match over manufacturer + model + type. */
export function matchesQuery(model: DeviceModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (model.manufacturer ?? "").toLowerCase().includes(q) ||
    model.model.toLowerCase().includes(q) ||
    typeLabel(model).toLowerCase().includes(q)
  );
}

export type SourceBadge = { label: string; cls: string };

export function sourceBadge(source: DeviceModel["source"]): SourceBadge {
  switch (source) {
    case "community":
      return { label: "Community", cls: "src--community" };
    case "custom":
      return { label: "Your library", cls: "src--custom" };
    default:
      return { label: "Built-in", cls: "src--builtin" };
  }
}

export function compareModels(a: DeviceModel, b: DeviceModel, key: SortKey, dir: 1 | -1): number {
  let r = 0;
  switch (key) {
    case "model":
      r = a.model.localeCompare(b.model);
      break;
    case "mfr":
      r = (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "");
      break;
    case "type":
      r = typeLabel(a).localeCompare(typeLabel(b));
      break;
    case "rack":
      r = (a.rackUnits ?? 0) - (b.rackUnits ?? 0);
      break;
  }
  return r * dir;
}
