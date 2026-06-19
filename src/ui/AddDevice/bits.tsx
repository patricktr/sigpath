import type { DeviceModel } from "../../schema";
import { portColors } from "./addDevice";

/** Hand-drawn magnifier (circle + line), matching the design. */
export function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true" className="adv-mag">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Favorite star toggle; stops propagation so it doesn't trigger the row. */
export function StarButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={on ? "adv-star adv-star--on" : "adv-star"}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      ★
    </button>
  );
}

/** Up to 6 distinct signal-colored dots for a device. */
export function SignalDots({ model, size = 8 }: { model: DeviceModel; size?: number }) {
  return (
    <span className="adv-dots">
      {portColors(model).map((c, i) => (
        <span key={i} className="adv-dot" style={{ width: size, height: size, background: c }} />
      ))}
    </span>
  );
}
