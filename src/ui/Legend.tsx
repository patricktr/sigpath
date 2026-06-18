import type { CableTypeDef } from "../schema";
import "./Legend.css";

export type LegendItem = { type: CableTypeDef; count: number };

/** Color-coded overview of the cable types used in the current diagram. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      <div className="legend__title">Cable types</div>
      <ul className="legend__list">
        {items.map(({ type, count }) => (
          <li className="legend__row" key={type.id}>
            <span className="legend__swatch" style={{ background: type.color }} />
            <span className="legend__label">{type.label}</span>
            <span className="legend__count">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
