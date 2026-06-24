import { groupForConnector } from "../schema";
import type { SignalKind } from "../schema";
import { isPortBearing } from "../flow/types";
import type { CableEdgeType, PortBearingNode, SigNode } from "../flow/types";

/**
 * Cable-ID numbering. IDs are `PREFIX-NNN` (e.g. VID-001), the prefix keyed off
 * the run's signal group — ConnectCAD-style, the convention pros expect. Numbers
 * are assigned on draw (next free in the prefix's sequence) and can be re-sequenced
 * cleanly with {@link renumberCables}. Uniqueness is enforced by validation, not here.
 */
const GROUP_PREFIX: Record<SignalKind, string> = {
  av: "AV",
  video: "VID",
  audio: "AUD",
  data: "DAT",
  network: "NET",
  control: "CTL",
  power: "PWR",
};

const FALLBACK_PREFIX = "CBL";

function portBearingIndex(nodes: SigNode[]): Map<string, PortBearingNode> {
  const m = new Map<string, PortBearingNode>();
  for (const n of nodes) if (isPortBearing(n)) m.set(n.id, n);
  return m;
}

/** Prefix for a connector's signal group (VID, AUD, …). */
export function cablePrefixFromConnector(connector: string | undefined): string {
  if (!connector) return FALLBACK_PREFIX;
  return GROUP_PREFIX[groupForConnector(connector)] ?? FALLBACK_PREFIX;
}

/** Prefix for a cable, read from its source port's connector. */
function cablePrefix(edge: CableEdgeType, byId: Map<string, PortBearingNode>): string {
  const port = byId.get(edge.source)?.data.model.ports.find((p) => p.id === edge.sourceHandle);
  return cablePrefixFromConnector(port?.connector);
}

/** Format e.g. ("VID", 1) → "VID-001". */
export function formatCableId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

const ID_RE = /^([A-Za-z]+)-(\d+)$/;

/** Next free sequence number for a prefix, given the cables already numbered. */
export function nextCableNumber(prefix: string, edges: CableEdgeType[]): number {
  let max = 0;
  for (const e of edges) {
    const m = e.data?.number ? ID_RE.exec(e.data.number) : null;
    if (m && m[1].toUpperCase() === prefix.toUpperCase()) max = Math.max(max, Number(m[2]));
  }
  return max + 1;
}

/** Re-sequence every cable's ID by prefix, in the diagram's current order. */
export function renumberCables(edges: CableEdgeType[], nodes: SigNode[]): CableEdgeType[] {
  const byId = portBearingIndex(nodes);
  const counters = new Map<string, number>();
  return edges.map((e) => {
    const prefix = cablePrefix(e, byId);
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return { ...e, data: { ...(e.data ?? { cableTypeId: "" }), number: formatCableId(prefix, n) } };
  });
}
