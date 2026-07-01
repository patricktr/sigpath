import type { SpareRule } from "../schema";

/** Editor for one {@link SpareRule} (p3-bomrules) — the project default or a per-type override. */
export function SpareRuleEditor({
  rule,
  onChange,
}: {
  rule: SpareRule;
  onChange: (rule: SpareRule) => void;
}) {
  const set = (patch: Partial<SpareRule>) => onChange({ ...rule, ...patch });
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  const fields: { key: keyof SpareRule; label: string; title: string }[] = [
    { key: "minSpares", label: "Min", title: "At least this many spares per line" },
    { key: "flatSpares", label: "+K flat", title: "Add a fixed number of spares per line" },
    { key: "ratioPerN", label: "+1 per N", title: "One extra spare per N units (0 = off)" },
    { key: "percent", label: "+ %", title: "Percentage overage, rounded up (0 = off)" },
  ];

  return (
    <div className="spare-rule">
      <label className="spare-rule__check" title="Round each run up to the nearest stock length">
        <input
          type="checkbox"
          checked={rule.roundToStock}
          onChange={(e) => set({ roundToStock: e.target.checked })}
        />
        Round runs up to stock length
      </label>
      <div className="spare-rule__grid">
        {fields.map((f) => (
          <label key={f.key} className="spare-rule__field" title={f.title}>
            <span>{f.label}</span>
            <input
              type="number"
              min={0}
              value={rule[f.key] as number}
              onChange={(e) => set({ [f.key]: num(e.target.value) } as Partial<SpareRule>)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
