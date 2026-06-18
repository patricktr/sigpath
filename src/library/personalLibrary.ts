import type { DeviceModel } from "../schema";

/**
 * The user's personal library of custom-built devices, persisted in
 * localStorage. (When the community database lands in Phase 4, this becomes the
 * "my devices" layer alongside it.)
 */
const KEY = "sigpath.personalLibrary.v1";

export function loadPersonalLibrary(): DeviceModel[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as DeviceModel[]) : [];
  } catch {
    return [];
  }
}

export function savePersonalLibrary(models: DeviceModel[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(models));
  } catch {
    /* ignore storage quota / availability errors */
  }
}

/** Add (or replace by id) a model and return the updated library. */
export function addToPersonalLibrary(model: DeviceModel): DeviceModel[] {
  const next = [...loadPersonalLibrary().filter((m) => m.id !== model.id), model];
  savePersonalLibrary(next);
  return next;
}

export function removeFromPersonalLibrary(id: string): DeviceModel[] {
  const next = loadPersonalLibrary().filter((m) => m.id !== id);
  savePersonalLibrary(next);
  return next;
}
