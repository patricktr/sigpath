import { useState } from "react";
import type { DerivedLists } from "../lists/derive";
import { formatLength, type DistanceUnit } from "../units";
import type { ExportFormat } from "../io/exportDocs";
import "./ListsPanel.css";

const EXPORT_ITEMS: { format: ExportFormat; label: string }[] = [
  { format: "pdf", label: "PDF document" },
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "csv", label: "CSV" },
  { format: "clipboard", label: "Copy schedule" },
];

/** "Export ▾" split menu in the Lists-panel header (p3-cableschedule). */
function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-menu" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="export-menu__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Export ▾
      </button>
      {open && (
        <div className="export-menu__pop" role="menu">
          {EXPORT_ITEMS.map((it) => (
            <button
              key={it.format}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onExport(it.format);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only panel showing the auto-generated pack list and patch list. */
export function ListsPanel({
  lists,
  unit,
  onClose,
  onRenumber,
  onExport,
}: {
  lists: DerivedLists;
  /** Distance unit for run lengths (storage stays metric; this is display-only). */
  unit: DistanceUnit;
  onClose: () => void;
  /** Re-sequence every cable's ID by signal group. */
  onRenumber?: () => void;
  /** Export the BOM + cable schedule in the chosen format. */
  onExport?: (format: ExportFormat) => void;
}) {
  const { devices, cables, adapters, patches } = lists;
  const totalMeters = cables.reduce((sum, c) => sum + (c.lengthMeters ?? 0), 0);

  return (
    <aside className="lists-panel">
      <header className="lists-panel__head">
        <h2>Lists</h2>
        <div className="lists-panel__actions">
          {onExport && <ExportMenu onExport={onExport} />}
          <button type="button" className="lists-panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </header>

      <div className="lists-panel__body">
        <section className="lists-section">
          <h3>Pack list · devices</h3>
          {devices.length === 0 ? (
            <p className="lists-empty">No devices yet.</p>
          ) : (
            <ul className="packlist">
              {devices.map((d) => (
                <li className="packlist__row" key={d.key}>
                  <span className="packlist__count">{d.count}×</span>
                  <span className="packlist__name">{d.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lists-section">
          <h3>Pack list · cables</h3>
          {cables.length === 0 ? (
            <p className="lists-empty">No cables yet.</p>
          ) : (
            <>
              <ul className="packlist">
                {cables.map((c) => (
                  <li className="packlist__row" key={c.id}>
                    <span className="packlist__count">{c.count}×</span>
                    <span className="packlist__swatch" style={{ background: c.color }} />
                    <span className="packlist__name">{c.label}</span>
                    {c.lengthMeters != null && (
                      <span className="packlist__len">{formatLength(c.lengthMeters, unit)}</span>
                    )}
                  </li>
                ))}
              </ul>
              {totalMeters > 0 && (
                <div className="packlist__total">Total cable · {formatLength(totalMeters, unit)}</div>
              )}
            </>
          )}
        </section>

        <section className="lists-section">
          <h3>Cables &amp; adapters</h3>
          {adapters.length === 0 ? (
            <p className="lists-empty">Every run is like-to-like — no adapters needed.</p>
          ) : (
            <ul className="packlist">
              {adapters.map((a) => (
                <li className="packlist__row" key={a.key}>
                  <span className="packlist__count">{a.count}×</span>
                  <span className="packlist__swatch" style={{ background: a.color }} />
                  <span className="packlist__name">{a.label}</span>
                  {a.kind === "converter" && (
                    <span
                      style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#ef4444" }}
                    >
                      converter needed
                    </span>
                  )}
                  {a.kind === "psu" && (
                    <span
                      style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#94a3b8" }}
                    >
                      supplied
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lists-section">
          <div className="lists-section__head">
            <h3>Patch list</h3>
            {onRenumber && patches.length > 0 && (
              <button type="button" className="lists-section__action" onClick={onRenumber}>
                Renumber
              </button>
            )}
          </div>
          {patches.length === 0 ? (
            <p className="lists-empty">No connections yet.</p>
          ) : (
            <table className="patchlist">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Cable</th>
                </tr>
              </thead>
              <tbody>
                {patches.map((p) => (
                  <tr key={p.id}>
                    <td className="patch-id">{p.cableId || "—"}</td>
                    <td>
                      {p.fromDevice} <span className="patch-port">{p.fromPort}</span>
                      {p.fromConnector && p.fromConnector.toLowerCase() !== p.fromPort.toLowerCase() && (
                        <span className="patch-conn">{p.fromConnector}</span>
                      )}
                    </td>
                    <td>
                      {p.toDevice} <span className="patch-port">{p.toPort}</span>
                      {p.toConnector && p.toConnector.toLowerCase() !== p.toPort.toLowerCase() && (
                        <span className="patch-conn">{p.toConnector}</span>
                      )}
                    </td>
                    <td>
                      <span className="packlist__swatch" style={{ background: p.cableColor }} />
                      {p.cableType}
                      {p.length != null && (
                        <span className="patch-port"> · {formatLength(p.length, unit)}</span>
                      )}
                      {p.note && <span className="patch-note">{p.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </aside>
  );
}
