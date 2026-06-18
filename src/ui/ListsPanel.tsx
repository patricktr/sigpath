import type { DerivedLists } from "../lists/derive";
import "./ListsPanel.css";

/** Read-only panel showing the auto-generated pack list and patch list. */
export function ListsPanel({ lists, onClose }: { lists: DerivedLists; onClose: () => void }) {
  const { devices, cables, patches } = lists;

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
          <h3>Patch list</h3>
          {patches.length === 0 ? (
            <p className="lists-empty">No connections yet.</p>
          ) : (
            <table className="patchlist">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Cable</th>
                </tr>
              </thead>
              <tbody>
                {patches.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.fromDevice} <span className="patch-port">{p.fromPort}</span>
                    </td>
                    <td>
                      {p.toDevice} <span className="patch-port">{p.toPort}</span>
                    </td>
                    <td>
                      <span className="packlist__swatch" style={{ background: p.cableColor }} />
                      {p.cableType}
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
