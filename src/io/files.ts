import { save, open, confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

const FILTERS = [{ name: "sigpath diagram", extensions: ["sigpath", "json"] }];

/** Native "save as" dialog. Returns the chosen path, or null if cancelled. */
export async function promptSavePath(defaultName = "diagram.sigpath"): Promise<string | null> {
  return await save({ filters: FILTERS, defaultPath: defaultName });
}

/** Native "open" dialog. Returns the chosen path, or null if cancelled. */
export async function promptOpenPath(): Promise<string | null> {
  const result = await open({ multiple: false, directory: false, filters: FILTERS });
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
