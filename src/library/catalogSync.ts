import type { DeviceModel } from "../schema";

/**
 * The catalog pull protocol — read the remote `manifest.json`, and if its `rev`
 * is newer than what we have, fetch the snapshot it points at, verify its sha256,
 * and hand back the parsed models. Pure but for the injected `httpGet`, so it's
 * unit-testable against a local server or a mock. Caching + applying the result
 * is the caller's job (see catalogUpdate.ts).
 *
 * rev-gating already makes the steady-state check cheap: only the 252-byte
 * manifest is fetched unless the catalog actually changed, so ETag/304 on the
 * (large) snapshot would be redundant here.
 */
export type HttpResponse = { ok: boolean; status: number; text: string };
export type HttpGet = (url: string) => Promise<HttpResponse>;

type Manifest = {
  rev: number;
  minAppVersion?: string;
  full: { url: string; sha256?: string; bytes?: number };
};

export type SyncResult =
  | { status: "updated"; rev: number; count: number; models: DeviceModel[] }
  | { status: "current"; rev: number }
  | { status: "offline" }
  | { status: "error"; reason: string };

const defaultHttpGet: HttpGet = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
};

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function syncCatalog(opts: {
  /** Base URL containing manifest.json + the snapshot. */
  source: string;
  /** The rev we already have (bundled or cached). */
  currentRev: number;
  httpGet?: HttpGet;
  /** Defaults true; verifies the snapshot against the manifest's sha256. */
  verify?: boolean;
}): Promise<SyncResult> {
  const httpGet = opts.httpGet ?? defaultHttpGet;
  const base = opts.source.replace(/\/+$/, "");

  // Network failure → offline; reached-but-bad-data → error. Keep the fetch and
  // the parse in separate try blocks so a malformed manifest isn't read as offline.
  let manifestText: string;
  try {
    const res = await httpGet(`${base}/manifest.json`);
    if (!res.ok) return { status: "error", reason: `manifest HTTP ${res.status}` };
    manifestText = res.text;
  } catch {
    return { status: "offline" };
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestText) as Manifest;
  } catch {
    return { status: "error", reason: "manifest is not valid JSON" };
  }
  if (typeof manifest?.rev !== "number" || !manifest.full?.url) {
    return { status: "error", reason: "malformed manifest" };
  }
  if (manifest.rev <= opts.currentRev) return { status: "current", rev: opts.currentRev };

  let text: string;
  try {
    const res = await httpGet(`${base}/${manifest.full.url}`);
    if (!res.ok) return { status: "error", reason: `snapshot HTTP ${res.status}` };
    text = res.text;
  } catch {
    return { status: "offline" };
  }

  if (opts.verify !== false && manifest.full.sha256) {
    if ((await sha256Hex(text)) !== manifest.full.sha256) {
      return { status: "error", reason: "sha256 mismatch — snapshot rejected" };
    }
  }

  let models: DeviceModel[];
  try {
    models = JSON.parse(text) as DeviceModel[];
  } catch {
    return { status: "error", reason: "snapshot is not valid JSON" };
  }
  if (!Array.isArray(models)) return { status: "error", reason: "snapshot is not an array" };

  return { status: "updated", rev: manifest.rev, count: models.length, models };
}
