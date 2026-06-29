import { useEffect, useState } from "react";
import "./DiagramTabs.css";

type TabInfo = { id: string; name: string; referencedBy?: number };

type Props = {
  diagrams: TabInfo[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Embed this tab into the active diagram as a block (p2-zonetab). */
  onEmbed: (id: string) => void;
  /** Save this tab as a reusable build (p2-savebuild). */
  onSaveAsBuild: (id: string) => void;
  /** Move `draggedId` to sit at `targetId`'s position (drag-to-reorder). */
  onReorder: (draggedId: string, targetId: string) => void;
  /** Curate this tab's published boundary ports — opens the interface panel (p2-zonetab Phase C). */
  onCurate?: (id: string) => void;
};

/**
 * Bottom tab strip for navigating the diagrams within the open project
 * (the OS handles organizing projects into folders). Double-click a tab to
 * rename it inline.
 */
export function DiagramTabs({
  diagrams,
  activeId,
  onSwitch,
  onAdd,
  onRename,
  onDelete,
  onEmbed,
  onSaveAsBuild,
  onReorder,
  onCurate,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Drag-to-reorder state: which tab is being dragged, and which it's hovering over
  // (for the drop-line indicator).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Right-click context menu (currently: curate the tab's published interface).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

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
          className={
            [
              "tab",
              d.id === activeId && "tab--active",
              dragId === d.id && "tab--dragging",
              overId === d.id && dragId && dragId !== d.id && "tab--dropbefore",
            ]
              .filter(Boolean)
              .join(" ")
          }
          draggable={editingId !== d.id}
          onClick={() => onSwitch(d.id)}
          onDoubleClick={() => startEdit(d)}
          onContextMenu={
            onCurate
              ? (e) => {
                  e.preventDefault();
                  setMenu({ id: d.id, x: e.clientX, y: e.clientY });
                }
              : undefined
          }
          onDragStart={(e) => {
            setDragId(d.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (dragId && dragId !== d.id) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOverId(d.id);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== d.id) onReorder(dragId, d.id);
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          title="Double-click to rename · drag to reorder"
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
          {!!d.referencedBy && editingId !== d.id && (
            <span
              className="tab__refs"
              title={`Embedded as a block in ${d.referencedBy} ${d.referencedBy === 1 ? "place" : "places"}`}
            >
              ⧉{d.referencedBy}
            </span>
          )}
          {d.id !== activeId && editingId !== d.id && (
            <button
              type="button"
              className="tab__embed"
              onClick={(e) => {
                e.stopPropagation();
                onEmbed(d.id);
              }}
              aria-label={`Embed ${d.name} in the current diagram`}
              title="Embed in the current diagram as a block"
            >
              ⧉
            </button>
          )}
          {editingId !== d.id && (
            <button
              type="button"
              className="tab__embed"
              onClick={(e) => {
                e.stopPropagation();
                onSaveAsBuild(d.id);
              }}
              aria-label={`Save ${d.name} as a reusable build`}
              title="Save as a reusable build"
            >
              ⤓
            </button>
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

      {menu && (
        <>
          <div
            className="tab-menu__scrim"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="tab-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            <button
              type="button"
              role="menuitem"
              className="tab-menu__item"
              onClick={() => {
                onCurate?.(menu.id);
                setMenu(null);
              }}
            >
              Edit published interface…
            </button>
          </div>
        </>
      )}
    </div>
  );
}
