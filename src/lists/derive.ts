import { CABLE_TYPES, DEFAULT_CABLE_COLOR, deviceTitle } from "../schema";
import type { CableEdgeType, DeviceNodeType, SigNode } from "../flow/types";

/** One device model with how many instances are in the diagram. */
export type PacklistDevice = { key: string; name: string; count: number };
/** One cable type with how many runs of it are in the diagram. */
export type PacklistCable = { id: string; label: string; color: string; count: number };
/** One connection, port-to-port. */
export type PatchRow = {
  id: string;
  fromDevice: string;
  fromPort: string;
  toDevice: string;
  toPort: string;
  cableType: string;
  cableColor: string;
};

export type DerivedLists = {
  devices: PacklistDevice[];
  cables: PacklistCable[];
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

  // Pack list — cables grouped by type.
  const cableCounts = new Map<string, number>();
  for (const e of edges) {
    const id = e.data?.cableTypeId;
    if (id) cableCounts.set(id, (cableCounts.get(id) ?? 0) + 1);
  }
  const cables: PacklistCable[] = [...cableCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: CABLE_TYPES[id]?.label ?? id,
      color: CABLE_TYPES[id]?.color ?? DEFAULT_CABLE_COLOR,
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Patch list — one row per connection, resolving device + port names.
  const deviceById = new Map(deviceNodes.map((n) => [n.id, n]));
  const patches: PatchRow[] = edges.map((e) => {
    const src = deviceById.get(e.source);
    const tgt = deviceById.get(e.target);
    const srcPort = src?.data.model.ports.find((p) => p.id === e.sourceHandle);
    const tgtPort = tgt?.data.model.ports.find((p) => p.id === e.targetHandle);
    const cable = e.data?.cableTypeId ? CABLE_TYPES[e.data.cableTypeId] : undefined;
    return {
      id: e.id,
      fromDevice: src ? deviceTitle(src.data.model, src.data.label) : "—",
      fromPort: srcPort?.name ?? e.sourceHandle ?? "",
      toDevice: tgt ? deviceTitle(tgt.data.model, tgt.data.label) : "—",
      toPort: tgtPort?.name ?? e.targetHandle ?? "",
      cableType: cable?.label ?? "",
      cableColor: cable?.color ?? DEFAULT_CABLE_COLOR,
    };
  });

  return { devices, cables, patches };
}
