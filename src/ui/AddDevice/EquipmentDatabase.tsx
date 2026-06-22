import { useMemo, useState } from "react";
import { deviceTitle } from "../../schema";
import type { DeviceModel } from "../../schema";
import {
  compareModels,
  ioSummary,
  matchesQuery,
  sourceBadge,
  typeLabel,
  type SortKey,
} from "./addDevice";
import { SearchIcon, SignalDots, StarButton } from "./bits";

type Props = {
  catalog: DeviceModel[];
  favs: Set<string>;
  onToggleFav: (id: string) => void;
  onPlace: (model: DeviceModel) => void;
  onBack: () => void;
  onCreate: () => void;
  onClose: () => void;
  /** Delete a custom ("Your library") device. */
  onDelete?: (model: DeviceModel) => void;
};

const ALL = "All";

export function EquipmentDatabase({
  catalog,
  favs,
  onToggleFav,
  onPlace,
  onBack,
  onCreate,
  onClose,
  onDelete,
}: Props) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("model");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [fType, setFType] = useState(ALL);
  const [fMfr, setFMfr] = useState(ALL);
  const [fSource, setFSource] = useState(ALL);

  const types = useMemo(
    () => [ALL, ...Array.from(new Set(catalog.map(typeLabel))).sort()],
    [catalog],
  );
  const mfrs = useMemo(
    () => [ALL, ...Array.from(new Set(catalog.map((m) => m.manufacturer ?? "—"))).sort()],
    [catalog],
  );

  const rows = useMemo(() => {
    const filtered = catalog.filter(
      (m) =>
        matchesQuery(m, q) &&
        (fType === ALL || typeLabel(m) === fType) &&
        (fMfr === ALL || (m.manufacturer ?? "—") === fMfr) &&
        (fSource === ALL || m.source === fSource),
    );
    return filtered.sort((a, b) => compareModels(a, b, sortKey, sortDir));
  }, [catalog, q, fType, fMfr, fSource, sortKey, sortDir]);

  const sort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };
  const caret = (key: SortKey) => (key === sortKey ? (sortDir === 1 ? " ↑" : " ↓") : "");

  return (
    <div className="adv-db" role="dialog" aria-label="Equipment database">
      <div className="adv-db__head">
        <button type="button" className="adv-back" onClick={onBack}>
          ‹ Quick search
        </button>
        <h2 className="adv-db__title">Equipment database</h2>
        <div className="adv-db__search">
          <SearchIcon size={15} />
          <input
            className="adv-db__searchinput"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
          />
        </div>
        <select className="adv-facet" value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Filter by type">
          {types.map((t) => (
            <option key={t} value={t}>
              {t === ALL ? "All types" : t}
            </option>
          ))}
        </select>
        <select className="adv-facet" value={fMfr} onChange={(e) => setFMfr(e.target.value)} aria-label="Filter by manufacturer">
          {mfrs.map((m) => (
            <option key={m} value={m}>
              {m === ALL ? "All manufacturers" : m}
            </option>
          ))}
        </select>
        <select className="adv-facet" value={fSource} onChange={(e) => setFSource(e.target.value)} aria-label="Filter by source">
          <option value={ALL}>All sources</option>
          <option value="builtin">Built-in</option>
          <option value="community">Community</option>
          <option value="custom">Your library</option>
        </select>
        <button type="button" className="adv-db__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="adv-grid adv-db__colhead">
        <span />
        <button type="button" className="adv-th" onClick={() => sort("model")}>
          Model{caret("model")}
        </button>
        <button type="button" className="adv-th" onClick={() => sort("mfr")}>
          Manufacturer{caret("mfr")}
        </button>
        <button type="button" className="adv-th" onClick={() => sort("type")}>
          Type{caret("type")}
        </button>
        <span>Ports</span>
        <button type="button" className="adv-th" onClick={() => sort("rack")}>
          Rack{caret("rack")}
        </button>
        <span>Source</span>
        <span />
      </div>

      <div className="adv-db__rows">
        {rows.length === 0 ? (
          <div className="adv-emptynote">No devices match those filters.</div>
        ) : (
          rows.map((m) => {
            const badge = sourceBadge(m.source);
            return (
              <div key={m.id} className="adv-grid adv-db__row">
                <StarButton on={favs.has(m.id)} onToggle={() => onToggleFav(m.id)} />
                <span className="adv-cell-model" title={deviceTitle(m)}>
                  {deviceTitle(m)}
                </span>
                <span className="adv-cell-muted">{m.manufacturer ?? "—"}</span>
                <span>
                  <span className="adv-typepill">{typeLabel(m)}</span>
                </span>
                <span className="adv-cell-ports">
                  <span className="adv-cell-muted">{ioSummary(m)}</span>
                  <SignalDots model={m} size={7} />
                </span>
                <span className="adv-cell-muted">{m.rackUnits ? `${m.rackUnits} RU` : "—"}</span>
                <span>
                  <span className={`adv-srcbadge ${badge.cls}`}>{badge.label}</span>
                </span>
                <span className="adv-rowactions">
                  {m.source === "custom" && onDelete && (
                    <button
                      type="button"
                      className="adv-delbtn"
                      onClick={() => onDelete(m)}
                      title="Delete from your library"
                      aria-label={`Delete ${deviceTitle(m)} from your library`}
                    >
                      Delete
                    </button>
                  )}
                  <button type="button" className="adv-addbtn" onClick={() => onPlace(m)}>
                    Add
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="adv-db__footer">
        <span>
          Showing {rows.length} of {catalog.length}
        </span>
        <button type="button" className="adv-new" onClick={onCreate}>
          ＋ Create a new device
        </button>
      </div>
    </div>
  );
}
