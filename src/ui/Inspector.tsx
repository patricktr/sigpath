import { cableColor, deviceTitle, getConnector, gradeLabel, gradesForScale, gradeScaleForConnector } from "../schema";
import type { DeviceModel, GradeId } from "../schema";

const DIR_LABEL: Record<string, string> = { input: "IN", output: "OUT", bidirectional: "I/O" };

/** Right inspector: details + ports of the selected device. */
export function Inspector({
  model,
  label,
  nodeId,
  signalPins,
  onSetPin,
}: {
  model: DeviceModel | null;
  label?: string;
  /** Selected device-instance id, for per-output-port signal caps (p2-deepgrade). */
  nodeId?: string;
  /** Current per-output-port caps, keyed by Port.id. */
  signalPins?: Record<string, GradeId>;
  /** Set/clear "this output emits at most X" (propagates downstream in grade validation). */
  onSetPin?: (nodeId: string, portId: string, grade: GradeId | undefined) => void;
}) {
  if (!model) {
    return (
      <aside className="inspector">
        <div className="inspector__label">Inspector</div>
        <div className="inspector__empty">Select a device to inspect its ports.</div>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <div className="inspector__label">Inspector</div>
      <div className="inspector__name">{deviceTitle(model, label)}</div>
      <div className="inspector__sub">
        {model.manufacturer ?? "—"} · {model.type ?? model.category}
      </div>

      <div className="inspector__tiles">
        <div className="inspector__tile">
          <span className="inspector__tilelabel">Rack U</span>
          <span className="inspector__tileval">{model.rackUnits ?? "—"}</span>
        </div>
        <div className="inspector__tile">
          <span className="inspector__tilelabel">Ports</span>
          <span className="inspector__tileval">{model.ports.length}</span>
        </div>
      </div>

      <div className="inspector__label">Ports</div>
      <ul className="inspector__ports">
        {model.ports.map((p) => {
          const scale = gradeScaleForConnector(p.connector);
          const canPin = !!onSetPin && !!nodeId && p.direction !== "input" && !!scale;
          return (
            <li className="inspector__port" key={p.id}>
              <span className="inspector__dot" style={{ background: cableColor(p.connector) }} />
              <span className="inspector__pname">{p.name}</span>
              <span className="inspector__pmeta">
                {DIR_LABEL[p.direction]} · {getConnector(p.connector)?.label ?? p.connector}
                {p.grade ? ` · ${gradeLabel(p.grade)}` : ""}
              </span>
              {canPin && (
                <select
                  className="inspector__pin"
                  value={signalPins?.[p.id] ?? ""}
                  onChange={(e) => onSetPin!(nodeId!, p.id, e.target.value || undefined)}
                  title="Cap the signal this output emits — propagates downstream so a known-lower feed isn't graded against the show format"
                  aria-label={`Signal cap for ${p.name}`}
                >
                  <option value="">emits up to show format</option>
                  {gradesForScale(scale).map((t) => (
                    <option key={t.id} value={t.id}>
                      emits at most {t.label}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
