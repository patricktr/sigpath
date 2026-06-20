import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cableColor, cableLabel, connectorsByGroup, powerRole } from "../../schema";
import type { ConnectorDef, ConnectorId, PortDirection } from "../../schema";

type Props = {
  value: ConnectorId | "";
  onChange: (id: ConnectorId | "") => void;
  /** Floats the relevant power ends first (inputs → inlets, outputs → outlets). */
  direction?: PortDirection;
  /** Hide this connector — used by the combo picker to drop the primary. */
  exclude?: ConnectorId;
  /** Offer a "none" choice (combo jack) and show the placeholder when empty. */
  allowEmpty?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Extra class on the root (e.g. to shrink the secondary combo picker). */
  className?: string;
};

type Row =
  | { type: "header"; label: string }
  | { type: "option"; def: ConnectorDef; index: number };

const ROLE_LABEL: Record<string, string> = {
  outlet: "outlet",
  inlet: "inlet",
  "dc-inlet": "DC inlet",
};

/**
 * A searchable, grouped connector picker with inline ghost-text autocomplete.
 * Replaces the flat <select>: results are bucketed by signal group, matched on
 * label + colloquial aliases ("ethernet" → RJ45, "figure 8" → IEC C7), and the
 * top match completes as ghost text (⇥ to accept). The panel is portaled so it
 * isn't clipped by the wizard body's scroll.
 */
export function ConnectorPicker({
  value,
  onChange,
  direction,
  exclude,
  allowEmpty,
  placeholder = "Search connectors…",
  ariaLabel,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const groups = useMemo(() => connectorsByGroup(direction), [direction]);

  const { options, rows, ghost, topIndex } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: ConnectorDef) => {
      if (exclude && c.id === exclude) return false;
      if (!q) return true;
      return [c.label, c.id, ...(c.aliases ?? [])].join(" ").toLowerCase().includes(q);
    };
    const score = (c: ConnectorDef) => {
      const label = c.label.toLowerCase();
      if (label.startsWith(q)) return 0;
      if (label.includes(q)) return 1;
      if ((c.aliases ?? []).some((a) => a.toLowerCase().startsWith(q))) return 2;
      return 3;
    };
    const options: ConnectorDef[] = [];
    const rows: Row[] = [];
    for (const g of groups) {
      const items = g.items.filter(matches);
      if (!items.length) continue;
      rows.push({ type: "header", label: g.label });
      for (const def of items) {
        rows.push({ type: "option", def, index: options.length });
        options.push(def);
      }
    }
    let topIndex = 0;
    if (q && options.length) {
      let best = 99;
      options.forEach((c, i) => {
        const s = score(c);
        if (s < best) {
          best = s;
          topIndex = i;
        }
      });
    }
    let ghost = "";
    const top = options[topIndex];
    if (query && top && top.label.toLowerCase().startsWith(query.toLowerCase())) {
      ghost = top.label.slice(query.length);
    }
    return { options, rows, ghost, topIndex };
  }, [groups, query, exclude]);

  useEffect(() => setActive(topIndex), [topIndex, query]);

  // Position the portaled panel from the field, and keep it pinned while open.
  const place = () => {
    const r = fieldRef.current?.getBoundingClientRect();
    if (r) setRect(r);
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  // Close on a click outside both the field and the (portaled) panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const commit = (id: ConnectorId | "") => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (options[active]) commit(options[active].id);
        break;
      case "Tab":
        if (ghost && options[topIndex]) {
          e.preventDefault();
          commit(options[topIndex].id);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setQuery("");
        break;
    }
  };

  const selectedLabel = value ? cableLabel(value) : "";
  const panelStyle = ((): React.CSSProperties => {
    if (!rect) return { display: "none" };
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(280, openUp ? spaceAbove : spaceBelow));
    return {
      position: "fixed",
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    };
  })();

  return (
    <div className={`cxp-root${className ? ` ${className}` : ""}`} ref={rootRef}>
      <div
        className={`cxp-field${open ? " cxp-field--open" : ""}`}
        ref={fieldRef}
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <span
          className={`cxp-dot${value ? "" : " cxp-dot--empty"}`}
          style={value ? { background: cableColor(value) } : undefined}
        />
        <div className="cxp-inputwrap">
          {open && (
            <div className="cxp-ghost" aria-hidden="true">
              <span>{query}</span>
              <span className="cxp-ghost__rest">{ghost}</span>
            </div>
          )}
          <input
            ref={inputRef}
            className={`cxp-input${open && query ? " cxp-input--typing" : ""}`}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={ariaLabel}
            value={open ? query : selectedLabel}
            placeholder={open ? selectedLabel || placeholder : selectedLabel ? "" : placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              setQuery("");
            }}
            onBlur={() => {
              setOpen(false);
              setQuery("");
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {open && ghost && <kbd className="cxp-tab">⇥</kbd>}
        <span className="cxp-caret" aria-hidden="true" />
      </div>

      {open &&
        createPortal(
          <div className="cxp-panel" ref={panelRef} id={listId} role="listbox" style={panelStyle}>
            {allowEmpty && (
              <div
                className={`cxp-opt cxp-opt--none${!value ? " cxp-opt--active" : ""}`}
                role="option"
                aria-selected={!value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit("");
                }}
              >
                <span className="cxp-dot cxp-dot--empty" />
                <span className="cxp-opt__label">No combo connector</span>
              </div>
            )}
            {rows.length === 0 && <div className="cxp-empty">No matches</div>}
            {rows.map((r, i) =>
              r.type === "header" ? (
                <div className="cxp-group" key={`h-${i}`}>
                  {r.label}
                </div>
              ) : (
                <div
                  key={r.def.id}
                  data-i={r.index}
                  className={`cxp-opt${r.index === active ? " cxp-opt--active" : ""}${
                    r.def.id === value ? " cxp-opt--current" : ""
                  }`}
                  role="option"
                  aria-selected={r.def.id === value}
                  onMouseEnter={() => setActive(r.index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(r.def.id);
                  }}
                >
                  <span className="cxp-dot" style={{ background: cableColor(r.def.id) }} />
                  <span className="cxp-opt__label">{r.def.label}</span>
                  {r.def.group === "power" && powerRole(r.def.id) && (
                    <span className="cxp-tag">{ROLE_LABEL[powerRole(r.def.id)!]}</span>
                  )}
                  {r.def.id === value && <span className="cxp-check" aria-hidden="true">✓</span>}
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
