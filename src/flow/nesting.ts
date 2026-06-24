import { deviceTitle } from "../schema";
import type { BoundaryPort } from "../schema";
import { synthesizeBlockModel } from "../io/serialize";
import type { BlockNodeType, EditorDiagram } from "./types";

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
