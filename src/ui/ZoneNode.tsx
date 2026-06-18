import { createContext, useContext, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { ZoneNodeType } from "../flow/types";
import "./ZoneNode.css";

/** Zone edits are routed up to App (which owns the controlled node state). */
export type ZoneActions = {
  rename: (id: string, label: string) => void;
  recolor: (id: string, color: string) => void;
  /** Snapshot before a resize so it's its own undo step. */
  beginChange: () => void;
};

export const ZoneActionsContext = createContext<ZoneActions>({
  rename: () => {},
  recolor: () => {},
  beginChange: () => {},
});

export const ZONE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#64748b",
];

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A labeled, colored region rendered behind the device nodes. Resizable via
 * NodeResizer; double-click the label to rename; pick a color when selected.
 */
export function ZoneNode({ id, data, selected }: NodeProps<ZoneNodeType>) {
  const { rename, recolor, beginChange } = useContext(ZoneActionsContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);

  function commit() {
    rename(id, draft.trim() || "Zone");
    setEditing(false);
  }

  return (
    <>
      <NodeResizer
        color={data.color}
        isVisible={!!selected}
        minWidth={120}
        minHeight={80}
        onResizeStart={beginChange}
      />
      <div className="zone" style={{ background: withAlpha(data.color, 0.08), borderColor: data.color }}>
        <div className="zone__header">
          {editing ? (
            <input
              autoFocus
              className="zone__edit nodrag"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <span
              className="zone__label"
              style={{ color: data.color }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setDraft(data.label);
                setEditing(true);
              }}
            >
              {data.label}
            </span>
          )}

          {selected && (
            <div className="zone__swatches nodrag">
              {ZONE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="zone__swatch"
                  style={{ background: c }}
                  onClick={(e) => {
                    e.stopPropagation();
                    recolor(id, c);
                  }}
                  aria-label={`Set color ${c}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
