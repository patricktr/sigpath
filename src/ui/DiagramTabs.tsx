import { useState } from "react";
import "./DiagramTabs.css";

type TabInfo = { id: string; name: string };

type Props = {
  diagrams: TabInfo[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

/**
 * Bottom tab strip for navigating the diagrams within the open project
 * (the OS handles organizing projects into folders). Double-click a tab to
 * rename it inline.
 */
export function DiagramTabs({ diagrams, activeId, onSwitch, onAdd, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(tab: TabInfo) {
    setEditingId(tab.id);
    setDraft(tab.name);
  }

  function commitEdit() {
    if (editingId) onRename(editingId, draft.trim() || "Untitled");
    setEditingId(null);
  }

  return (
    <div className="tabs">
      {diagrams.map((d) => (
        <div
          key={d.id}
          className={d.id === activeId ? "tab tab--active" : "tab"}
          onClick={() => onSwitch(d.id)}
          onDoubleClick={() => startEdit(d)}
          title="Double-click to rename"
        >
          {editingId === d.id ? (
            <input
              autoFocus
              className="tab__edit"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tab__name">{d.name}</span>
          )}
          {diagrams.length > 1 && editingId !== d.id && (
            <button
              type="button"
              className="tab__del"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(d.id);
              }}
              aria-label={`Delete ${d.name}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" className="tab-add" onClick={onAdd} aria-label="Add diagram" title="Add diagram">
        +
      </button>
    </div>
  );
}
