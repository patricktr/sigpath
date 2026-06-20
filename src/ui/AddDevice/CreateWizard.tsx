import { useMemo, useState } from "react";
import {
  DEVICE_TYPES,
  cableColor,
  categoryForType,
  deviceContentHash,
  deviceTitle,
  inputPorts,
  outputPorts,
  bidirectionalPorts,
} from "../../schema";
import type { ConnectorId, DeviceModel, PortDirection } from "../../schema";
import { addToPersonalLibrary } from "../../library/personalLibrary";
import { ConnectorPicker } from "./ConnectorPicker";
import "./AddDevice.css";

type Props = {
  onCancel: () => void;
  onSaved: (model: DeviceModel) => void;
  onPlace: (model: DeviceModel) => void;
  /** When set, the wizard edits this device instead of creating a new one. */
  initial?: DeviceModel;
  /** Edit-mode save handler (receives the edited model). */
  onSave?: (model: DeviceModel) => void;
};

type PortDraft = {
  id: string;
  name: string;
  direction: PortDirection;
  connector: ConnectorId;
  /** Combo jack: additional connectors this one port also accepts. */
  accepts: ConnectorId[];
  /** Generate this many numbered copies of the port (e.g. SDI In 1…20). */
  qty: number;
};

const STEPS = ["Identity", "Ports & I/O", "Review"] as const;

function newPort(direction: PortDirection): PortDraft {
  return { id: crypto.randomUUID(), name: "", direction, connector: "hdmi", accepts: [], qty: 1 };
}

