import { cableLabel } from "../schema";
import type { BomRules, SpareRule } from "../schema";
import { SpareRuleEditor } from "./SpareRuleEditor";

/**
 * Editor for a project's {@link BomRules} (p3-bomrules) — the default spare policy
 * plus per-connector overrides. `connectors` are the cable types available to
 * override (the ones actually used in the project).
 */
export function BomRulesEditor({
  rules,
  onChange,
  connectors,
}: {
  rules: BomRules;
  onChange: (rules: BomRules) => void;
  connectors: string[];
}) {
  const byType = rules.byType ?? {};
  const overridden = Object.keys(byType);
  const available = connectors.filter((c) => !overridden.includes(c)).sort((a, b) => cableLabel(a).localeCompare(cableLabel(b)));

  const setOverride = (conn: string, rule: SpareRule) =>
    onChange({ ...rules, byType: { ...byType, [conn]: rule } });
  const removeOverride = (conn: string) => {
    const next = { ...byType };
    delete next[conn];
    onChange({ ...rules, byType: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className="bom-rules">
      <div className="bom-rules__label">Default · all cables</div>
      <SpareRuleEditor rule={rules.default} onChange={(rule) => onChange({ ...rules, default: rule })} />

      {overridden.map((conn) => (
        <div className="bom-rules__override" key={conn}>
          <div className="bom-rules__override-head">
            <span className="bom-rules__label">{cableLabel(conn)}</span>
            <button type="button" className="pref-row__clear" onClick={() => removeOverride(conn)}>
              Remove
            </button>
          </div>
          <SpareRuleEditor rule={byType[conn]} onChange={(rule) => setOverride(conn, rule)} />
        </div>
      ))}

      {available.length > 0 && (
        <select
          className="bom-rules__add"
          value=""
          onChange={(e) => {
            if (e.target.value) setOverride(e.target.value, rules.default);
          }}
        >
          <option value="">+ Override a cable type…</option>
          {available.map((c) => (
            <option key={c} value={c}>
              {cableLabel(c)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
