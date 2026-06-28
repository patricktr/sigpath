import "./ValidationPanel.css";
import { VIDEO_FORMATS } from "../schema";
import type { ValidationIssue, ValidationResult } from "../validation/validate";
import type { DeepGradeGroup } from "../validation/deepGrade";

/** Read-only right drawer listing live signal-validation issues. */
export function ValidationPanel({
  result,
  videoFormat,
  onSetVideoFormat,
  onFocus,
  onClose,
  onAddConverter,
  deepGroups = [],
  onDeepJump,
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
  /** Grade issues found INSIDE embedded rooms (p2-deepgrade), grouped by room. */
  deepGroups?: DeepGradeGroup[];
  /** Jump to an inner-room issue: switch to that tab and select the cable. */
  onDeepJump?: (roomId: string, issue: ValidationIssue) => void;
}) {
  const { issues, errorCount, warningCount, needsShowFormat } = result;
  const deepCount = deepGroups.reduce((n, g) => n + g.issues.length, 0);
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
        {issues.length === 0 && deepCount === 0 ? (
          needsShowFormat ? null : <p className="validation-ok">✓ All connections look valid.</p>
        ) : issues.length === 0 ? null : (
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

        {deepGroups.map((g) => (
          <div key={g.roomId} style={{ marginTop: 14 }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, opacity: 0.7 }}>
              Inside <strong>{g.roomName}</strong>
            </p>
            <ul className="validation-list">
              {g.issues.map((iss) => (
                <li key={iss.id}>
                  <button
                    type="button"
                    className="validation-item validation-item--error"
                    onClick={() => onDeepJump?.(g.roomId, iss)}
                    title={`Open ${g.roomName} and select this cable`}
                  >
                    <span className="validation-item__icon">✕</span>
                    <span className="validation-item__text">
                      <span className="validation-item__title">{iss.title}</span>
                      <span className="validation-item__detail">{iss.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}
