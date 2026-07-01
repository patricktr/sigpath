import { cableColor, cableLabel, checkPortCompatibility, deviceTitle, DC_POWER } from "../schema";
import type { InstallStatus } from "../schema";
import { isPortBearing } from "../flow/types";
import type { CableEdgeType, DeviceNodeType, SigNode } from "../flow/types";
import { computeCableBom, DEFAULT_SPARE_RULE, type BomLine, type CableRun, type SpareRule } from "../bomRules";
import type { DistanceUnit } from "../units";

/** One device model with how many instances are in the diagram. */
export type PacklistDevice = { key: string; name: string; count: number };
/** One cable type with how many runs of it are in the diagram, and the total recorded run length
 *  (meters) across those runs — absent when no run of this type has a length set. */
export type PacklistCable = { id: string; label: string; color: string; count: number; lengthMeters?: number };
/** One connection, port-to-port — the cable-schedule row (p3-cableschedule). */
export type PatchRow = {
  id: string;
  /** Human cable ID, e.g. "VID-001" (blank until numbered). */
  cableId: string;
  /** Run length in meters, if recorded. */
  length?: number;
  fromDevice: string;
  fromPort: string;
  /** Connector at the output (A) end, e.g. "HDMI", "XLR-3". */
  fromConnector: string;
  toDevice: string;
  toPort: string;
  /** Connector at the input (B) end. */
  toConnector: string;
  cableType: string;
  cableColor: string;
  /** Free-text schedule note, if set on the cable. */
  note?: string;
  /** Install-tracking status (checklist mode). Absent ⇒ "planned". */
  install?: InstallStatus;
};

/** One transition cable (passive), needed converter (active), or device PSU (AC↔DC). */
export type AdapterRow = {
  key: string;
  label: string;
  color: string;
  count: number;
  kind: "adapter" | "converter" | "psu";
};

export type DerivedLists = {
  devices: PacklistDevice[];
  cables: PacklistCable[];
  adapters: AdapterRow[];
  patches: PatchRow[];
  /** Orderable cable BOM grouped by SKU (type + grade + stock length) with spares
   *  (p3-bomrules). Present only when {@link deriveLists} is given the distance unit. */
  cableBom?: BomLine[];
};

/** Options that turn on the SKU-granular cable BOM (p3-bomrules) — needs the display unit
 *  (for the stock-length ladder) and the per-connector spare rule. */
export type DeriveOpts = { unit: DistanceUnit; ruleFor?: (connector: string) => SpareRule };

