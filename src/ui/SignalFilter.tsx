import type { SignalKind } from "../schema";
import type { SignalLayer } from "../flow/signalFilter";
import "./SignalFilter.css";

type Props = {
  /** The signal layers present in the diagram (rows to show). */
  layers: SignalLayer[];
  /** Active layers; EMPTY = no filter (everything shown). Otherwise only these stay lit. */
  active: Set<SignalKind>;
  onToggle: (k: SignalKind) => void;
  onSolo: (k: SignalKind) => void;
  onClear: () => void;
  /** Capability mode: also keep gear with matching ports that aren't wired yet. */
  includeUnwired: boolean;
  onIncludeUnwiredChange: (v: boolean) => void;
  /** Hide non-matching items entirely instead of fading them. */
  hideNonMatching: boolean;
  onHideNonMatchingChange: (v: boolean) => void;
};

/**
 * Signal-layer view filter (p2-typefilter) — the rail control that focuses the canvas on one
 * or more signal types. Each row toggles a layer; "only" solos it; "Show all" clears. Two mode
 * switches govern how the (not-yet-wired here) canvas dimming behaves. EMPTY active set = no
 * filter. This slice owns the control + state; the canvas dimming lands in the next slices.
 */
export function SignalFilter({
  layers,
  active,
  onToggle,
  onSolo,
  onClear,
  includeUnwired,
  onIncludeUnwiredChange,
  hideNonMatching,
  onHideNonMatchingChange,
}: Props) {
  const filtering = active.size > 0;
  return (
    <div className="rail__section">
      <div className="sigfilter__head">
        <div className="rail__label">Signal layers</div>
        {filtering && (
          <button type="button" className="sigfilter__clear" onClick={onClear}>
            Show all
          </button>
        )}
      </div>
      {layers.length === 0 ? (
        <div className="rail__empty">No signals yet</div>
      ) : (
        <ul className="sigfilter__list">
          {layers.map(({ kind, label, color, count }) => {
            const state = !filtering ? "" : active.has(kind) ? " is-on" : " is-off";
            return (
              <li className={"sigfilter__row" + state} key={kind}>
                <button
                  type="button"
                  className="sigfilter__toggle"
                  onClick={() => onToggle(kind)}
                  aria-pressed={!filtering || active.has(kind)}
                  title={filtering && !active.has(kind) ? `Show ${label}` : `Toggle ${label}`}
                >
                  <span className="sigfilter__swatch" style={{ background: color }} />
                  <span className="sigfilter__label">{label}</span>
                  <span className="sigfilter__count">{count}</span>
                </button>
                <button
                  type="button"
                  className="sigfilter__solo"
                  onClick={() => onSolo(kind)}
                  title={`Show only ${label}`}
                  aria-label={`Show only ${label}`}
                >
                  only
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sigfilter__modes">
        <label className="sigfilter__mode" title="Also show gear with matching ports that aren't wired yet">
          <input type="checkbox" checked={includeUnwired} onChange={(e) => onIncludeUnwiredChange(e.target.checked)} />
          Include unwired gear
        </label>
        <label className="sigfilter__mode" title="Hide non-matching items instead of fading them">
          <input
            type="checkbox"
            checked={hideNonMatching}
            onChange={(e) => onHideNonMatchingChange(e.target.checked)}
          />
          Hide non-matching
        </label>
      </div>
    </div>
  );
}
