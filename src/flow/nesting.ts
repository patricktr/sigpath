import { deviceTitle } from "../schema";
import type { BoundaryPort } from "../schema";
import { synthesizeBlockModel } from "../io/serialize";
import { boundaryHash } from "./boundaryDrift";
import { nodesInZone } from "./zoneMembership";
import type { BlockNodeType, CableEdgeType, EditorDiagram, SigNode, ZoneNodeType } from "./types";

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
  return { ports, rev: boundaryHash(ports) };
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

function blockNode(
  id: string,
  refDiagramId: string,
  refName: string,
  boundary: Boundary,
  position: { x: number; y: number },
): BlockNodeType {
  return {
    id,
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

/** A fresh block node referencing a diagram, its port model synthesized from `boundary`. */
export function makeBlockNode(
  refDiagramId: string,
  refName: string,
  boundary: Boundary,
  position: { x: number; y: number },
): BlockNodeType {
  return blockNode(crypto.randomUUID(), refDiagramId, refName, boundary, position);
}

export type PromotePlan = {
  /** The new sub-diagram's content (members, rebased) + internal cables + published boundary. */
  subNodes: SigNode[];
  subEdges: CableEdgeType[];
  boundary: Boundary;
  /** The block that replaces the zone in the host diagram. */
  block: BlockNodeType;
  /** The host diagram after promotion: zone + members removed, block added. */
  hostNodes: SigNode[];
  /** The host edges after promotion: internal runs removed, crossing runs re-pointed to the block. */
  hostEdges: CableEdgeType[];
  movedDeviceCount: number;
};

/**
 * Plan promoting a zone into its own tab (p2-zonetab, decision 1/2 — MOVE, with confirm).
 * Pure: computes the whole transformation without mutating anything, so the caller can
 * apply it in one atomic snapshot. Members are the nodes geometrically inside the zone;
 * they move into a new sub-diagram (positions rebased to the zone origin). A cable with
 * both ends inside is internal and moves too; a cable crossing the zone edge auto-publishes
 * a boundary port for its inside endpoint and is re-pointed onto the new block — so the run
 * stays a single cable, now entering/leaving the room through the boundary. The published
 * face is the room's FULL interface: un-wired member device ports are exposed too (parity
 * with embedTabAsBlock), so an unwired room becomes a wireable block; curation trims later.
 */
export function planPromoteZone(
  zone: ZoneNodeType,
  hostNodes: SigNode[],
  hostEdges: CableEdgeType[],
  ids: { diagramId: string; blockId: string },
): PromotePlan {
  const members = nodesInZone(zone, hostNodes);
  const memberIds = new Set(members.map((m) => m.id));
  const memberById = new Map(members.map((m) => [m.id, m]));

  // Rebase member positions to the zone's top-left so the new tab reads tidily.
  const subNodes: SigNode[] = members.map((m) => ({
    ...m,
    position: { x: m.position.x - zone.position.x + 40, y: m.position.y - zone.position.y + 40 },
    selected: false,
  }));

  const portOf = (nodeId: string, portId: string | null | undefined) => {
    const n = memberById.get(nodeId);
    if (!n || (n.type !== "device" && n.type !== "block")) return undefined;
    return n.data.model.ports.find((p) => p.id === portId);
  };

  const boundaryPorts: BoundaryPort[] = [];
  const bpByKey = new Map<string, BoundaryPort>();
  const boundaryFor = (memberId: string, portId: string): BoundaryPort => {
    const key = `${memberId}:${portId}`;
    const existing = bpByKey.get(key);
    if (existing) return existing;
    const member = memberById.get(memberId);
    const port = portOf(memberId, portId);
    const devName =
      member && (member.type === "device" || member.type === "block")
        ? deviceTitle(member.data.model, member.data.label)
        : "Port";
    const bp: BoundaryPort = {
      id: `bp-${memberId}-${portId}`,
      name: `${devName} · ${port?.name ?? portId}`,
      direction: port?.direction ?? "output",
      connector: port?.connector ?? "",
      accepts: port?.accepts,
      grade: port?.grade,
      internal: { instanceId: memberId, portId },
    };
    bpByKey.set(key, bp);
    boundaryPorts.push(bp);
    return bp;
  };

  const subEdges: CableEdgeType[] = [];
  const hostEdgesOut: CableEdgeType[] = [];
  for (const e of hostEdges) {
    const sIn = memberIds.has(e.source);
    const tIn = memberIds.has(e.target);
    if (sIn && tIn) {
      subEdges.push({ ...e, selected: false }); // internal run → moves into the sub-diagram
    } else if (sIn) {
      const bp = boundaryFor(e.source, e.sourceHandle ?? ""); // leaves the room → boundary on the source
      hostEdgesOut.push({ ...e, source: ids.blockId, sourceHandle: bp.id });
    } else if (tIn) {
      const bp = boundaryFor(e.target, e.targetHandle ?? ""); // enters the room → boundary on the target
      hostEdgesOut.push({ ...e, target: ids.blockId, targetHandle: bp.id });
    } else {
      hostEdgesOut.push(e); // wholly outside → untouched
    }
  }

  // Parity with embedTabAsBlock/deriveBoundary: the block carries the room's FULL interface,
  // not just the cables that happened to cross the zone edge. Every member device port that
  // no internal run consumes is published too — so an unwired room promotes to a wireable
  // block instead of an unwireable one. Crossing ports were already minted above; boundaryFor
  // dedups by inner-port identity. The curate panel (Phase C) hides the extras later.
  const wiredInternally = new Set<string>();
  for (const e of subEdges) {
    if (e.sourceHandle) wiredInternally.add(`${e.source}:${e.sourceHandle}`);
    if (e.targetHandle) wiredInternally.add(`${e.target}:${e.targetHandle}`);
  }
  for (const m of members) {
    if (m.type !== "device") continue; // mirror deriveBoundary: only device ports form the face
    for (const p of m.data.model.ports) {
      if (wiredInternally.has(`${m.id}:${p.id}`)) continue; // internal run → not on the face
      boundaryFor(m.id, p.id); // dangling (or already-published crossing) port → public face
    }
  }

  const boundary: Boundary = { ports: boundaryPorts, rev: boundaryHash(boundaryPorts) };
  const block = blockNode(ids.blockId, ids.diagramId, zone.data.label || "Room", boundary, zone.position);
  const hostNodesOut = hostNodes.filter((n) => n.id !== zone.id && !memberIds.has(n.id)).concat(block);

  return {
    subNodes,
    subEdges,
    boundary,
    block,
    hostNodes: hostNodesOut,
    hostEdges: hostEdgesOut,
    movedDeviceCount: members.filter((m) => m.type === "device").length,
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
/**
 * Where a flattened edge really lives (p2-deepgrade) — so a grade issue found on a namespaced
 * flat edge can be projected back: styled on the active canvas if it's the active diagram's own
 * edge, or badged on the host block (`blockPath[0]`) and navigated to (`ownerDiagramId` +
 * `localEdgeId` + `localFocus`) if it lives inside an embedded room.
 */
export type EdgeProvenance = {
  /** The diagram this edge is declared in (the active root, or an embedded room). */
  ownerDiagramId: string;
  ownerName: string;
  /** The edge's real id within `ownerDiagramId` (NOT the namespaced flat id). */
  localEdgeId: string;
  /** The edge's real endpoint node ids within `ownerDiagramId`, for select/fitView on jump. */
  localFocus: string[];
  /** The block-instance path from the active canvas down to this edge; `[0]` is the active block. */
  blockPath: string[];
  /** Human embed path from the active canvas, e.g. "Control Room" or "Stage Rack 2 / PSU" —
   *  distinguishes which embed of a room a finding came from (N-embed naming). */
  pathLabel: string;
};

export function flatten(
  diagrams: EditorDiagram[],
  rootId: string,
): { nodes: SigNode[]; edges: CableEdgeType[]; provenance: Map<string, EdgeProvenance> } {
  const byId = new Map(diagrams.map((d) => [d.id, d]));
  const nodes: SigNode[] = [];
  const edges: CableEdgeType[] = [];
  const provenance = new Map<string, EdgeProvenance>();

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
      provenance.set(ns(e.id), {
        ownerDiagramId: id,
        ownerName: d.name,
        localEdgeId: e.id,
        localFocus: [e.source, e.target],
        blockPath: prefix ? prefix.split("/") : [],
        pathLabel: labelPath,
      });
    }

    for (const [blkId, blk] of blocks) {
      const refName = blk.data.label ?? byId.get(blk.data.refDiagramId)?.name ?? "Block";
      const childPath = labelPath ? `${labelPath} / ${refName}` : refName;
      expand(blk.data.refDiagramId, ns(blkId), childPath, depth + 1, stack2);
    }
  };

  expand(rootId, "", "", 0, new Set());
  return { nodes, edges, provenance };
}
