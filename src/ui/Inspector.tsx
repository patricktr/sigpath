import { cableColor, deviceTitle, getConnector, gradeLabel } from "../schema";
import type { DeviceModel } from "../schema";

const DIR_LABEL: Record<string, string> = { input: "IN", output: "OUT", bidirectional: "I/O" };

/** Right inspector: details + ports of the selected device. */
export function Inspector({ model, label }: { model: DeviceModel | null; label?: string }) {
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
        {model.ports.map((p) => (
          <li className="inspector__port" key={p.id}>
            <span className="inspector__dot" style={{ background: cableColor(p.connector) }} />
            <span className="inspector__pname">{p.name}</span>
            <span className="inspector__pmeta">
              {DIR_LABEL[p.direction]} · {getConnector(p.connector)?.label ?? p.connector}
              {p.grade ? ` · ${gradeLabel(p.grade)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
