/**
 * Lightweight per-user UI preferences for the Add-Device surfaces, persisted in
 * localStorage: favorited device ids and a most-recently-placed list. (When the
 * community DB / accounts land these move to the user store.)
 */
const FAV_KEY = "sigpath.favorites.v1";
const RECENT_KEY = "sigpath.recents.v1";
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
