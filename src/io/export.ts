import { toPng, toJpeg } from "html-to-image";
import { getNodesBounds, getViewportForBounds } from "@xyflow/react";
import type { ReactFlowInstance } from "@xyflow/react";
import { jsPDF } from "jspdf";
import type { CableEdgeType, SigNode } from "../flow/types";
import type { DerivedLists } from "../lists/derive";

type Rf = ReactFlowInstance<SigNode, CableEdgeType>;

/** Render the whole graph (not just the visible viewport) to a data URL. */
async function renderDiagram(rf: Rf, format: "png" | "jpeg", dark: boolean): Promise<string> {
  const nodes = rf.getNodes();
  if (nodes.length === 0) throw new Error("Nothing to export");

  const bounds = getNodesBounds(nodes);
  const pad = 60;
  const width = Math.round(bounds.width) + pad * 2;
  const height = Math.round(bounds.height) + pad * 2;
  const vp = getViewportForBounds(bounds, width, height, 0.2, 4, 0.1);

  const el = document.querySelector(".react-flow__viewport") as HTMLElement | null;
  if (!el) throw new Error("Canvas not found");

  const options = {
    backgroundColor: dark ? "#0b1120" : "#ffffff",
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
  };
  return format === "png" ? toPng(el, options) : toJpeg(el, { ...options, quality: 0.92 });
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1] ?? "";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** PNG/JPG of the whole diagram, base64-encoded for the Rust writer. */
export async function diagramImageBase64(rf: Rf, format: "png" | "jpeg", dark: boolean): Promise<string> {
  return dataUrlToBase64(await renderDiagram(rf, format, dark));
}

/** A single-page PDF sized to the diagram, base64-encoded. */
export async function diagramPdfBase64(rf: Rf, dark: boolean): Promise<string> {
  const dataUrl = await renderDiagram(rf, "png", dark);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
  const w = img.width;
  const h = img.height;
  const pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "pt", format: [w, h] });
  pdf.addImage(dataUrl, "PNG", 0, 0, w, h);
  return arrayBufferToBase64(pdf.output("arraybuffer"));
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Pack list + patch list as a single CSV document. */
export function listsToCsv(lists: DerivedLists): string {
  const rows: string[] = [];
  rows.push("Pack list - Devices");
  rows.push("Qty,Device");
  for (const d of lists.devices) rows.push(`${d.count},${csvCell(d.name)}`);
  rows.push("");
  rows.push("Pack list - Cables");
  rows.push("Qty,Cable");
  for (const c of lists.cables) rows.push(`${c.count},${csvCell(c.label)}`);
  rows.push("");
  rows.push("Patch list");
  rows.push("From device,From port,To device,To port,Cable");
  for (const p of lists.patches) {
    rows.push([p.fromDevice, p.fromPort, p.toDevice, p.toPort, p.cableType].map(csvCell).join(","));
  }
  return rows.join("\n");
}
