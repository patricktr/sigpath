/**
 * Lightweight per-user UI preferences for the Add-Device surfaces, persisted in
 * localStorage: favorited device ids and a most-recently-placed list. (When the
 * community DB / accounts land these move to the user store.)
 */
const FAV_KEY = "sigpath.favorites.v1";
const RECENT_KEY = "sigpath.recents.v1";
const CONVERTER_KEY = "sigpath.converterDefaults.v1";
const RECENT_MAX = 8;

function readArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? (data as string[]) : [];
  } catch {
    return [];
  }
}

export function loadFavorites(): Set<string> {
  return new Set(readArray(FAV_KEY));
}

export function saveFavorites(favs: Set<string>): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
  } catch {
    /* ignore storage errors */
  }
}

export function loadRecents(): string[] {
  return readArray(RECENT_KEY);
}

/** Record a placed device as most-recent; returns the updated list. */
export function pushRecent(id: string): string[] {
  const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage errors */
  }
  return next;
}

/**
 * Learned converter defaults — the device the user last picked to bridge a given
 * connector pair, so the next identical mismatch is a one-click fix instead of a
 * chooser. Keyed `sourceConnector>targetConnector` → device model id. Learned only
 * on an explicit chooser pick; editable in Preferences.
 */
export const converterPairKey = (source: string, target: string): string => `${source}>${target}`;

export function loadConverterDefaults(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CONVERTER_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? (data as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveConverterDefaults(map: Record<string, string>): void {
  try {
    localStorage.setItem(CONVERTER_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage errors */
  }
}

export function getConverterDefault(source: string, target: string): string | undefined {
  return loadConverterDefaults()[converterPairKey(source, target)];
}

export function setConverterDefault(source: string, target: string, modelId: string): void {
  const map = loadConverterDefaults();
  map[converterPairKey(source, target)] = modelId;
  saveConverterDefaults(map);
}

export function clearConverterDefault(pairKey: string): void {
  const map = loadConverterDefaults();
  delete map[pairKey];
  saveConverterDefaults(map);
}
