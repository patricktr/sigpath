import { useState } from "react";
import type { Revision } from "../schema";
import "./RevisionsPanel.css";

/** Compact relative time, e.g. "just now", "5m ago", "2h ago", "3d ago", then a date. */
function relativeTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * Revision history (p2-revisions). Lists the project's saved versions newest-first;
 * restore is non-destructive (undoable). Naming a save point keeps it forever as a
 * milestone (unnamed ones are pruned to the most recent 25).
 */
export function RevisionsPanel({
  revisions,
  onClose,
  onRestore,
  onName,
}: {
  revisions: Revision[];
  onClose: () => void;
  onRestore: (id: string) => void;
  onName: (id: string, label: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ordered = [...revisions].reverse(); // newest first

  function commit(id: string) {
    onName(id, draft);
    setEditingId(null);
  }

  return (
    <aside className="rev-panel">
      <header className="rev-panel__head">
        <h2>Revisions</h2>
        <button type="button" className="rev-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="rev-panel__body">
        {ordered.length === 0 ? (
          <p className="rev-empty">
            No revisions yet. A version is captured each time you save — name one to keep it as a
            milestone.
          </p>
        ) : (
          <ul className="rev-list">
            {ordered.map((r, i) => (
              <li key={r.id} className={r.label ? "rev-row rev-row--named" : "rev-row"}>
                <div className="rev-row__main">
                  <span className="rev-row__time">
                    {relativeTime(r.at)}
                    {i === 0 ? " · latest" : ""}
                  </span>
                  {editingId === r.id ? (
                    <input
                      autoFocus
                      className="rev-row__edit"
                      value={draft}
                      placeholder="Name this version…"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commit(r.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="rev-row__label">{r.label ?? "Save point"}</span>
                  )}
                </div>
                <div className="rev-row__actions">
                  <button
                    type="button"
                    className="rev-btn"
                    onClick={() => {
                      setEditingId(r.id);
                      setDraft(r.label ?? "");
                    }}
                    title={r.label ? "Rename" : "Name this version"}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="rev-btn rev-btn--restore"
                    onClick={() => onRestore(r.id)}
                    title="Restore this version (undoable)"
                  >
                    ↩ Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
