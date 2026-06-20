import type { LegendItem } from "./Legend";

export type RailDevice = { id: string; title: string; tag: string };

/** Left rail: the cable/connector legend for the diagram + a selectable list of
 *  the devices on the canvas. */
export function LeftRail({
  cables,
  devices,
  selectedId,
  onSelect,
}: {
  cables: LegendItem[];
  devices: RailDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="rail">
      <div className="rail__section">
        <div className="rail__label">Cables</div>
        {cables.length === 0 ? (
          <div className="rail__empty">No cables yet</div>
        ) : (
          <ul className="rail__list">
            {cables.map((c) => (
              <li className="rail__row" key={c.id}>
                <span className="rail__swatch" style={{ background: c.color }} />
                <span className="rail__name">{c.label}</span>
                <span className="rail__count">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rail__divider" />

      <div className="rail__section rail__section--grow">
        <div className="rail__label">Devices</div>
        {devices.length === 0 ? (
          <div className="rail__empty">No devices yet</div>
        ) : (
          <ul className="rail__list">
            {devices.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={d.id === selectedId ? "rail__device is-selected" : "rail__device"}
                  onClick={() => onSelect(d.id)}
                >
                  <span className="rail__tag">{d.tag}</span>
                  <span className="rail__name">{d.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
