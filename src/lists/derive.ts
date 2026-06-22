import { cableColor, cableLabel, checkPortCompatibility, deviceTitle } from "../schema";
import type { CableEdgeType, DeviceNodeType, SigNode } from "../flow/types";

/** One device model with how many instances are in the diagram. */
export type PacklistDevice = { key: string; name: string; count: number };
/** One cable type with how many runs of it are in the diagram. */
export type PacklistCable = { id: string; label: string; color: string; count: number };
/** One connection, port-to-port. */
export type PatchRow = {
  id: string;
  /** Human cable ID, e.g. "VID-001" (blank until numbered). */
  cableId: string;
  /** Run length in meters, if recorded. */
  length?: number;
  fromDevice: string;
  fromPort: string;
  toDevice: string;
  toPort: string;
  cableType: string;
  cableColor: string;
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
};

/** Build the pack list (devices + cables) and patch list for a diagram. */
export function deriveLists(nodes: SigNode[], edges: CableEdgeType[]): DerivedLists {
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

  // Resolve each connection's endpoint ports + compatibility once.
  const deviceById = new Map(deviceNodes.map((n) => [n.id, n]));
  const links = edges.map((e) => {
    const src = deviceById.get(e.source);
    const tgt = deviceById.get(e.target);
    const out = src?.data.model.ports.find((p) => p.id === e.sourceHandle);
    const inp = tgt?.data.model.ports.find((p) => p.id === e.targetHandle);
    const compat = out && inp ? checkPortCompatibility(out, inp) : undefined;
    return { e, src, tgt, out, inp, compat };
  });

  // Pack list — cables. Straight runs only; transitions go to Cables & adapters and
  // AC↔DC power is the device's PSU (neither is a like-to-like cable to buy).
  const cableCounts = new Map<string, number>();
  for (const { e, compat } of links) {
    if (compat && compat.kind !== "straight") continue;
    const id = e.data?.cableTypeId;
    if (id) cableCounts.set(id, (cableCounts.get(id) ?? 0) + 1);
  }
  const cables: PacklistCable[] = [...cableCounts.entries()]
    .map(([id, count]) => ({ id, label: cableLabel(id), color: cableColor(id), count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Cables & adapters — transition cables (passive) and converters needed (active).
  const adapterCounts = new Map<
    string,
    { label: string; color: string; count: number; kind: "adapter" | "converter" | "psu" }
  >();
  for (const { out, inp, compat } of links) {
    const kind = compat?.kind;
    if (!out || !inp || (kind !== "adapter" && kind !== "converter" && kind !== "psu")) continue;
    // PSUs (AC↔DC) are the device's own supply, not a stock cable — group them all
    // under one "device PSU" line rather than a (misleading) connector-pair name.
    const key = kind === "psu" ? "psu" : `${out.connector}>${inp.connector}`;
    const cur = adapterCounts.get(key);
    if (cur) cur.count += 1;
    else
      adapterCounts.set(key, {
        label:
          kind === "psu"
            ? "Power · device PSU"
            : `${cableLabel(out.connector)} → ${cableLabel(inp.connector)}`,
        color: cableColor(out.connector),
        count: 1,
        kind,
      });
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
      toDevice: tgt ? deviceTitle(tgt.data.model, tgt.data.label) : "—",
      toPort: inp?.name ?? e.targetHandle ?? "",
      cableType,
      cableColor: cableColor(cableId),
    };
  });

  return { devices, cables, adapters, patches };
}
