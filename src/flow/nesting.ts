import { deviceTitle } from "../schema";
import type { BoundaryPort } from "../schema";
import { synthesizeBlockModel } from "../io/serialize";
import type { BlockNodeType, CableEdgeType, EditorDiagram, SigNode } from "./types";

/**
 * Editor-side helpers for the nesting verbs (p2-zonetab — design/ZONE-TAB.html).
 * `embedTabAsBlock` / `promoteZoneToTab` live in useProject; these are the pure pieces
 * they compose, kept here so the hook stays lean and the logic is unit-testable.
 */

export type Boundary = { ports: BoundaryPort[]; rev: number };

/**
 * Auto-expose a diagram's interface: every device port NOT wired internally becomes a
 * boundary port (decision 3 — auto on embed, curate later). Each is a projection of one
 * inner device port (`internal`), name-qualified by its device so duplicates read clearly.
 * Ids are derived from the inner port identity and minted once (persisted on first embed).
 */
export function deriveBoundary(ed: EditorDiagram): Boundary {
  const used = new Set<string>();
  for (const e of ed.edges) {
    if (e.sourceHandle) used.add(`${e.source}:${e.sourceHandle}`);
    if (e.targetHandle) used.add(`${e.target}:${e.targetHandle}`);
  }
  const ports: BoundaryPort[] = [];
  for (const n of ed.nodes) {
    if (n.type !== "device") continue;
    for (const p of n.data.model.ports) {
      if (used.has(`${n.id}:${p.id}`)) continue; // wired internally → not part of the face
      ports.push({
        id: `bp-${n.id}-${p.id}`,
        name: `${deviceTitle(n.data.model, n.data.label)} · ${p.name}`,
        direction: p.direction,
        connector: p.connector,
        accepts: p.accepts,
        grade: p.grade,
        internal: { instanceId: n.id, portId: p.id },
      });
    }
  }
  return { ports, rev: 1 };
}

/**
 * Would embedding `refId` into `hostId` create an embed cycle? True if `refId` is the host
 * itself or already reaches the host through existing blocks (A → B → A). DFS over the
 * block-reference graph held in each diagram's nodes.
 */
export function embedWouldCycle(diagrams: EditorDiagram[], hostId: string, refId: string): boolean {
  if (hostId === refId) return true;
  const byId = new Map(diagrams.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const stack = [refId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === hostId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of byId.get(id)?.nodes ?? []) {
      if (n.type === "block") stack.push(n.data.refDiagramId);
    }
  }
  return false;
}

/** A fresh block node referencing a diagram, its port model synthesized from `boundary`. */
export function makeBlockNode(
  refDiagramId: string,
  refName: string,
  boundary: Boundary,
  position: { x: number; y: number },
): BlockNodeType {
  return {
    id: crypto.randomUUID(),
    type: "block",
    position,
    data: {
      refDiagramId,
      model: synthesizeBlockModel(refDiagramId, { name: refName, ports: boundary.ports }),
      boundaryRev: boundary.rev,
      drift: false,
    },
  };
}

/** Depth guard for flatten() — diagrams shouldn't nest anywhere near this deep; it only
 *  exists so a hand-edited or mid-edit cyclic file can't recurse forever. */
const FLATTEN_DEPTH_CAP = 12;

/**
 * Expand a diagram and everything embedded in it into a single flat device graph, for the
 * project-wide passes (pack list, patch/cable schedule). Each block is replaced by a copy
 * of the diagram it references: inner node/edge ids are namespaced by the block-instance
 * path (so the same tab embedded N times yields N distinct, non-colliding copies — the
 * BOM multiplies correctly), and a cable that crosses a boundary is stitched straight onto
 * the real inner device port via `boundary.internal` (so one run = one cable, never two).
 * Device labels and cable numbers are instance-qualified by the embed path. A diagram with
 * no blocks flattens to itself, so non-nested behavior is unchanged.
 */
export function flatten(diagrams: EditorDiagram[], rootId: string): { nodes: SigNode[]; edges: CableEdgeType[] } {
  const byId = new Map(diagrams.map((d) => [d.id, d]));
  const nodes: SigNode[] = [];
  const edges: CableEdgeType[] = [];

  const expand = (id: string, prefix: string, labelPath: string, depth: number, stack: Set<string>) => {
    const d = byId.get(id);
    if (!d || depth > FLATTEN_DEPTH_CAP || stack.has(id)) return;
    const stack2 = new Set(stack).add(id);
    const ns = (local: string) => (prefix ? `${prefix}/${local}` : local);

    const blocks = new Map<string, BlockNodeType>();
    for (const n of d.nodes) if (n.type === "block") blocks.set(n.id, n);

    // Real devices → namespaced, label qualified by the embed path.
    for (const n of d.nodes) {
      if (n.type !== "device") continue;
      const label = labelPath ? `${labelPath} / ${deviceTitle(n.data.model, n.data.label)}` : n.data.label;
      nodes.push({ ...n, id: ns(n.id), data: { ...n.data, label } });
    }

    // Resolve a local endpoint, hopping through a block's boundary to the real inner port.
    const resolve = (nodeId: string, portId: string | null | undefined) => {
      const blk = blocks.get(nodeId);
      if (!blk) return { id: ns(nodeId), port: portId };
      const bp = byId.get(blk.data.refDiagramId)?.boundary?.ports.find((p) => p.id === portId);
      if (!bp) return null; // unresolved boundary → drop (surfaces as Broken in its own diagram)
      return { id: `${ns(blk.id)}/${bp.internal.instanceId}`, port: bp.internal.portId };
    };

    for (const e of d.edges) {
      const s = resolve(e.source, e.sourceHandle);
      const t = resolve(e.target, e.targetHandle);
      if (!s || !t) continue;
      const number = labelPath && e.data?.number ? `${labelPath} / ${e.data.number}` : e.data?.number;
      edges.push({
        ...e,
        id: ns(e.id),
        source: s.id,
        sourceHandle: s.port,
        target: t.id,
        targetHandle: t.port,
        data: e.data ? { ...e.data, number } : e.data,
      });
    }

    for (const [blkId, blk] of blocks) {
      const refName = blk.data.label ?? byId.get(blk.data.refDiagramId)?.name ?? "Block";
      const childPath = labelPath ? `${labelPath} / ${refName}` : refName;
      expand(blk.data.refDiagramId, ns(blkId), childPath, depth + 1, stack2);
    }
  };

  expand(rootId, "", "", 0, new Set());
  return { nodes, edges };
}
