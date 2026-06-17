import { save, open } from "@tauri-apps/plugin-dialog";
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