/** Build the pack list (devices + cables) and patch list for a diagram. */
export function deriveLists(
  nodes: SigNode[],
  edges: CableEdgeType[],
  opts?: DeriveOpts,
): DerivedLists {
  const deviceNodes = nodes.filter((n): n is DeviceNodeType => n.type === "device");

  // Pack list — devices grouped by model.
  const deviceCounts = new Map<string, { name: string; count: number }>();
  for (const n of deviceNodes) {
    const model = n.data.model;
    const name = model.manufacturer ? `${model.manufacturer} ${model.model}` : model.model;
    const cur = deviceCounts.get(model.id);
    if (cur) cur.count += 1;
    else deviceCounts.set(model.id, { name, count: 1 });
  }
  const devices: PacklistDevice[] = [...deviceCounts.entries()]
    .map(([key, v]) => ({ key, name: v.name, count: v.count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Resolve each connection's endpoint ports + compatibility once. Endpoints index over
  // ALL port-bearing nodes (devices AND blocks) so a cable into a nested-diagram block
  // resolves its boundary port — and counts as one cable. (The equipment list above stays
  // device-only; a block's inner devices are folded in via flatten() in Phase B.)
  const endpointById = new Map(nodes.filter(isPortBearing).map((n) => [n.id, n]));
  const links = edges.map((e) => {
    const src = endpointById.get(e.source);
    const tgt = endpointById.get(e.target);
    const out = src?.data.model.ports.find((p) => p.id === e.sourceHandle);
    const inp = tgt?.data.model.ports.find((p) => p.id === e.targetHandle);
    const compat = out && inp ? checkPortCompatibility(out, inp) : undefined;
    return { e, src, tgt, out, inp, compat };
  });

  // Pack list — cables. Straight runs only; transitions go to Cables & adapters and
  // AC↔DC power is the device's PSU (neither is a like-to-like cable to buy).
  const cableCounts = new Map<string, { count: number; length: number }>();
  const cableRuns: CableRun[] = [];
  for (const { e, compat } of links) {
    if (compat && compat.kind !== "straight") continue;
    const id = e.data?.cableTypeId;
    if (!id) continue;
    const cur = cableCounts.get(id) ?? { count: 0, length: 0 };
    cur.count += 1;
    cur.length += e.data?.lengthMeters ?? 0;
    cableCounts.set(id, cur);
    cableRuns.push({ connector: id, grade: e.data?.cableGrade, lengthMeters: e.data?.lengthMeters });
  }
  const cables: PacklistCable[] = [...cableCounts.entries()]
    .map(([id, v]) => ({
      id,
      label: cableLabel(id),
      color: cableColor(id),
      count: v.count,
      // Full-precision meters; rounding happens once at display (formatLength) in the
      // chosen unit. Pre-rounding here to 0.1 m drifts after m→ft conversion (30 ft → 29.9).
      lengthMeters: v.length > 0 ? v.length : undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Power cords (p3-psupacklist) — an AC mains inlet needs its matching cord, whether or not power
  // is drawn (signal diagrams usually omit power). Device-driven, like the PSU bricks: one cord per
  // device per cord-type whose inlet(s) are all UNWIRED — a wired mains run already counts as a
  // cable above, and redundant same-type inlets don't double-pack. Each AC inlet family maps to the
  // cord it takes (C14→C13, figure-8 C8→C7, cloverleaf C6→C5). C19/C20 + powerCON aren't here yet.
  const POWER_CORD: Record<string, string> = {
    iec: "IEC C13 power cord",
    "iec-c7": "IEC C7 figure-8 power cord",
    "iec-c5": "IEC C5 cloverleaf power cord",
  };
  const wiredInputs = new Set(edges.map((e) => `${e.target}:${e.targetHandle}`));
  const cordCounts = new Map<string, number>();
  for (const n of deviceNodes) {
    for (const conn of Object.keys(POWER_CORD)) {
      const ins = n.data.model.ports.filter((p) => p.direction === "input" && p.connector === conn);
      if (ins.length && !ins.some((p) => wiredInputs.has(`${n.id}:${p.id}`))) {
        cordCounts.set(conn, (cordCounts.get(conn) ?? 0) + 1);
      }
    }
  }
  for (const [conn, count] of cordCounts) {
    cables.push({ id: `cord-${conn}`, label: POWER_CORD[conn], color: cableColor(conn), count });
  }
  if (cordCounts.size > 0) cables.sort((a, b) => a.label.localeCompare(b.label));

  // Cables & adapters — transition cables (passive) and converters needed (active).
  const adapterCounts = new Map<
    string,
    { label: string; color: string; count: number; kind: "adapter" | "converter" | "psu" }
  >();
  for (const { out, inp, compat } of links) {
    const kind = compat?.kind;
    if (!out || !inp || (kind !== "adapter" && kind !== "converter")) continue;
    const key = `${out.connector}>${inp.connector}`;
    const cur = adapterCounts.get(key);
    if (cur) cur.count += 1;
    else
      adapterCounts.set(key, {
        label: `${cableLabel(out.connector)} → ${cableLabel(inp.connector)}`,
        color: cableColor(out.connector),
        count: 1,
        kind,
      });
  }

  // PSUs / wall-warts (p3-psupacklist) — device-driven: a device with an external-DC INPUT port
  // ships with its own power brick, so it lists whether or not a power source is wired. One line
  // per powered device model ("PSU — <name>"), counted by instance like the device pack list.
  // Replaces the old lumped connection-driven line; the connection-level `psu` kind stays for
  // validation. IEC inlets never qualify (internal mains supply, not a brick).
  const psuCounts = new Map<string, { name: string; count: number }>();
  for (const n of deviceNodes) {
    const model = n.data.model;
    if (!model.ports.some((p) => p.direction === "input" && DC_POWER.has(p.connector))) continue;
    const name = model.manufacturer ? `${model.manufacturer} ${model.model}` : model.model;
    const cur = psuCounts.get(model.id);
    if (cur) cur.count += 1;
    else psuCounts.set(model.id, { name, count: 1 });
  }
  for (const [id, v] of psuCounts) {
    adapterCounts.set(`psu-${id}`, { label: `PSU — ${v.name}`, color: cableColor("dc-barrel"), count: v.count, kind: "psu" });
  }
  const order = { adapter: 0, converter: 1, psu: 2 } as const;
  const adapters: AdapterRow[] = [...adapterCounts.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));

  // Patch list — one row per connection, with a transition-aware cable label.
  const patches: PatchRow[] = links.map(({ e, src, tgt, out, inp, compat }) => {
    const cableId = e.data?.cableTypeId;
    const kind = compat?.kind;
    let cableType: string;
    if ((kind === "adapter" || kind === "converter") && out && inp) {
      cableType =
        `${cableLabel(out.connector)} → ${cableLabel(inp.connector)}` +
        (kind === "converter" ? " (converter)" : "");
    } else if (kind === "psu") {
      cableType = "Power · device PSU";
    } else {
      cableType = cableId ? cableLabel(cableId) : "";
    }
    return {
      id: e.id,
      cableId: e.data?.number ?? "",
      length: e.data?.lengthMeters,
      fromDevice: src ? deviceTitle(src.data.model, src.data.label) : "—",
      fromPort: out?.name ?? e.sourceHandle ?? "",
      fromConnector: out ? cableLabel(out.connector) : "",
      toDevice: tgt ? deviceTitle(tgt.data.model, tgt.data.label) : "—",
      toPort: inp?.name ?? e.targetHandle ?? "",
      toConnector: inp ? cableLabel(inp.connector) : "",
      cableType,
      cableColor: cableColor(cableId),
      note: e.data?.note,
      install: e.data?.install,
    };
  });

  // Orderable cable BOM (p3-bomrules) — SKU-grouped with spares. Only when a unit is given.
  const cableBom = opts
    ? computeCableBom(cableRuns, opts.ruleFor ?? (() => DEFAULT_SPARE_RULE), opts.unit)
    : undefined;

  return { devices, cables, adapters, patches, ...(cableBom ? { cableBom } : {}) };
}