/** Static echo of DeviceNode for the live review preview (no React Flow handles). */
function DeviceNodePreview({ model }: { model: DeviceModel }) {
  const inputs = inputPorts(model);
  const outputs = outputPorts(model);
  const bidi = bidirectionalPorts(model);
  return (
    <div className="adv-pnode">
      <div className="adv-pnode__head">
        <span className="adv-pnode__name">{deviceTitle(model)}</span>
        <span className="adv-pnode__type">{model.type ?? model.category}</span>
      </div>
      <div className="adv-pnode__body">
        <ul className="adv-pcol adv-pcol--in">
          {inputs.map((p) => (
            <li className="adv-pport" key={p.id}>
              <span className="adv-pdot" style={{ background: cableColor(p.connector) }} />
              <span className="adv-plabel">{p.name}</span>
            </li>
          ))}
        </ul>
        <ul className="adv-pcol adv-pcol--out">
          {outputs.map((p) => (
            <li className="adv-pport" key={p.id}>
              <span className="adv-plabel">{p.name}</span>
              <span className="adv-pdot" style={{ background: cableColor(p.connector) }} />
            </li>
          ))}
        </ul>
        {bidi.length > 0 && (
          <ul
            className="adv-pcol"
            style={{
              flexBasis: "100%",
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "4px 10px",
              borderTop: "1px dashed var(--line)",
              paddingTop: 6,
              marginTop: 2,
            }}
          >
            {bidi.map((p) => (
              <li className="adv-pport" key={p.id} style={{ gap: 5 }}>
                <span className="adv-pdot" style={{ background: cableColor(p.connector) }} />
                <span className="adv-plabel">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
        {inputs.length === 0 && outputs.length === 0 && bidi.length === 0 && (
          <span className="adv-pnode__empty">No ports yet</span>
        )}
      </div>
    </div>
  );
}

export function CreateWizard({ onCancel, onSaved, onPlace, initial, onSave }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [type, setType] = useState<string>(initial?.type ?? DEVICE_TYPES[0]);
  const [rackUnits, setRackUnits] = useState(
    initial?.rackUnits != null ? String(initial.rackUnits) : "",
  );
  const [ports, setPorts] = useState<PortDraft[]>(() =>
    initial
      ? initial.ports.map((p) => ({
          id: p.id,
          name: p.name,
          direction: p.direction,
          connector: p.connector,
          accepts: p.accepts ?? [],
          qty: 1,
        }))
      : [newPort("output")],
  );

  const updatePort = (id: string, patch: Partial<PortDraft>) =>
    setPorts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const draftModel: DeviceModel = useMemo(
    () => ({
      id: "draft",
      manufacturer: manufacturer.trim() || undefined,
      model: model.trim() || "Untitled device",
      category: categoryForType(type),
      type,
      source: "custom",
      rackUnits: rackUnits ? Number(rackUnits) : undefined,
      ports: ports.flatMap((p) => {
        const n = Math.max(1, Math.floor(p.qty) || 1);
        const base = p.name.trim() || "Port";
        return Array.from({ length: n }, (_, i) => ({
          id: n > 1 ? `${p.id}-${i + 1}` : p.id,
          name: n > 1 ? `${base} ${i + 1}` : base,
          direction: p.direction,
          connector: p.connector,
          ...(p.accepts.length ? { accepts: p.accepts } : {}),
        }));
      }),
    }),
    [manufacturer, model, type, rackUnits, ports],
  );

  const canSave = model.trim().length > 0;

  const buildModel = (): DeviceModel => ({ ...draftModel, id: crypto.randomUUID() });

  const saveToLibrary = () => {
    const m = buildModel();
    addToPersonalLibrary(m);
    onSaved(m);
    onCancel(); // back to the browser, where it now appears
  };

  const finish = () => {
    const m = buildModel();
    addToPersonalLibrary(m);
    onSaved(m);
    onPlace(m); // places + closes the overlay
  };

  // Edit mode: rebuild preserving identity. A custom device edits in place (same
  // id); editing a community/built-in forks a personal copy stamped with provenance.
  const commitEdit = () => {
    if (!initial) return;
    const edited: DeviceModel =
      initial.source === "custom"
        ? { ...draftModel, id: initial.id, forkedFrom: initial.forkedFrom }
        : {
            ...draftModel,
            id: crypto.randomUUID(),
            forkedFrom: {
              id: initial.id,
              baseRev: initial.rev,
              baseHash: initial.contentHash ?? deviceContentHash(initial),
            },
          };
    onSave?.(edited);
  };

  return (
    <div className="adv-wizard" role="dialog" aria-label="Create a new device">
      <div className="adv-wizard__head">
        <h2 className="adv-wizard__title">
          {initial ? "Edit device" : "New device"}{" "}
          <span className="adv-wizard__sub">
            · {initial ? deviceTitle(initial) : "add to catalog"}
          </span>
        </h2>
        <button type="button" className="adv-db__close" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>

      <div className="adv-stepper">
        {STEPS.map((label, i) => {
          const state = i === step ? "active" : i < step ? "done" : "upcoming";
          return (
            <button
              key={label}
              type="button"
              className="adv-step"
              onClick={() => setStep(i as 0 | 1 | 2)}
            >
              <span className={`adv-step__num adv-step__num--${state}`}>{i + 1}</span>
              <span className="adv-step__label">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="adv-wizard__body">
        {step === 0 && (
          <div className="adv-form">
            <div className="adv-form__row">
              <label className="adv-field">
                <span>Manufacturer</span>
                <input
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="e.g. Extron"
                />
              </label>
              <label className="adv-field">
                <span>Model name</span>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. DXP 84 HD"
                  autoFocus
                />
              </label>
            </div>
            <div className="adv-form__row">
              <label className="adv-field">
                <span>Type</span>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="adv-field">
                <span>Rack units</span>
                <input
                  type="number"
                  min={0}
                  value={rackUnits}
                  onChange={(e) => setRackUnits(e.target.value)}
                  placeholder="optional"
                />
              </label>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="adv-ports">
            <p className="adv-ports__help">
              Add the device’s inputs and outputs — pick the connector (port type) for each. Set a
              quantity to generate numbered copies (e.g. “SDI In” × 20 → SDI In 1–20).
            </p>
            {ports.map((p) => (
              <div className="adv-portrow" key={p.id}>
                <span className="adv-portdot" style={{ background: cableColor(p.connector) }} />
                <input
                  className="adv-portrow__name"
                  value={p.name}
                  onChange={(e) => updatePort(p.id, { name: e.target.value })}
                  placeholder="Port name"
                />
                <select
                  value={p.direction}
                  onChange={(e) => updatePort(p.id, { direction: e.target.value as PortDirection })}
                >
                  <option value="input">In</option>
                  <option value="output">Out</option>
                  <option value="bidirectional">Both</option>
                </select>
                <ConnectorPicker
                  value={p.connector}
                  direction={p.direction}
                  ariaLabel="Connector (port type)"
                  onChange={(id) => updatePort(p.id, { connector: id || p.connector })}
                />
                <ConnectorPicker
                  className="cxp-root--sec"
                  value={p.accepts[0] ?? ""}
                  direction={p.direction}
                  exclude={p.connector}
                  allowEmpty
                  placeholder="+ combo"
                  ariaLabel="Combo jack — also accepts this connector"
                  onChange={(id) => updatePort(p.id, { accepts: id ? [id] : [] })}
                />
                <label className="adv-portrow__qty" title="Quantity — generates numbered copies">
                  ×
                  <input
                    type="number"
                    min={1}
                    value={p.qty}
                    onChange={(e) =>
                      updatePort(p.id, { qty: Math.max(1, Number(e.target.value) || 1) })
                    }
                    aria-label="Quantity"
                  />
                </label>
                <button
                  type="button"
                  className="adv-portrow__del"
                  onClick={() => setPorts((ps) => ps.filter((x) => x.id !== p.id))}
                  aria-label="Remove port"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="adv-ports__add">
              <button type="button" onClick={() => setPorts((ps) => [...ps, newPort("input")])}>
                ＋ Input
              </button>
              <button type="button" onClick={() => setPorts((ps) => [...ps, newPort("output")])}>
                ＋ Output
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="adv-review">
            <DeviceNodePreview model={draftModel} />
            <div className="adv-review__copy">
              <h3>{initial ? "Save your changes" : "Ready to save"}</h3>
              <p>
                {initial ? (
                  <>
                    Changes to “{deviceTitle(draftModel)}” will update{" "}
                    {initial.source === "custom" ? "this device" : "your personal copy of it"} and
                    its placement on the canvas.
                  </>
                ) : (
                  <>
                    “{deviceTitle(draftModel)}” will be added to your personal library
                    {draftModel.rackUnits ? ` (${draftModel.rackUnits} RU)` : ""} and placed on the
                    canvas. You can reuse it from Quick add or the catalog anytime.
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="adv-wizard__foot">
        <button
          type="button"
          className="adv-btn-ghost"
          onClick={() => (step === 0 ? onCancel() : setStep((s) => (s - 1) as 0 | 1 | 2))}
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
        <div className="adv-wizard__foot-right">
          {initial ? (
            <>
              {step < 2 && (
                <button
                  type="button"
                  className="adv-btn-soft"
                  onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2)}
                >
                  Continue
                </button>
              )}
              <button
                type="button"
                className="adv-btn-primary"
                onClick={commitEdit}
                disabled={!canSave}
              >
                Save changes
              </button>
            </>
          ) : (
            <>
              <button type="button" className="adv-btn-soft" onClick={saveToLibrary} disabled={!canSave}>
                Save to catalog
              </button>
              {step < 2 ? (
                <button
                  type="button"
                  className="adv-btn-primary"
                  onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2)}
                >
                  Continue
                </button>
              ) : (
                <button type="button" className="adv-btn-primary" onClick={finish} disabled={!canSave}>
                  Save &amp; add to canvas
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
