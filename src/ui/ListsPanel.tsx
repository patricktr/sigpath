import { useState } from "react";
import type { DerivedLists } from "../lists/derive";
import { formatLength, type DistanceUnit } from "../units";
import type { ExportFormat } from "../io/exportDocs";
import { INSTALL_LABEL, installStage, nextInstall, isCableDone } from "../install";
import { skuName } from "../bomRules";
import type { InstallStatus } from "../schema";
import "./ListsPanel.css";

const EXPORT_ITEMS: { format: ExportFormat; label: string }[] = [
  { format: "pdf", label: "PDF document" },
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "csv", label: "CSV" },
  { format: "clipboard", label: "Copy schedule" },
  { format: "labels", label: "Cable labels" },
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
  bomProgress,
  onClose,
  onRenumber,
  onExport,
  onSetInstall,
  onSetReceived,
}: {
  lists: DerivedLists;
  /** Distance unit for run lengths (storage stays metric; this is display-only). */
  unit: DistanceUnit;
  /** Install checklist: received/installed count per device model id. */
  bomProgress?: Record<string, number>;
  onClose: () => void;
  /** Re-sequence every cable's ID by signal group. */
  onRenumber?: () => void;
  /** Export the BOM + cable schedule in the chosen format. */
  onExport?: (format: ExportFormat) => void;
  /** Advance a cable's install status (presence enables checklist mode). */
  onSetInstall?: (edgeId: string, status: InstallStatus) => void;
  /** Set an equipment line's received count (presence enables checklist mode). */
  onSetReceived?: (modelId: string, count: number) => void;
}) {
  const { devices, cables, adapters, patches, cableBom } = lists;
  const totalMeters = cables.reduce((sum, c) => sum + (c.lengthMeters ?? 0), 0);

  const canCheck = !!(onSetInstall && onSetReceived);
  const [checklist, setChecklist] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const received = (modelId: string) => bomProgress?.[modelId] ?? 0;
  const gearDone = devices.filter((d) => received(d.key) >= d.count).length;
  const cablesTested = patches.filter((p) => isCableDone(p.install)).length;

  return (
    <aside className="lists-panel">
      <header className="lists-panel__head">
        <h2>Lists</h2>
        <div className="lists-panel__actions">
          {canCheck && (
            <button
              type="button"
              className={checklist ? "lists-toggle is-on" : "lists-toggle"}
              aria-pressed={checklist}
              onClick={() => setChecklist((c) => !c)}
            >
              Install
            </button>
          )}
          {onExport && <ExportMenu onExport={onExport} />}
          <button type="button" className="lists-panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </header>

      {checklist && canCheck && (
        <div className="checklist-bar">
          <span className="checklist-progress">
            Cables {cablesTested}/{patches.length} tested · Gear {gearDone}/{devices.length} received
          </span>
          <label className="checklist-hide">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            Hide completed
          </label>
        </div>
      )}

      <div className="lists-panel__body">
        <section className="lists-section">
          <h3>Pack list · devices</h3>
          {devices.length === 0 ? (
            <p className="lists-empty">No devices yet.</p>
          ) : (
            <ul className="packlist">
              {devices.map((d) => {
                const recv = received(d.key);
                const done = recv >= d.count;
                if (checklist && hideDone && done) return null;
                return (
                  <li className={checklist && done ? "packlist__row is-done" : "packlist__row"} key={d.key}>
                    <span className="packlist__count">{d.count}×</span>
                    <span className="packlist__name">{d.name}</span>
                    {checklist && onSetReceived && (
                      <span className={done ? "bom-recv is-done" : "bom-recv"}>
                        <button
                          type="button"
                          onClick={() => onSetReceived(d.key, Math.max(0, recv - 1))}
                          aria-label="Decrease received"
                        >
                          −
                        </button>
                        <span className="bom-recv__count">
                          {recv}/{d.count}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSetReceived(d.key, recv + 1)}
                          aria-label="Increase received"
                        >
                          +
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="lists-section">
          <h3>Pack list · cables</h3>
          {(cableBom ? cableBom.length === 0 : cables.length === 0) ? (
            <p className="lists-empty">No cables yet.</p>
          ) : (
            <>
              <ul className="packlist">
                {cableBom
                  ? cableBom.map((line) => (
                      <li className="packlist__row" key={line.sku.key}>
                        <span className="packlist__count">{line.order}×</span>
                        <span className="packlist__swatch" style={{ background: line.sku.color }} />
                        <span className="packlist__name">{skuName(line.sku, unit)}</span>
                        {line.spares > 0 && (
                          <span className="packlist__spare">
                            {line.base} + {line.spares} spare
                          </span>
                        )}
                      </li>
                    ))
                  : cables.map((c) => (
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
                {patches
                  .filter((p) => !(checklist && hideDone && isCableDone(p.install)))
                  .map((p) => (
                  <tr key={p.id}>
                    <td className="patch-id">
                      {p.cableId || "—"}
                      {checklist && onSetInstall && (
                        <button
                          type="button"
                          className={`install-pill install-pill--${installStage(p.install)}`}
                          onClick={() => onSetInstall(p.id, nextInstall(p.install))}
                          title="Click to advance install status"
                        >
                          {INSTALL_LABEL[installStage(p.install)]}
                        </button>
                      )}
                    </td>
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
