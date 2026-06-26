import { useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { loadBuilds, removeBuild, renameBuild, saveBuild } from "../library/buildsLibrary";
import { parseSigbuild, serializeBuild } from "../io/buildFile";
import { promptOpenBuildPath, promptSaveBuildPath, readTextFromPath, writeTextToPath } from "../io/files";
import { buildPartCounts } from "../schema";
import type { Build } from "../schema";
import "./AddDevice/AddDevice.css";

type Props = {
  /** Stamp this build into the active diagram as a block. */
  onInsert: (build: Build) => void;
  /** Report a result (export/import success or failure) to the app status line. */
  onStatus?: (message: string) => void;
  onClose: () => void;
};

/**
 * The "Custom builds" library (p2-savebuild): browse the saved zone/tab sub-assemblies and
 * stamp one into the current project. Reuses the Add-Device dialog shell for a consistent
 * look. Deleting a build removes only the reusable entry — blocks already placed keep their
 * own embedded copy, just like deleting a custom device.
 */
export function BuildsPanel({ onInsert, onStatus, onClose }: Props) {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let live = true;
    loadBuilds().then((b) => {
      if (!live) return;
      setBuilds(b);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const del = async (b: Build) => {
    const ok = await confirm(
      `Delete the build “${b.name}”? Blocks already placed keep their copy; only the reusable entry is removed.`,
      { title: "Delete build", kind: "warning", okLabel: "Delete" },
    );
    if (!ok) return;
    setBuilds(await removeBuild(b.id));
  };

  // Export a build to a standalone .sigbuild file for backup or sharing.
  const exportBuild = async (b: Build) => {
    const path = await promptSaveBuildPath(`${b.name}.sigbuild`);
    if (!path) return;
    try {
      await writeTextToPath(path, serializeBuild(b));
      onStatus?.(`Exported “${b.name}” · ${path}`);
    } catch (e) {
      onStatus?.(`Export failed: ${String(e)}`);
    }
  };

  // Import a .sigbuild file into the local library.
  const importBuild = async () => {
    const path = await promptOpenBuildPath();
    if (!path) return;
    try {
      const { build } = parseSigbuild(await readTextFromPath(path));
      setBuilds(await saveBuild(build));
      onStatus?.(`Imported “${build.name}”`);
    } catch (e) {
      onStatus?.(`Import failed: ${String(e)}`);
    }
  };

  const startRename = (b: Build) => {
    setEditingId(b.id);
    setDraft(b.name);
  };
  const commitRename = async () => {
    if (editingId) setBuilds(await renameBuild(editingId, draft.trim() || "Untitled build"));
    setEditingId(null);
  };

  const sorted = [...builds].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="adv-scrim" onMouseDown={onClose}>
      <div className="adv-stop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="adv-db" role="dialog" aria-label="Custom builds">
          <div className="adv-db__head">
            <h2 className="adv-db__title">Custom builds</h2>
            <button type="button" className="adv-db__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <div className="adv-db__rows">
            {loading ? (
              <div className="adv-emptynote">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="adv-emptynote">
                No saved builds yet. Save a tab or a zone as a build to reuse it across projects.
              </div>
            ) : (
              sorted.map((b) => {
                const { devices, cables } = buildPartCounts(b);
                return (
                  <div
                    key={b.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editingId === b.id ? (
                        <input
                          autoFocus
                          className="tab__edit"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      ) : (
                        <span
                          className="adv-cell-model"
                          title="Double-click to rename"
                          onDoubleClick={() => startRename(b)}
                        >
                          {b.name}
                        </span>
                      )}
                      <span className="adv-cell-muted" style={{ display: "block", fontSize: 12 }}>
                        {b.category ? `${b.category} · ` : ""}
                        {devices} device{devices === 1 ? "" : "s"} · {cables} cable{cables === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span className="adv-rowactions">
                      <button
                        type="button"
                        className="adv-delbtn"
                        onClick={() => exportBuild(b)}
                        title="Export to a .sigbuild file"
                        aria-label={`Export build ${b.name}`}
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        className="adv-delbtn"
                        onClick={() => del(b)}
                        title="Delete from your builds"
                        aria-label={`Delete build ${b.name}`}
                      >
                        Delete
                      </button>
                      <button type="button" className="adv-addbtn" onClick={() => onInsert(b)}>
                        Insert
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="adv-db__footer">
            <span>
              {sorted.length} saved build{sorted.length === 1 ? "" : "s"}
            </span>
            <button type="button" className="adv-new" onClick={importBuild}>
              ⤒ Import build…
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
