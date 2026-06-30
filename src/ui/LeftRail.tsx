import type { ReactNode } from "react";

export type RailDevice = { id: string; title: string; tag: string };

/** Left rail: the signal-layer view filter for the diagram + a selectable list of
 *  the devices on the canvas. */
export function LeftRail({
  filter,
  devices,
  selectedId,
  onSelect,
}: {
  /** The signal-layer filter control (p2-typefilter), composed by App. */
  filter: ReactNode;
  devices: RailDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="rail">
      {filter}

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
