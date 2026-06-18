import { useEffect, useState } from "react";
import "./ExportMenu.css";

export type ExportKind = "png" | "jpeg" | "pdf" | "csv";

/** Toolbar dropdown for exporting the diagram (image/PDF) or the lists (CSV). */
export function ExportMenu({ onExport }: { onExport: (kind: ExportKind) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const pick = (kind: ExportKind) => {
    setOpen(false);
    onExport(kind);
  };

  return (
    <div className="export-menu" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((v) => !v)} title="Export">
        Export ▾
      </button>
      {open && (
        <div className="export-menu__pop">
          <button type="button" onClick={() => pick("png")}>Diagram — PNG</button>
          <button type="button" onClick={() => pick("jpeg")}>Diagram — JPG</button>
          <button type="button" onClick={() => pick("pdf")}>Diagram — PDF</button>
          <div className="export-menu__sep" />
          <button type="button" onClick={() => pick("csv")}>Lists — CSV</button>
        </div>
      )}
    </div>
  );
}
