import { useState } from "react";
import { CONNECTORS, SIGNAL_KINDS, SIGNAL_META, DEVICE_CATEGORIES } from "../schema";
import type {
  ConnectorId,
  DeviceCategory,
  DeviceModel,
  PortDirection,
  SignalKind,
} from "../schema";
import { BUILTIN_MODELS } from "../library/builtins";
import {
  addToPersonalLibrary,
  loadPersonalLibrary,
  removeFromPersonalLibrary,
} from "../library/personalLibrary";
import "./AddDevicePanel.css";

type Props = {
  onAddModel: (model: DeviceModel) => void;
  onClose: () => void;
};

type PortDraft = {
  key: string;
  name: string;
  direction: PortDirection;
  connector: ConnectorId;
  signal: SignalKind;
};

const CONNECTOR_LIST = Object.values(CONNECTORS);

function newPort(direction: PortDirection): PortDraft {
  const connector = "hdmi";
  return {
    key: crypto.randomUUID(),
    name: "",
    direction,
    connector,
    signal: CONNECTORS[connector]?.signals[0] ?? "av",
  };
}

export function AddDevicePanel({ onAddModel, onClose }: Props) {
  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [category, setCategory] = useState<DeviceCategory>("source");
  const [ports, setPorts] = useState<PortDraft[]>(() => [newPort("output")]);
  const [library, setLibrary] = useState<DeviceModel[]>(() => loadPersonalLibrary());

  function updatePort(key: string, patch: Partial<PortDraft>) {
    setPorts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function setPortConnector(key: string, connector: ConnectorId) {
    // Default the signal to whatever the connector primarily carries.
    updatePort(key, { connector, signal: CONNECTORS[connector]?.signals[0] ?? "av" });
  }

  function addPort() {
    setPorts((ps) => [...ps, newPort(ps.length % 2 === 0 ? "output" : "input")]);
  }

  function buildModel(): DeviceModel {
    return {
      id: crypto.randomUUID(),
      manufacturer: manufacturer.trim() || undefined,
      model: name.trim() || "Untitled Device",
      category,
      source: "custom",
      ports: ports.map((p) => ({
        id: p.key,
        name: p.name.trim() || "Port",
        direction: p.direction,
        connector: p.connector,
        signal: p.signal,
      })),
    };
  }

  function handleAddCustom() {
    const model = buildModel();
    onAddModel(model);
    setLibrary(addToPersonalLibrary(model));
    setName("");
    setManufacturer("");
    setPorts([newPort("output")]);
  }

  return (
    <aside className="add-panel">
      <header className="add-panel__head">
        <h2>Add device</h2>
        <button type="button" className="add-panel__close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

      <div className="add-panel__body">
        <section className="add-panel__section">
          <h3>Library</h3>
          <div className="lib-grid">
            {BUILTIN_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="lib-chip"
                onClick={() => onAddModel(m)}
                title={`${m.ports.length} ports`}
              >
                {m.model}
                <span className="lib-chip__cat">{m.category}</span>
              </button>
            ))}
          </div>

          {library.length > 0 && (
            <>
              <h4 className="add-panel__subhead">Your devices</h4>
              <div className="lib-grid">
                {library.map((m) => (
                  <span key={m.id} className="lib-chip lib-chip--custom">
                    <button type="button" className="lib-chip__add" onClick={() => onAddModel(m)}>
                      {m.model}
                      <span className="lib-chip__cat">{m.category}</span>
                    </button>
                    <button
                      type="button"
                      className="lib-chip__del"
                      onClick={() => setLibrary(removeFromPersonalLibrary(m.id))}
                      aria-label={`Delete ${m.model}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="add-panel__section">
          <h3>Build custom</h3>

          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stage Camera" />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Manufacturer</span>
              <input
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="optional"
              />
            </label>
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as DeviceCategory)}>
                {DEVICE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="ports-head">
            <span>Ports</span>
            <button type="button" className="btn-small" onClick={addPort}>
              + Add port
            </button>
          </div>

          <ul className="ports-list">
            {ports.map((p) => (
              <li key={p.key} className="port-row">
                <div className="port-row__top">
                  <span className="port-row__dot" style={{ background: SIGNAL_META[p.signal].color }} />
                  <input
                    className="port-row__name"
                    value={p.name}
                    onChange={(e) => updatePort(p.key, { name: e.target.value })}
                    placeholder="Port name"
                  />
                  <button
                    type="button"
                    className="port-row__del"
                    onClick={() => setPorts((ps) => ps.filter((x) => x.key !== p.key))}
                    aria-label="Remove port"
                  >
                    ×
                  </button>
                </div>
                <div className="port-row__selects">
                  <select
                    value={p.direction}
                    onChange={(e) => updatePort(p.key, { direction: e.target.value as PortDirection })}
                  >
                    <option value="input">In</option>
                    <option value="output">Out</option>
                    <option value="bidirectional">Both</option>
                  </select>
                  <select value={p.connector} onChange={(e) => setPortConnector(p.key, e.target.value)}>
                    {CONNECTOR_LIST.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={p.signal}
                    onChange={(e) => updatePort(p.key, { signal: e.target.value as SignalKind })}
                  >
                    {SIGNAL_KINDS.map((s) => (
                      <option key={s} value={s}>
                        {SIGNAL_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>

          <button type="button" className="btn-primary" onClick={handleAddCustom}>
            Add to canvas
          </button>
        </section>
      </div>
    </aside>
  );
}
