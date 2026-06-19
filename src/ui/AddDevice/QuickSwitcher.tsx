import { useEffect, useMemo, useRef, useState } from "react";
import { deviceTitle } from "../../schema";
import type { DeviceModel } from "../../schema";
import { ioSummary, matchesQuery, typeLabel } from "./addDevice";
import { SearchIcon, SignalDots, StarButton } from "./bits";

type Props = {
  catalog: DeviceModel[];
  favs: Set<string>;
  recents: string[];
  onToggleFav: (id: string) => void;
  onPlace: (model: DeviceModel) => void;
  onBrowse: () => void;
  onCreate: () => void;
  onClose: () => void;
};

const RESULT_CAP = 7;

export function QuickSwitcher({
  catalog,
  favs,
  recents,
  onToggleFav,
  onPlace,
  onBrowse,
  onCreate,
  onClose,
}: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const byId = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);
  const favModels = useMemo(() => catalog.filter((m) => favs.has(m.id)), [catalog, favs]);
  const recentModels = useMemo(
    () => recents.map((id) => byId.get(id)).filter((m): m is DeviceModel => Boolean(m)),
    [recents, byId],
  );
  const results = useMemo(
    () => catalog.filter((m) => matchesQuery(m, q)).slice(0, RESULT_CAP),
    [catalog, q],
  );

  const hasQuery = q.trim() !== "";
  // Flat list the arrow keys traverse (favorites then recents, or the results).
  const navList = hasQuery ? results : [...favModels, ...recentModels];

  useEffect(() => {
    setActive(0);
  }, [q]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (navList.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % navList.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + navList.length) % navList.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = navList[active];
      if (m) onPlace(m);
    }
  };

  let rowIndex = -1;
  const Row = (m: DeviceModel) => {
    rowIndex += 1;
    const isActive = rowIndex === active;
    return (
      <button
        key={m.id}
        type="button"
        className={isActive ? "adv-row adv-row--active" : "adv-row"}
        onClick={() => onPlace(m)}
        onMouseEnter={() => setActive(navList.indexOf(m))}
      >
        <StarButton on={favs.has(m.id)} onToggle={() => onToggleFav(m.id)} />
        <span className="adv-row__text">
          <span className="adv-row__title">{deviceTitle(m)}</span>
          <span className="adv-row__sub">
            {typeLabel(m)} · {ioSummary(m)}
          </span>
        </span>
        <SignalDots model={m} />
      </button>
    );
  };

  return (
    <div className="adv-palette" role="dialog" aria-label="Quick add device" onKeyDown={onKeyDown}>
      <div className="adv-search">
        <SearchIcon />
        <input
          ref={inputRef}
          className="adv-search__input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search devices by name or manufacturer…"
        />
        <button type="button" className="adv-chip adv-chip--btn" onClick={onClose}>
          esc
        </button>
      </div>

      <div className="adv-palette__body">
        {!hasQuery ? (
          <>
            {favModels.length > 0 && <div className="adv-seclabel">★ Favorites</div>}
            {favModels.map(Row)}
            {recentModels.length > 0 && <div className="adv-seclabel">Recent</div>}
            {recentModels.map(Row)}
            {favModels.length === 0 && recentModels.length === 0 && (
              <div className="adv-emptynote">
                Start typing to search {catalog.length} devices, or browse the full catalog below.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="adv-seclabel">
              {results.length} result{results.length === 1 ? "" : "s"}
            </div>
            {results.length === 0 ? (
              <div className="adv-emptynote">No devices match “{q}”.</div>
            ) : (
              results.map(Row)
            )}
          </>
        )}
      </div>

      <div className="adv-palette__footer">
        <div className="adv-hint">↑↓ navigate &nbsp;&nbsp; ↵ add to canvas</div>
        <div className="adv-escalate">
          <button type="button" className="adv-browse" onClick={onBrowse}>
            Browse full catalog <span className="adv-arrow">→</span>
            <span className="adv-chip">⌘⇧K</span>
          </button>
          <button type="button" className="adv-new" onClick={onCreate}>
            ＋ New device
          </button>
        </div>
      </div>
    </div>
  );
}
