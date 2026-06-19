import { useCallback, useEffect, useState } from "react";
import type { DeviceModel } from "../../schema";
import { loadCatalog, type AddSurface } from "./addDevice";
import { loadFavorites, loadRecents, pushRecent, saveFavorites } from "../../library/userPrefs";
import { QuickSwitcher } from "./QuickSwitcher";
import { EquipmentDatabase } from "./EquipmentDatabase";
import { CreateWizard } from "./CreateWizard";
import "./AddDevice.css";

type Props = {
  surface: Exclude<AddSurface, "none">;
  onSurface: (s: Exclude<AddSurface, "none">) => void;
  onPlace: (model: DeviceModel) => void;
  onClose: () => void;
};

/**
 * Controller for the Add-Device flow: holds the catalog + favorites, renders the
 * active surface (Quick Switcher / Equipment Database / Create Wizard) over a
 * scrim, and routes Esc / scrim clicks (wizard steps back to the browser, the
 * others close).
 */
export function AddDeviceOverlay({ surface, onSurface, onPlace, onClose }: Props) {
  const [catalog, setCatalog] = useState<DeviceModel[]>(() => loadCatalog());
  const [favs, setFavs] = useState<Set<string>>(() => loadFavorites());
  const [recents] = useState<string[]>(() => loadRecents());

  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const place = useCallback(
    (m: DeviceModel) => {
      pushRecent(m.id);
      onPlace(m);
    },
    [onPlace],
  );

  const refreshCatalog = useCallback(() => setCatalog(loadCatalog()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (surface === "wizard") onSurface("browser");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [surface, onSurface, onClose]);

  const onScrim = () => (surface === "wizard" ? onSurface("browser") : onClose());

  return (
    <div className="adv-scrim" onMouseDown={onScrim}>
      <div className="adv-stop" onMouseDown={(e) => e.stopPropagation()}>
        {surface === "palette" && (
          <QuickSwitcher
            catalog={catalog}
            favs={favs}
            recents={recents}
            onToggleFav={toggleFav}
            onPlace={place}
            onBrowse={() => onSurface("browser")}
            onCreate={() => onSurface("wizard")}
            onClose={onClose}
          />
        )}
        {surface === "browser" && (
          <EquipmentDatabase
            catalog={catalog}
            favs={favs}
            onToggleFav={toggleFav}
            onPlace={place}
            onBack={() => onSurface("palette")}
            onCreate={() => onSurface("wizard")}
            onClose={onClose}
          />
        )}
        {surface === "wizard" && (
          <CreateWizard
            onCancel={() => onSurface("browser")}
            onSaved={refreshCatalog}
            onPlace={place}
          />
        )}
      </div>
    </div>
  );
}
