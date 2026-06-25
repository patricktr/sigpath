import type { CableEdgeType, SigNode } from "./types";
import { nodePorts } from "./types";
import type { Pt, Rect } from "./obstacleRoute";
import { routeOrthogonal } from "./router/orthogonalRoute";
import type { EdgeEnds } from "./router/types";
import { deriveColumns } from "./makeRoom";
import { groupForConnector } from "../schema";
import type { SignalKind, Trunk } from "../schema";

/**
 * Trunk bundling (p2-trunk) — geometry + detection for collapsible cable bundles. A trunk is a
 * set of ≥4 like-cables (same coarse signal family) that run between the same two device columns
 * and share a corridor. When collapsed it draws as one labeled spine with short fan-in / fan-out
 * stubs to each member's real port, so it reads as a single backbone while every member stays a
 * real, individually-selectable Connection (the BOM/validation never see a trunk). See design §6.
 */

const MIN_TRUNK = 4;

/** A bundle the UI may OFFER to create — derived per render, not persisted until accepted. */
export type TrunkCandidate = {
  /** Stable id from the sorted member connection ids (so the same bundle keeps its identity). */
  id: string;
  signalKind: SignalKind;
  memberConnectionIds: string[];
  /** Corridor center X + the members' mean Y — where to anchor the offer chip / count badge. */
  corridorX: number;
  anchorY: number;
};

/** A short, stable id for a member set (order-independent). */
export function trunkId(memberConnectionIds: string[]): string {
  const key = [...memberConnectionIds].sort().join(",");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return "trunk_" + (h >>> 0).toString(36);
}

/**
 * Find bundle candidates: standard output→input runs grouped by (signal family, source column,
 * dest column); any group of ≥4 shares a corridor and is offered as a trunk.
 */
export function detectTrunkCandidates(nodes: SigNode[], edges: CableEdgeType[], ends: Map<string, EdgeEnds>): TrunkCandidate[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const columns = deriveColumns(nodes);
  const colOf = (nodeId: string) => columns.findIndex((c) => c.ids.includes(nodeId));

  const groups = new Map<string, { ids: string[]; srcCol: number; dstCol: number; kind: SignalKind }>();
  for (const e of edges) {
    const en = ends.get(e.id);
    if (!en || en.sourceSide !== "R" || en.targetSide !== "L") continue; // output→input runs only
    const srcCol = colOf(e.source);
    const dstCol = colOf(e.target);
    if (srcCol < 0 || dstCol < 0 || srcCol === dstCol) continue;
    const sp = nodePorts(byId.get(e.source)).find((p) => p.id === e.sourceHandle);
    const kind = groupForConnector(sp?.connector);
    const key = `${kind}|${srcCol}|${dstCol}`;
    const g = groups.get(key) ?? { ids: [], srcCol, dstCol, kind };
    g.ids.push(e.id);
    groups.set(key, g);
  }

  const out: TrunkCandidate[] = [];
  for (const g of groups.values()) {
    if (g.ids.length < MIN_TRUNK) continue;
    const ys = g.ids.map((id) => { const en = ends.get(id)!; return (en.sy + en.ty) / 2; });
    out.push({
      id: trunkId(g.ids),
      signalKind: g.kind,
      memberConnectionIds: [...g.ids].sort(),
      corridorX: (columns[g.srcCol].right + columns[g.dstCol].left) / 2,
      anchorY: ys.reduce((a, b) => a + b, 0) / ys.length,
    });
  }
  return out;
}

/**
 * Per-member interior waypoints for a COLLAPSED trunk: each member fans from its real source port
 * up/down to the shared spine, runs the box-avoided spine (one path, so all members overlap into a
 * single backbone), then fans out to its real target port. Returns a map edgeId → interior points,
 * plus the spine's midpoint for the count badge. Members keep their own ports (CableEdge stitches
 * them), so the bundle stays fully traceable.
 */
export function collapsedTrunkWaypoints(
  trunk: Pick<Trunk, "memberConnectionIds">,
  ends: Map<string, EdgeEnds>,
  obstacles: Rect[],
): { perEdge: Map<string, Pt[]>; badge: Pt } | null {
  const members = trunk.memberConnectionIds.map((id) => ends.get(id)).filter((e): e is EdgeEnds => !!e);
  if (members.length < 2) return null;

  const fanInX = Math.max(...members.map((e) => e.sx)); // rightmost source-output edge
  const fanOutX = Math.min(...members.map((e) => e.tx)); // leftmost dest-input edge
  if (fanOutX <= fanInX) return null; // columns overlap — skip (members route normally)
  const fanInY = members.reduce((a, e) => a + e.sy, 0) / members.length;
  const fanOutY = members.reduce((a, e) => a + e.ty, 0) / members.length;

  // The spine itself avoids boxes (exclude the bundle's own endpoint devices via empty ownRects —
  // the fan points already sit at the column edges, clear of the devices).
  const spine = routeOrthogonal({ x: fanInX, y: fanInY, dir: "+x" }, { x: fanOutX, y: fanOutY, dir: "-x" }, obstacles, []) ?? [];
  const spineCore: Pt[] = [{ x: fanInX, y: fanInY }, ...spine, { x: fanOutX, y: fanOutY }];

  const perEdge = new Map<string, Pt[]>();
  for (const id of trunk.memberConnectionIds) {
    const e = ends.get(id);
    if (!e) continue;
    // member port → (fanInX at its Y) → shared spine → (fanOutX at its Y) → member port
    perEdge.set(id, [{ x: fanInX, y: e.sy }, ...spineCore, { x: fanOutX, y: e.ty }]);
  }
  const mid = spineCore[Math.floor(spineCore.length / 2)];
  return { perEdge, badge: { x: (fanInX + fanOutX) / 2, y: mid.y } };
}
