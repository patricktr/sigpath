import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { DerivedLists } from "../lists/derive";
import { distanceSuffix, fromMeters, type DistanceUnit } from "../units";

/**
 * Rich BOM + cable-schedule documents (p3-cableschedule). Every format — PDF,
 * XLSX, and clipboard TSV — is a pure view over one {@link DerivedLists}, built
 * from the same row helpers so the on-screen Lists panel, the CSV, and these all
 * agree. Lengths follow the user's distance unit (stored meters → chosen unit).
 */
export type DocOpts = { projectName: string; unit: DistanceUnit; date?: string };

/** BOM/schedule export formats offered in the Lists panel's "Export ▾" menu. */
export type ExportFormat = "pdf" | "xlsx" | "csv" | "clipboard";

type Section = { title: string; head: string[]; rows: (string | number)[][] };

/** Equipment BOM — quantity × model. */
function equipmentSection(lists: DerivedLists): Section {
  return {
    title: "Equipment",
    head: ["Qty", "Manufacturer / Model"],
    rows: lists.devices.map((d) => [d.count, d.name]),
  };
}

/** Bulk cables — quantity per cable type, plus total run length where recorded. */
function cablesSection(lists: DerivedLists, unit: DistanceUnit): Section {
  return {
    title: "Cables",
    head: ["Qty", "Cable", `Total length (${distanceSuffix(unit)})`],
    rows: lists.cables.map((c) => [
      c.count,
      c.label,
      c.lengthMeters != null ? fromMeters(c.lengthMeters, unit) : "",
    ]),
  };
}

/** Adapters, converters, and device PSUs. */
function adaptersSection(lists: DerivedLists): Section {
  const kindLabel = { adapter: "Adapter", converter: "Converter", psu: "PSU" } as const;
  return {
    title: "Adapters & PSUs",
    head: ["Qty", "Item", "Kind"],
    rows: lists.adapters.map((a) => [a.count, a.label, kindLabel[a.kind]]),
  };
}

/** The port-to-port cable schedule. */
function scheduleSection(lists: DerivedLists, unit: DistanceUnit): Section {
  return {
    title: "Cable schedule",
    head: ["ID", "From", "Port", "A-end", "To", "Port", "B-end", "Cable", `Length (${distanceSuffix(unit)})`, "Note"],
    rows: lists.patches.map((p) => [
      p.cableId,
      p.fromDevice,
      p.fromPort,
      p.fromConnector,
      p.toDevice,
      p.toPort,
      p.toConnector,
      p.cableType,
      p.length != null ? fromMeters(p.length, unit) : "",
      p.note ?? "",
    ]),
  };
}

/** All sections that have at least one row, in document order. */
function sections(lists: DerivedLists, unit: DistanceUnit): Section[] {
  return [
    equipmentSection(lists),
    cablesSection(lists, unit),
    adaptersSection(lists),
    scheduleSection(lists, unit),
  ].filter((s) => s.rows.length > 0);
}

function assertNonEmpty(lists: DerivedLists): void {
  if (lists.devices.length === 0 && lists.patches.length === 0) {
    throw new Error("Nothing to export");
  }
}

/** BOM + cable schedule as a paginated US-Letter PDF, base64-encoded for the Rust writer. */
export function listsToPdfBase64(lists: DerivedLists, opts: DocOpts): string {
  assertNonEmpty(lists);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const margin = 40;
  doc.setFontSize(16);
  doc.text(opts.projectName || "Untitled", margin, 44);
  doc.setFontSize(10);
  doc.setTextColor(120);
  const sub = ["Cable schedule + BOM", opts.date].filter(Boolean).join("  ·  ");
  doc.text(sub, margin, 60);
  doc.setTextColor(0);

  let y = 78;
  for (const s of sections(lists, opts.unit)) {
    doc.setFontSize(12);
    doc.text(s.title, margin, y);
    autoTable(doc, {
      startY: y + 6,
      head: [s.head],
      body: s.rows.map((r) => r.map((c) => String(c))),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      theme: "striped",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }
  return arrayBufferToBase64(doc.output("arraybuffer"));
}

/** BOM + cable schedule as a multi-sheet XLSX workbook, base64-encoded. Lazy-loads SheetJS. */
export async function listsToXlsxBase64(lists: DerivedLists, opts: DocOpts): Promise<string> {
  assertNonEmpty(lists);
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sections(lists, opts.unit)) {
    const ws = XLSX.utils.aoa_to_sheet([s.head, ...s.rows]);
    // Sheet names cap at 31 chars and can't contain []:*?/\ — our titles are safe.
    XLSX.utils.book_append_sheet(wb, ws, s.title.slice(0, 31));
  }
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}

/** The cable schedule as TSV, for pasting straight into Sheets/Excel. */
export function scheduleToTsv(lists: DerivedLists, unit: DistanceUnit): string {
  const s = scheduleSection(lists, unit);
  return [s.head, ...s.rows].map((r) => r.map((c) => String(c)).join("\t")).join("\n");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
