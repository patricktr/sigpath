import { SIGNAL_KINDS, SIGNAL_META, groupForConnector } from "../schema";
import type { SignalKind } from "../schema";
import { nodePorts } from "./types";
import type { CableEdgeType, SigNode } from "./types";

/**
 * Signal-type view filter (p2-typefilter — focus the canvas on one signal layer). Pure
 * helpers shared by the filter control (this slice) and the canvas dimming (later slices):
 * which signal layer(s) a cable belongs to, and the list of layers actually present in a
 * diagram. A layer = one `SignalKind` (audio / video / av / data / network / control / power),
 * derived from a port's connector via `groupForConnector`.
 */

export type SignalLayer = { kind: SignalKind; label: string; color: string; count: number };

/**
 * The signal layer(s) a cable belongs to — the group of each endpoint's port. Usually one;
 * two when an adapter cable crosses groups (e.g. HDMI→XLR), so it shows in both layers.
 */
export function edgeSignalGroups(edge: CableEdgeType, nodeById: Map<string, SigNode>): Set<SignalKind> {
  const groups = new Set<SignalKind>();
  const src = nodePorts(nodeById.get(edge.source)).find((p) => p.id === edge.sourceHandle);
  const tgt = nodePorts(nodeById.get(edge.target)).find((p) => p.id === edge.targetHandle);
  if (src) groups.add(groupForConnector(src.connector));
  if (tgt) groups.add(groupForConnector(tgt.connector));
  return groups;
}

/**
 * The signal layers present in a diagram, in canonical order, each with its cable count — the
 * rows the filter control shows. A layer is "present" if any device/block port or any cable
 * carries it (so an unwired-but-capable layer still appears, for capability-mode filtering);
 * `count` is the number of cables in that layer (0 for a port-only layer).
 */
export function signalLayers(nodes: SigNode[], edges: CableEdgeType[]): SignalLayer[] {
  const counts = new Map<SignalKind, number>();
  const present = new Set<SignalKind>();
  for (const n of nodes) for (const p of nodePorts(n)) present.add(groupForConnector(p.connector));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    for (const k of edgeSignalGroups(e, byId)) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      present.add(k);
    }
  }
  return SIGNAL_KINDS.filter((k) => present.has(k)).map((k) => ({
    kind: k,
    label: SIGNAL_META[k].label,
    color: SIGNAL_META[k].color,
    count: counts.get(k) ?? 0,
  }));
}
