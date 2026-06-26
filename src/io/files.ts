import { save, open, confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

const FILTERS = [{ name: "sigpath diagram", extensions: ["sigpath", "json"] }];
const BUILD_FILTERS = [{ name: "sigpath build", extensions: ["sigbuild"] }];

/** Native "save as" dialog. Returns the chosen path, or null if cancelled. */
export async function promptSavePath(defaultName = "diagram.sigpath"): Promise<string | null> {
  return await save({ filters: FILTERS, defaultPath: defaultName });
}

/** Native "open" dialog. Returns the chosen path, or null if cancelled. */
export async function promptOpenPath(): Promise<string | null> {
  const result = await open({ multiple: false, directory: false, filters: FILTERS });
  return typeof result === "string" ? result : null;
}

/** Native "save as" dialog for a reusable build (`.sigbuild`, p2-savebuild). */
export async function promptSaveBuildPath(defaultName = "build.sigbuild"): Promise<string | null> {
  return await save({ filters: BUILD_FILTERS, defaultPath: defaultName });
}

/** Native "open" dialog for a `.sigbuild` file. Returns the chosen path, or null if cancelled. */
export async function promptOpenBuildPath(): Promise<string | null> {
  const result = await open({ multiple: false, directory: false, filters: BUILD_FILTERS });
  return typeof result === "string" ? result : null;
}

/** Write text via a Rust command (avoids granting broad fs-plugin scope). */
export async function writeTextToPath(path: string, contents: string): Promise<void> {
  await invoke("write_file", { path, contents });
}

/** Read text via a Rust command. */
export async function readTextFromPath(path: string): Promise<string> {
  return await invoke<string>("read_file", { path });
}

/** Base filename without extension, e.g. "/a/b/Studio A.sigpath" -> "Studio A". */
export function fileStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

/** Native confirm dialog before deleting an entire diagram. When the diagram is embedded
 *  as a block elsewhere, the message warns that those references will degrade (decision 5).
 *  Returns true to proceed. */
export async function confirmDeleteDiagram(name: string, blockRefs = 0): Promise<boolean> {
  const cascade =
    blockRefs > 0
      ? ` It's embedded as a block in ${blockRefs} place${blockRefs === 1 ? "" : "s"}, which will become "Missing tab" placeholders.`
      : "";
  return await confirm(`Delete "${name}"? This removes the diagram and everything in it.${cascade}`, {
    title: "Delete diagram",
    kind: "warning",
    okLabel: "Delete",
    cancelLabel: "Cancel",
  });
}

/** Confirm before promoting a zone to its own tab — destructive (contents MOVE), so the
 *  user previews what's affected. Returns true to proceed. */
export async function confirmPromoteZone(name: string, deviceCount: number): Promise<boolean> {
  const n = deviceCount === 1 ? "1 device" : `${deviceCount} devices`;
  return await confirm(
    `Promote "${name}" to its own tab? This moves ${n} (and their cables) into a new tab and replaces the zone with a block here. Undoable.`,
    { title: "Promote zone to tab", kind: "info", okLabel: "Promote", cancelLabel: "Cancel" },
  );
}

/** Confirm before refreshing a tab's published boundary (p2-blockdrift) — destructive when it
 *  prunes a port that still carries a host cable, so the user previews the blast radius first.
 *  Returns true to proceed. */
export async function confirmRefreshBoundary(
  roomName: string,
  opts: { removed: string[]; remirrored: number },
): Promise<boolean> {
  const parts: string[] = [];
  if (opts.removed.length) {
    parts.push(`remove ${opts.removed.length} port${opts.removed.length === 1 ? "" : "s"} (${opts.removed.join(", ")})`);
  }
  if (opts.remirrored) parts.push(`re-mirror ${opts.remirrored} port${opts.remirrored === 1 ? "" : "s"}`);
  const removedNote = opts.removed.length ? " Cables to removed ports will show as “Broken connection”." : "";
  return await confirm(`Refresh “${roomName}” — ${parts.join(" and ")}.${removedNote}`, {
    title: "Refresh block ports",
    kind: "info",
    okLabel: "Refresh",
    cancelLabel: "Cancel",
  });
}

/** Prompt for a path and write a text file (e.g. CSV). Returns the path, or null if cancelled. */
export async function saveText(text: string, defaultName: string, ext: string): Promise<string | null> {
  const path = await save({ filters: [{ name: ext.toUpperCase(), extensions: [ext] }], defaultPath: defaultName });
  if (!path) return null;
  await invoke("write_file", { path, contents: text });
  return path;
}

/** Prompt for a path and write base64-encoded binary (e.g. PNG/JPG/PDF). */
export async function saveBinary(base64: string, defaultName: string, ext: string): Promise<string | null> {
  const path = await save({ filters: [{ name: ext.toUpperCase(), extensions: [ext] }], defaultPath: defaultName });
  if (!path) return null;
  await invoke("write_file_base64", { path, data: base64 });
  return path;
}
