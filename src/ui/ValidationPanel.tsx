import "./ValidationPanel.css";
import { VIDEO_FORMATS } from "../schema";
import type { ValidationIssue, ValidationResult } from "../validation/validate";

/** Read-only right drawer listing live signal-validation issues. */
export function ValidationPanel({
  result,
  videoFormat,
  onSetVideoFormat,
  onFocus,
  onClose,
  onAddConverter,
}: {
  result: ValidationResult;
  /** Current project show format (drives grade demand). */
  videoFormat?: string;
  /** Set/clear the project show format. */
  onSetVideoFormat?: (format: string | undefined) => void;
  onFocus: (issue: ValidationIssue) => void;
  onClose: () => void;
  /** One-click fix for a "Converter needed" issue. */
  onAddConverter?: (edgeId: string) => void;
}) {
  const { issues, errorCount, warningCount, needsShowFormat } = result;
  // Show the format control when it's needed (graded gear, unset) or already in use.
  const showFormatRow = !!onSetVideoFormat && (needsShowFormat || !!videoFormat);

  return (
    <aside className="validation-panel">
      <div className="validation-panel__head">
        <h2>Signal check</h2>
        <button className="validation-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="validation-panel__body">
        {showFormatRow && (
          <div
            className={`validation-format${needsShowFormat ? " validation-format--prompt" : ""}`}
          >
            <div className="validation-format__row">
              <label className="validation-format__label" htmlFor="show-format">
                Show format
              </label>
              <select
                id="show-format"
                className="validation-format__select"
                value={videoFormat ?? ""}
                onChange={(e) => onSetVideoFormat?.(e.target.value || undefined)}
              >
                <option value="">— not set —</option>
                {VIDEO_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            {needsShowFormat && (
              <p className="validation-format__hint">
                Pick a show format so sigpath can check signal grades — it can’t tell a 3G
                cable from a 12G one until it knows what the show runs at.
              </p>
            )}
          </div>
        )}
        {issues.length === 0 ? (
          needsShowFormat ? null : <p className="validation-ok">✓ All connections look valid.</p>
        ) : (
          <>
            <p className="validation-summary">
              {errorCount > 0 && (
                <span className="sev sev--error">
                  {errorCount} error{errorCount === 1 ? "" : "s"}
                </span>
              )}
              {warningCount > 0 && (
                <span className="sev sev--warn">
                  {warningCount} warning{warningCount === 1 ? "" : "s"}
                </span>
              )}
            </p>
            <ul className="validation-list">
              {issues.map((iss) => (
                <li key={iss.id}>
                  <button
                    type="button"
                    className={`validation-item validation-item--${iss.severity}`}
                    onClick={() => onFocus(iss)}
                    title="Jump to this connection"
                  >
                    <span className="validation-item__icon">
                      {iss.severity === "error" ? "✕" : "⚠"}
                    </span>
                    <span className="validation-item__text">
                      <span className="validation-item__title">{iss.title}</span>
                      <span className="validation-item__detail">{iss.detail}</span>
                    </span>
                  </button>
                  {iss.action?.type === "add-converter" && onAddConverter && (
                    <button
                      type="button"
                      className="validation-item__fix"
                      onClick={() => onAddConverter(iss.action!.edgeId)}
                    >
                      ＋ Add converter
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
