import "./ValidationPanel.css";
import type { ValidationIssue, ValidationResult } from "../validation/validate";

/** Read-only right drawer listing live signal-validation issues. */
export function ValidationPanel({
  result,
  onFocus,
  onClose,
  onAddConverter,
}: {
  result: ValidationResult;
  onFocus: (issue: ValidationIssue) => void;
  onClose: () => void;
  /** One-click fix for a "Converter needed" issue. */
  onAddConverter?: (edgeId: string) => void;
}) {
  const { issues, errorCount, warningCount } = result;

  return (
    <aside className="validation-panel">
      <div className="validation-panel__head">
        <h2>Signal check</h2>
        <button className="validation-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="validation-panel__body">
        {issues.length === 0 ? (
          <p className="validation-ok">✓ All connections look valid.</p>
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
