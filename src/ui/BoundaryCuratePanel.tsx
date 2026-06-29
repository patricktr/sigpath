import { useState } from "react";
import { cableColor, getConnector } from "../schema";
import type { BoundaryPort } from "../schema";
import "./BoundaryCuratePanel.css";

const DIR_LABEL: Record<string, string> = { input: "IN", output: "OUT", bidirectional: "I/O" };

type Props = {
  tabName: string;
  /** The tab's full published port set, including hidden ones (shown greyed here). */
  ports: BoundaryPort[];
  /** Boundary-port ids with a host cable attached — hiding them is blocked (would orphan it). */
  wiredPortIds: Set<string>;
  referencedBy: number;
  /** Commit a new published port set (rename / hide / reorder) — one undoable snapshot. */
  onChange: (nextPorts: BoundaryPort[]) => void;
  /** Reset a renamed port back to its auto-derived label (clears the `renamed` flag). */
  onResetName?: (id: string) => void;
  /** Switch the editor to the tab being curated. */
  onOpenTab?: () => void;
  onClose: () => void;
};

/**
 * Curate the public face a tab exposes when embedded as a block (p2-zonetab Phase C): rename,
 * hide, and reorder its boundary ports. Controlled — `ports` in, `onChange` out — so each edit is
 * one project snapshot and every embed re-binds immediately. A hidden port stays published (greyed
 * here) but drops from the rendered block at the synthesis seam; a port a cable is wired to can't
 * be hidden (it would orphan the run), so its toggle is disabled.
 */
export function BoundaryCuratePanel({
  tabName,
  ports,
  wiredPortIds,
  referencedBy,
  onChange,
  onResetName,
  onOpenTab,
  onClose,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const rename = (id: string, raw: string) => {
    const name = raw.trim();
    const p = ports.find((x) => x.id === id);
    if (!p || !name || name === p.name) return;
    onChange(ports.map((x) => (x.id === id ? { ...x, name, renamed: true } : x)));
  };
  const toggleHide = (p: BoundaryPort) => {
    if (wiredPortIds.has(p.id)) return; // wired → hiding would orphan the cable
    onChange(ports.map((x) => (x.id === p.id ? { ...x, hidden: !x.hidden } : x)));
  };
  const reorder = (drag: string, over: string) => {
    const from = ports.findIndex((p) => p.id === drag);
    const to = ports.findIndex((p) => p.id === over);
    if (from < 0 || to < 0 || from === to) return;
    const next = ports.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const visibleCount = ports.filter((p) => !p.hidden).length;

  return (
    <div className="curate-scrim" onMouseDown={onClose}>
      <div
        className="curate"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Published interface — ${tabName}`}
      >
        <header className="curate__head">
          <div>
            <div className="curate__title">Published interface</div>
            <div className="curate__sub">{tabName}</div>
          </div>
          <div className="curate__headbtns">
            {onOpenTab && (
              <button type="button" className="curate__open" onClick={onOpenTab}>
                Open tab
              </button>
            )}
            <button type="button" className="curate__close" onClick={onClose} aria-label="Done">
              ×
            </button>
          </div>
        </header>
        <div className="curate__meta">
          {referencedBy > 0
            ? `Embedded as a block in ${referencedBy} ${referencedBy === 1 ? "place" : "places"}`
            : "Not embedded yet"}
          {" · "}
          {visibleCount} of {ports.length} ports shown
        </div>

        {ports.length === 0 ? (
          <div className="curate__empty">This room exposes no ports yet.</div>
        ) : (
          <ul className="curate__list">
            {ports.map((p) => {
              const wired = wiredPortIds.has(p.id);
              return (
                <li
                  key={p.id}
                  className={[
                    "curate__row",
                    p.hidden && "curate__row--hidden",
                    overId === p.id && dragId && dragId !== p.id && "curate__row--over",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onDragOver={(e) => {
                    if (dragId && dragId !== p.id) {
                      e.preventDefault();
                      setOverId(p.id);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && dragId !== p.id) reorder(dragId, p.id);
                    setDragId(null);
                    setOverId(null);
                  }}
                >
                  <span
                    className="curate__grip"
                    draggable
                    onDragStart={(e) => {
                      setDragId(p.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    title="Drag to reorder"
                    aria-label="Drag to reorder"
                  >
                    ⠿
                  </span>
                  <span className="curate__dot" style={{ background: cableColor(p.connector) }} />
                  <input
                    key={`${p.id}:${p.name}`}
                    className="curate__name"
                    defaultValue={p.name}
                    onBlur={(e) => rename(p.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") {
                        (e.target as HTMLInputElement).value = p.name;
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    aria-label={`Rename ${p.name}`}
                  />
                  <span className="curate__pmeta">
                    {DIR_LABEL[p.direction]} · {getConnector(p.connector)?.label ?? p.connector}
                  </span>
                  {p.renamed && onResetName && (
                    <button
                      type="button"
                      className="curate__reset"
                      onClick={() => onResetName(p.id)}
                      title="Reset to the auto-generated name"
                      aria-label="Reset name"
                    >
                      ↺
                    </button>
                  )}
                  <button
                    type="button"
                    className="curate__eye"
                    onClick={() => toggleHide(p)}
                    disabled={wired}
                    title={
                      wired
                        ? "A cable is wired to this port — detach it before hiding"
                        : p.hidden
                          ? "Hidden from the block — click to show"
                          : "Shown on the block — click to hide"
                    }
                    aria-label={p.hidden ? "Show port" : "Hide port"}
                  >
                    {p.hidden ? "Show" : "Hide"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
