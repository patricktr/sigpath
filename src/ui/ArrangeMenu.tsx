import { useEffect, useRef, useState } from "react";
import type { ArrangeMode } from "../flow/arrange";
import type { SavedLayout } from "../schema";

/**
 * The Arrange ▾ toolbar dropdown (p2-autoarrangezones): four one-shot layout modes, the
 * diagram's saved named layouts (apply / delete), and "save the current layout". The
 * toolbar button itself re-runs the LAST-USED mode; the caret opens the menu.
 */
const MODES: { id: ArrangeMode; label: string; hint: string }[] = [
  { id: "flow", label: "Signal flow →", hint: "Left-to-right by signal; zones stay together" },
  { id: "zones", label: "By zone", hint: "Each zone arranged inside, zones packed by cabling" },
  { id: "hub", label: "Around a hub", hint: "Sources left, destinations right of the hub — select a device to choose it" },
  { id: "grid", label: "Compact grid", hint: "Dense packing, ignores flow" },
];

export function ArrangeMenu({
  lastMode,
  layouts,
  onArrange,
  onApplyLayout,
  onSaveLayout,
  onDeleteLayout,
}: {
  lastMode: ArrangeMode;
  layouts: SavedLayout[];
  onArrange: (mode: ArrangeMode) => void;
  onApplyLayout: (id: string) => void;
  onSaveLayout: (name: string) => void;
  onDeleteLayout: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const modeLabel = MODES.find((m) => m.id === lastMode)?.label ?? "Signal flow →";
  const commitSave = () => {
    onSaveLayout(saveName);
    setSaveName("");
    setOpen(false);
  };

  return (
    <div className="arrmenu" ref={rootRef}>
      <button
        type="button"
        className="tbtn"
        onClick={() => onArrange(lastMode)}
        title={`Arrange (${modeLabel}) — undoable`}
      >
        Arrange
      </button>
      <button
        type="button"
        className={open ? "tbtn arrmenu__caret is-on" : "tbtn arrmenu__caret"}
        onClick={() => setOpen((v) => !v)}
        aria-label="Arrange options"
        aria-expanded={open}
      >
        ▾
      </button>
      {open && (
        <div className="arrmenu__panel" role="menu" aria-label="Arrange options">
          <div className="arrmenu__seclabel">Arrange</div>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={m.id === lastMode ? "arrmenu__item arrmenu__item--last" : "arrmenu__item"}
              onClick={() => {
                onArrange(m.id);
                setOpen(false);
              }}
              role="menuitem"
            >
              <span className="arrmenu__itemlabel">{m.label}</span>
              <span className="arrmenu__itemhint">{m.hint}</span>
            </button>
          ))}
          <div className="arrmenu__sep" />
          <div className="arrmenu__seclabel">Saved layouts</div>
          {layouts.length === 0 ? (
            <div className="arrmenu__empty">None yet — arrange or hand-place, then save below.</div>
          ) : (
            layouts.map((l) => (
              <div key={l.id} className="arrmenu__saved">
                <button
                  type="button"
                  className="arrmenu__item arrmenu__item--saved"
                  onClick={() => {
                    onApplyLayout(l.id);
                    setOpen(false);
                  }}
                  title="Apply this layout (undoable)"
                >
                  {l.name}
                </button>
                <button
                  type="button"
                  className="arrmenu__del"
                  onClick={() => onDeleteLayout(l.id)}
                  title={`Delete layout “${l.name}”`}
                  aria-label={`Delete layout ${l.name}`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
          <div className="arrmenu__sep" />
          <div className="arrmenu__saverow">
            <input
              value={saveName}
              placeholder="Save current layout as…"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSave();
              }}
              aria-label="New layout name"
            />
            <button type="button" onClick={commitSave} disabled={!saveName.trim()}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
