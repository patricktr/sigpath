import type { DerivedLists } from "../lists/derive";
import "./ListsPanel.css";

/** Read-only panel showing the auto-generated pack list and patch list. */
export function ListsPanel({
  lists,
  onClose,
  onRenumber,
}: {
  lists: DerivedLists;
  onClose: () => void;
  /** Re-sequence every cable's ID by signal group. */
  onRenumber?: () => void;
}) {
  const { devices, cables, adapters, patches } = lists;

  return (
    <aside className="lists-panel">
      <header className="lists-panel__head">
        <h2>Lists</h2>
        <button type="button" className="lists-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
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
            <ul className="packlist">
              {cables.map((c) => (
                <li className="packlist__row" key={c.id}>
                  <span className="packlist__count">{c.count}×</span>
                  <span className="packlist__swatch" style={{ background: c.color }} />
                  <span className="packlist__name">{c.label}</span>
                </li>
              ))}
            </ul>
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
                    </td>
                    <td>
                      {p.toDevice} <span className="patch-port">{p.toPort}</span>
                    </td>
                    <td>
                      <span className="packlist__swatch" style={{ background: p.cableColor }} />
                      {p.cableType}
                      {p.length != null && <span className="patch-port"> · {p.length} m</span>}
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
