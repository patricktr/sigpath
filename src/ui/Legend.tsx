import "./Legend.css";

export type LegendItem = { id: string; label: string; color: string; count: number };

/** Color-coded overview of the cable types used in the current diagram. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      <div className="legend__title">Cable types</div>
      <ul className="legend__list">
        {items.map(({ id, label, color, count }) => (
          <li className="legend__row" key={id}>
            <span className="legend__swatch" style={{ background: color }} />
            <span className="legend__label">{label}</span>
            <span className="legend__count">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
