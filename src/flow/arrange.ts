import type { CableEdgeType, SigNode, ZoneNodeType } from "./types";
import { isPortBearing } from "./types";
import { inputPorts, outputPorts } from "../schema";
import { approxPortY } from "./parallelLanes";
import { nodesInZone } from "./zoneMembership";
import { newRouter } from "./router/newRouter";
import { metricsFromResult } from "./routeMetrics";

/**
 * Auto-arrange (p2-autoarrangezones) — a self-built, port-constrained layered layout in the
 * Sugiyama tradition, informed by the cable-plan literature (Schulze et al. 2014 / KLay;
 * Zink et al. 2022 / Praline; Hegemann & Wolff 2023):
 *
 *  - ports are FIXED (inputs left, outputs right, bidi bottom), so crossing minimization
 *    uses real port Y offsets, not node centers;
 *  - bidirectional (network/USB) edges get an orientation pre-pass so the mostly-DAG
 *    signal flow stays left-to-right;
 *  - zones stay CONTIGUOUS via compounding: each zone's members are laid out independently,
 *    the zone collapses to a super-node for a condensed global pass, then expands in place
 *    (the boundary-port technique from the compound-layout literature) — and the zone's
 *    rectangle is re-fitted around its members afterward;
 *  - placement is deliberately router-friendly: wide gutters between columns (room for
 *    label stubs + lane fans) and grid-snapped coordinates. Routing stays the router's job
 *    (the modular placement-then-routing pipeline the literature found competitive).
 *
 * Four one-shot modes: "flow" (left→right by signal), "zones" (rooms first, packed by cable
 * affinity), "hub" (mirrored layering around a chosen/auto hub), "grid" (compact shelf pack).
 */

export type ArrangeMode = "flow" | "zones" | "hub" | "grid";

const GRID = 24;
/** Horizontal clearance between columns — room for both label stubs + a lane fan. */
const COL_GUTTER = 9 * GRID; // 216
const ROW_GAP = 2 * GRID; // 48
/** Padding a zone keeps around its members (extra headroom on top for the zone label). */
const ZONE_PAD = GRID;
const ZONE_PAD_TOP = 2 * GRID;
/** Clearance between packed groups (zones mode) and grid cells (grid mode). */
const PACK_GAP = 4 * GRID; // 96
const snap = (v: number) => Math.round(v / GRID) * GRID;

type Pos = { x: number; y: number };
type Size = { w: number; h: number };

/** Measured size, or the router's port-count estimate for an unmeasured node. */
function sizeOf(n: SigNode): Size {
  if (!isPortBearing(n)) {
    return {
      w: n.measured?.width ?? (typeof n.width === "number" ? n.width : 168),
      h: n.measured?.height ?? (typeof n.height === "number" ? n.height : 96),
    };
  }
  const ports = Math.max(inputPorts(n.data.model).length, outputPorts(n.data.model).length, 1);
  return {
    w: n.measured?.width ?? (typeof n.width === "number" ? n.width : 168),
    h: n.measured?.height ?? (typeof n.height === "number" ? n.height : approxPortY(ports - 1) + 24),
  };
}

// ---------------------------------------------------------------------------------------
// Layered core: items (devices, blocks, or collapsed zone groups) + oriented links.
// ---------------------------------------------------------------------------------------

type Item = { id: string; size: Size; /** initial y, for stable first ordering */ y0: number };
type Link = {
  source: string;
  target: string;
  /** Port Y offsets within each item (crossing minimization uses the real jack rows). */
  sy: number;
  ty: number;
};

type Layout = { pos: Map<string, Pos>; bbox: Size };

/**
 * Longest-path ranks over directed links, bounded for the odd feedback loop. Optionally
 * seeded (hub mode ranks upstream devices negative).
 */
function rankLongestPath(items: Item[], links: Link[], seed?: Map<string, number>): Map<string, number> {
  const rank = new Map<string, number>();
  for (const it of items) rank.set(it.id, seed?.get(it.id) ?? 0);
  for (let iter = 0; iter < items.length; iter++) {
    let changed = false;
    for (const l of links) {
      if (seed?.has(l.source) && seed?.has(l.target)) continue; // both pinned (hub spine)
      const next = (rank.get(l.source) ?? 0) + 1;
      if (!seed?.has(l.target) && next > (rank.get(l.target) ?? 0)) {
        rank.set(l.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

/**
 * The layered pipeline: rank → barycenter ordering sweeps (using port Ys) → width-aware
 * grid-snapped coordinates. Returns positions with a (0,0) top-left origin.
 */
function layeredLayout(realItems: Item[], realLinks: Link[], seedRanks?: Map<string, number>): Layout {
  if (realItems.length === 0) return { pos: new Map(), bbox: { w: 0, h: 0 } };
  const realRank = rankLongestPath(realItems, realLinks, seedRanks);

  // Dummy-vertex chains (proper Sugiyama): an edge spanning >1 rank is split through
  // zero-width placeholders so the ordering passes SEE long edges — without them, a cable
  // crossing three columns is invisible to crossing minimization and lands on top of
  // whatever sits in between.
  const items: Item[] = [...realItems];
  const links: Link[] = [];
  const realIds = new Set(realItems.map((i) => i.id));
  const rank = new Map(realRank);
  let dummyN = 0;
  for (const l of realLinks) {
    const rs = realRank.get(l.source) ?? 0;
    const rt = realRank.get(l.target) ?? 0;
    if (rt - rs <= 1) {
      links.push(l);
      continue;
    }
    let prev = l.source;
    let prevSy = l.sy;
    for (let r = rs + 1; r < rt; r++) {
      const id = `__dummy${dummyN++}`;
      items.push({ id, size: { w: 0, h: 24 }, y0: 0 });
      rank.set(id, r);
      links.push({ source: prev, target: id, sy: prevSy, ty: 12 });
      prev = id;
      prevSy = 12;
    }
    links.push({ source: prev, target: l.target, sy: prevSy, ty: l.ty });
  }
  const byId = new Map(items.map((i) => [i.id, i]));

  // Columns, initially ordered by the nodes' current y (stability: an arrange never
  // scrambles what the user already had when there's no crossing reason to). Dummies seed
  // at their endpoints' mean y.
  for (const it of items) {
    if (!realIds.has(it.id)) {
      const ins = links.filter((l) => l.target === it.id);
      const outs = links.filter((l) => l.source === it.id);
      const ys = [
        ...ins.map((l) => byId.get(l.source)?.y0 ?? 0),
        ...outs.map((l) => byId.get(l.target)?.y0 ?? 0),
      ].filter((y) => Number.isFinite(y));
      it.y0 = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
    }
  }
  const ranks = [...new Set([...rank.values()])].sort((a, b) => a - b);
  const colOf = new Map<number, string[]>();
  for (const r of ranks) colOf.set(r, []);
  for (const it of items) colOf.get(rank.get(it.id)!)!.push(it.id);
  for (const col of colOf.values()) col.sort((a, b) => byId.get(a)!.y0 - byId.get(b)!.y0);

  // Barycenter crossing-minimization sweeps over neighbor PORT positions. Ordinal of each
  // node within its column + the link's port offset approximates the jack's real y.
  const inLinks = new Map<string, Link[]>();
  const outLinks = new Map<string, Link[]>();
  for (const l of links) {
    (outLinks.get(l.source) ?? outLinks.set(l.source, []).get(l.source)!).push(l);
    (inLinks.get(l.target) ?? inLinks.set(l.target, []).get(l.target)!).push(l);
  }
  const ordinalY = new Map<string, number>();
  const refreshOrdinals = () => {
    for (const col of colOf.values()) {
      let y = 0;
      for (const id of col) {
        ordinalY.set(id, y);
        y += byId.get(id)!.size.h + ROW_GAP;
      }
    }
  };
  refreshOrdinals();
  const barycenter = (id: string, useIn: boolean, useOut: boolean): number | null => {
    let sum = 0;
    let n = 0;
    if (useIn) {
      for (const l of inLinks.get(id) ?? []) {
        sum += (ordinalY.get(l.source) ?? 0) + l.sy;
        n++;
      }
    }
    if (useOut) {
      for (const l of outLinks.get(id) ?? []) {
        sum += (ordinalY.get(l.target) ?? 0) + l.ty;
        n++;
      }
    }
    return n ? sum / n : null;
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? ranks : [...ranks].reverse();
    for (const r of order) {
      const col = colOf.get(r)!;
      const keyed = col.map((id) => {
        const b = barycenter(id, forward, !forward) ?? barycenter(id, true, true);
        return { id, key: b ?? ordinalY.get(id) ?? 0 };
      });
      keyed.sort((a, b) => a.key - b.key);
      colOf.set(r, keyed.map((k) => k.id));
      refreshOrdinals();
    }
  }

  // Transpose refinement (the classic Sugiyama post-pass): try swapping vertically-adjacent
  // pairs and keep any swap that lowers total crossings — barycenter gets close, this
  // squeezes out the local misorderings it can't see.
  const totalCrossings = (): number => {
    let n = 0;
    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) {
        const a = links[i];
        const b = links[j];
        if (rank.get(a.source) !== rank.get(b.source) || rank.get(a.target) !== rank.get(b.target)) continue;
        const as = (ordinalY.get(a.source) ?? 0) + a.sy;
        const at = (ordinalY.get(a.target) ?? 0) + a.ty;
        const bs = (ordinalY.get(b.source) ?? 0) + b.sy;
        const bt = (ordinalY.get(b.target) ?? 0) + b.ty;
        if ((as - bs) * (at - bt) < 0) n++;
      }
    }
    return n;
  };
  for (let round = 0; round < 4; round++) {
    let improved = false;
    let best = totalCrossings();
    for (const r of ranks) {
      const col = colOf.get(r)!;
      for (let i = 0; i + 1 < col.length; i++) {
        [col[i], col[i + 1]] = [col[i + 1], col[i]];
        refreshOrdinals();
        const after = totalCrossings();
        if (after < best) {
          best = after;
          improved = true;
        } else {
          [col[i], col[i + 1]] = [col[i + 1], col[i]];
          refreshOrdinals();
        }
      }
    }
    if (!improved) break;
  }

  // Coordinates: column x from cumulative max widths + gutter; y stacked in final order,
  // then nudged toward each node's barycenter (order-preserving) so runs stay level.
  const colX = new Map<number, number>();
  let x = 0;
  for (const r of ranks) {
    colX.set(r, x);
    const w = Math.max(...colOf.get(r)!.map((id) => byId.get(id)!.size.w), 1);
    x += w + COL_GUTTER;
  }
  const pos = new Map<string, Pos>();
  for (const r of ranks) {
    const col = colOf.get(r)!;
    // Desired y = barycenter of all neighbors; resolve overlaps top-down preserving order.
    const desired = col.map((id) => barycenter(id, true, true) ?? ordinalY.get(id) ?? 0);
    let cursor = -Infinity;
    col.forEach((id, i) => {
      const h = byId.get(id)!.size.h;
      const y = Math.max(desired[i] - h / 2, cursor);
      pos.set(id, { x: snap(colX.get(r)!), y: snap(y) });
      cursor = snap(y) + h + ROW_GAP;
    });
  }
  // Normalize to (0,0) origin over the REAL items and drop the dummies from the output.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of realItems) {
    const p = pos.get(it.id)!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + it.size.w);
    maxY = Math.max(maxY, p.y + it.size.h);
  }
  const out = new Map<string, Pos>();
  for (const it of realItems) {
    const p = pos.get(it.id)!;
    out.set(it.id, { x: p.x - minX, y: p.y - minY });
  }
  return { pos: out, bbox: { w: maxX - minX, h: maxY - minY } };
}

// ---------------------------------------------------------------------------------------
// Graph extraction: devices+blocks as items, cables as oriented links with port offsets.
// ---------------------------------------------------------------------------------------

function extractGraph(nodes: SigNode[], edges: CableEdgeType[]): { items: Item[]; links: Link[] } {
  const bearing = nodes.filter(isPortBearing);
  const byId = new Map(bearing.map((n) => [n.id, n]));
  const items: Item[] = bearing.map((n) => ({ id: n.id, size: sizeOf(n), y0: n.position.y }));

  const raw: { source: string; target: string; sy: number; ty: number; bidi: boolean }[] = [];
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt || e.source === e.target) continue;
    const sp = src.data.model.ports.find((p) => p.id === e.sourceHandle);
    const tp = tgt.data.model.ports.find((p) => p.id === e.targetHandle);
    const sy = sp && sp.direction === "output" ? approxPortY(outputPorts(src.data.model).findIndex((p) => p.id === sp.id)) : sizeOf(src).h;
    const ty = tp && tp.direction === "input" ? approxPortY(inputPorts(tgt.data.model).findIndex((p) => p.id === tp.id)) : sizeOf(tgt).h;
    raw.push({ source: e.source, target: e.target, sy, ty, bidi: sp?.direction === "bidirectional" && tp?.direction === "bidirectional" });
  }

  // Orientation pre-pass (the Sugiyama framework needs directed edges): signal cables keep
  // their direction; a bidi run is oriented from the lower provisional rank to the higher,
  // so network/USB spurs don't fight the signal flow's left-to-right layering.
  const directed = raw.filter((l) => !l.bidi);
  const provisional = rankLongestPath(items, directed.map((l) => ({ ...l })));
  const links: Link[] = raw.map((l) => {
    if (!l.bidi) return { source: l.source, target: l.target, sy: l.sy, ty: l.ty };
    const rs = provisional.get(l.source) ?? 0;
    const rt = provisional.get(l.target) ?? 0;
    return rs <= rt
      ? { source: l.source, target: l.target, sy: l.sy, ty: l.ty }
      : { source: l.target, target: l.source, sy: l.ty, ty: l.sy };
  });
  return { items, links };
}

// ---------------------------------------------------------------------------------------
// Zone compounding: per-zone sublayouts collapse to super-nodes for the global pass.
// ---------------------------------------------------------------------------------------

type Group = { id: string; zone: ZoneNodeType | null; memberIds: string[] };

function buildGroups(nodes: SigNode[]): Group[] {
  const zones = nodes.filter((n): n is ZoneNodeType => n.type === "zone");
  const claimed = new Set<string>();
  const groups: Group[] = [];
  for (const z of zones) {
    const members = nodesInZone(z, nodes)
      .filter(isPortBearing)
      .filter((m) => !claimed.has(m.id));
    if (members.length === 0) continue;
    members.forEach((m) => claimed.add(m.id));
    groups.push({ id: `zone:${z.id}`, zone: z, memberIds: members.map((m) => m.id) });
  }
  for (const n of nodes) {
    if (isPortBearing(n) && !claimed.has(n.id)) groups.push({ id: `solo:${n.id}`, zone: null, memberIds: [n.id] });
  }
  return groups;
}

/** Compound layered layout: sublayout per group, condensed global pass, expand, re-fit zones. */
function compoundLayered(
  nodes: SigNode[],
  edges: CableEdgeType[],
  seedGroupRanks?: (groups: Group[], links: Link[]) => Map<string, number> | undefined,
): { positions: Map<string, Pos>; zoneRects: Map<string, { x: number; y: number; w: number; h: number }> } {
  const { items, links } = extractGraph(nodes, edges);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const groups = buildGroups(nodes);
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g.memberIds) groupOf.set(id, g.id);

  // Per-group sublayouts (a solo group is its own trivial layout).
  const sub = new Map<string, Layout>();
  for (const g of groups) {
    const memberSet = new Set(g.memberIds);
    const subItems = g.memberIds.map((id) => itemById.get(id)!).filter(Boolean);
    const subLinks = links.filter((l) => memberSet.has(l.source) && memberSet.has(l.target));
    sub.set(g.id, layeredLayout(subItems, subLinks));
  }

  // Condensed graph: groups as items (zone padding baked into the size), inter-group links
  // carrying the member ports' relative Ys within their group.
  const padW = (g: Group) => (g.zone ? 2 * ZONE_PAD : 0);
  const padH = (g: Group) => (g.zone ? ZONE_PAD + ZONE_PAD_TOP : 0);
  const condensedItems: Item[] = groups.map((g) => ({
    id: g.id,
    size: { w: sub.get(g.id)!.bbox.w + padW(g), h: sub.get(g.id)!.bbox.h + padH(g) },
    y0: Math.min(...g.memberIds.map((id) => nodes.find((n) => n.id === id)!.position.y)),
  }));
  const condensedLinks: Link[] = [];
  for (const l of links) {
    const gs = groupOf.get(l.source);
    const gt = groupOf.get(l.target);
    if (!gs || !gt || gs === gt) continue;
    const sPos = sub.get(gs)!.pos.get(l.source)!;
    const tPos = sub.get(gt)!.pos.get(l.target)!;
    condensedLinks.push({ source: gs, target: gt, sy: sPos.y + l.sy, ty: tPos.y + l.ty });
  }
  const seed = seedGroupRanks?.(groups, condensedLinks);
  const global = layeredLayout(condensedItems, condensedLinks, seed);

  // Expand: members at group origin + local offset (+ zone padding); zones re-fit.
  const positions = new Map<string, Pos>();
  const zoneRects = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const g of groups) {
    const origin = global.pos.get(g.id)!;
    const local = sub.get(g.id)!;
    const ox = origin.x + (g.zone ? ZONE_PAD : 0);
    const oy = origin.y + (g.zone ? ZONE_PAD_TOP : 0);
    for (const id of g.memberIds) {
      const p = local.pos.get(id)!;
      positions.set(id, { x: snap(ox + p.x), y: snap(oy + p.y) });
    }
    if (g.zone) {
      zoneRects.set(g.zone.id, {
        x: snap(origin.x),
        y: snap(origin.y),
        w: snap(local.bbox.w + 2 * ZONE_PAD),
        h: snap(local.bbox.h + ZONE_PAD + ZONE_PAD_TOP),
      });
    }
  }
  return { positions, zoneRects };
}

// ---------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------

/** The device with the most cable endpoints — the auto hub. */
export function autoHubId(nodes: SigNode[], edges: CableEdgeType[]): string | null {
  const degree = new Map<string, number>();
  const bearing = new Set(nodes.filter(isPortBearing).map((n) => n.id));
  for (const e of edges) {
    if (bearing.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    if (bearing.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 1; // a hub needs at least 2 connections
  for (const [id, n] of degree) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

/** Signed group ranks for hub mode: the hub's group pins to 0; groups that mostly FEED the
 *  hub's side rank negative (left), groups fed BY it rank positive (right). */
function hubSeed(hubId: string) {
  return (groups: Group[], links: Link[]): Map<string, number> | undefined => {
    const hubGroup = groups.find((g) => g.memberIds.includes(hubId));
    if (!hubGroup) return undefined;
    // BFS distances over the undirected condensed graph.
    const adj = new Map<string, { other: string; toward: boolean }[]>();
    for (const l of links) {
      (adj.get(l.source) ?? adj.set(l.source, []).get(l.source)!).push({ other: l.target, toward: false });
      (adj.get(l.target) ?? adj.set(l.target, []).get(l.target)!).push({ other: l.source, toward: true });
    }
    const dist = new Map<string, number>([[hubGroup.id, 0]]);
    const queue = [hubGroup.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const { other } of adj.get(cur) ?? []) {
        if (!dist.has(other)) {
          dist.set(other, dist.get(cur)! + 1);
          queue.push(other);
        }
      }
    }
    // Side: majority of a group's links pointing INTO the hub side ⇒ upstream (negative).
    const seed = new Map<string, number>([[hubGroup.id, 0]]);
    for (const g of groups) {
      if (g.id === hubGroup.id || !dist.has(g.id)) continue;
      let toward = 0;
      let away = 0;
      for (const l of links) {
        if (l.source === g.id && (dist.get(l.target) ?? Infinity) < dist.get(g.id)!) toward++;
        if (l.target === g.id && (dist.get(l.source) ?? Infinity) < dist.get(g.id)!) away++;
      }
      seed.set(g.id, (toward >= away ? -1 : 1) * dist.get(g.id)!);
    }
    return seed;
  };
}

/** Shelf-pack rectangles toward a target aspect ratio; returns origins in given order. */
function shelfPack(sizes: Size[], gap: number): { origins: Pos[]; bbox: Size } {
  const totalArea = sizes.reduce((s, r) => s + (r.w + gap) * (r.h + gap), 0);
  const targetW = Math.max(Math.sqrt(totalArea * 1.6), ...sizes.map((r) => r.w));
  const origins: Pos[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let maxW = 0;
  for (const r of sizes) {
    if (x > 0 && x + r.w > targetW) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    origins.push({ x: snap(x), y: snap(y) });
    x += r.w + gap;
    rowH = Math.max(rowH, r.h);
    maxW = Math.max(maxW, x);
  }
  return { origins, bbox: { w: maxW, h: y + rowH } };
}

/** Zones-first: interiors laid out, then group boxes packed in cable-affinity order. */
function zonesMode(nodes: SigNode[], edges: CableEdgeType[]) {
  const { items, links } = extractGraph(nodes, edges);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const groups = buildGroups(nodes);
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g.memberIds) groupOf.set(id, g.id);
  const sub = new Map<string, Layout>();
  for (const g of groups) {
    const memberSet = new Set(g.memberIds);
    sub.set(
      g.id,
      layeredLayout(
        g.memberIds.map((id) => itemById.get(id)!).filter(Boolean),
        links.filter((l) => memberSet.has(l.source) && memberSet.has(l.target)),
      ),
    );
  }
  // Affinity order: start at the most-connected group, then greedily append the group most
  // wired to what's already placed (keeps heavily-cabled rooms adjacent).
  const weight = new Map<string, Map<string, number>>();
  for (const l of links) {
    const a = groupOf.get(l.source)!;
    const b = groupOf.get(l.target)!;
    if (a === b) continue;
    (weight.get(a) ?? weight.set(a, new Map()).get(a)!).set(b, ((weight.get(a)?.get(b) ?? 0) + 1));
    (weight.get(b) ?? weight.set(b, new Map()).get(b)!).set(a, ((weight.get(b)?.get(a) ?? 0) + 1));
  }
  const totalW = (id: string) => [...(weight.get(id)?.values() ?? [])].reduce((s, n) => s + n, 0);
  const unplaced = new Set(groups.map((g) => g.id));
  const order: string[] = [];
  while (unplaced.size) {
    let pick: string | null = null;
    let best = -1;
    for (const id of unplaced) {
      const affinity = order.length
        ? order.reduce((s, placed) => s + (weight.get(id)?.get(placed) ?? 0), 0)
        : totalW(id);
      if (affinity > best) {
        best = affinity;
        pick = id;
      }
    }
    order.push(pick!);
    unplaced.delete(pick!);
  }
  const padW = (g: Group) => (g.zone ? 2 * ZONE_PAD : 0);
  const padH = (g: Group) => (g.zone ? ZONE_PAD + ZONE_PAD_TOP : 0);
  const byGroupId = new Map(groups.map((g) => [g.id, g]));
  const sizes = order.map((id) => ({
    w: sub.get(id)!.bbox.w + padW(byGroupId.get(id)!),
    h: sub.get(id)!.bbox.h + padH(byGroupId.get(id)!),
  }));
  const { origins } = shelfPack(sizes, PACK_GAP);
  const positions = new Map<string, Pos>();
  const zoneRects = new Map<string, { x: number; y: number; w: number; h: number }>();
  order.forEach((gid, i) => {
    const g = byGroupId.get(gid)!;
    const origin = origins[i];
    const local = sub.get(gid)!;
    const ox = origin.x + (g.zone ? ZONE_PAD : 0);
    const oy = origin.y + (g.zone ? ZONE_PAD_TOP : 0);
    for (const id of g.memberIds) {
      const p = local.pos.get(id)!;
      positions.set(id, { x: snap(ox + p.x), y: snap(oy + p.y) });
    }
    if (g.zone) {
      zoneRects.set(g.zone.id, {
        x: origin.x,
        y: origin.y,
        w: snap(local.bbox.w + 2 * ZONE_PAD),
        h: snap(local.bbox.h + ZONE_PAD + ZONE_PAD_TOP),
      });
    }
  });
  return { positions, zoneRects };
}

/** Compact grid: pure shelf packing of every port-bearing node (WireCAD-parity baseline). */
function gridMode(nodes: SigNode[]) {
  const bearing = nodes.filter(isPortBearing);
  const ordered = [...bearing].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  const { origins } = shelfPack(ordered.map(sizeOf), ROW_GAP * 2);
  const positions = new Map<string, Pos>();
  ordered.forEach((n, i) => positions.set(n.id, origins[i]));
  // Zones still re-fit around wherever their members landed.
  const zoneRects = new Map<string, { x: number; y: number; w: number; h: number }>();
  return { positions, zoneRects };
}

// ---------------------------------------------------------------------------------------
// Routability refinement: the layout literature optimizes proxy objectives; we have the
// REAL router in-process, so the final placement is polished against actual routed
// crossings. Zone-safe by construction: only two same-height nodes in the same column and
// the same zone group may swap positions (a pure position exchange moves nothing across a
// zone boundary and can't create overlaps).
// ---------------------------------------------------------------------------------------

function refineByRouting(nodes: SigNode[], edges: CableEdgeType[]): SigNode[] {
  const crossingsOf = (nds: SigNode[]) => metricsFromResult(newRouter.route({ nodes: nds, edges })).crossings;
  let best = nodes;
  let bestX = crossingsOf(nodes);
  if (bestX === 0) return best;
  const groups = buildGroups(nodes);
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g.memberIds) groupOf.set(id, g.id);

  for (let round = 0; round < 3; round++) {
    let improved = false;
    const bearing = best.filter(isPortBearing);
    const byCol = new Map<number, SigNode[]>();
    for (const n of bearing) {
      const col = byCol.get(n.position.x);
      if (col) col.push(n);
      else byCol.set(n.position.x, [n]);
    }
    for (const col of byCol.values()) {
      col.sort((a, b) => a.position.y - b.position.y);
      for (let i = 0; i < col.length; i++) {
        for (let j = i + 1; j < col.length; j++) {
          const a = col[i];
          const b = col[j];
          if (Math.abs(sizeOf(a).h - sizeOf(b).h) > 0.5) continue;
          if (groupOf.get(a.id) !== groupOf.get(b.id)) continue;
          const swapped = best.map((n) =>
            n.id === a.id ? { ...n, position: { ...b.position } } : n.id === b.id ? { ...n, position: { ...a.position } } : n,
          );
          const x = crossingsOf(swapped);
          if (x < bestX) {
            best = swapped;
            bestX = x;
            improved = true;
            if (bestX === 0) return best;
          }
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

export function arrangeDiagram(
  nodes: SigNode[],
  edges: CableEdgeType[],
  mode: ArrangeMode,
  opts: { hubId?: string } = {},
): SigNode[] {
  const bearingCount = nodes.filter(isPortBearing).length;
  if (bearingCount === 0) return nodes;

  let result: { positions: Map<string, Pos>; zoneRects: Map<string, { x: number; y: number; w: number; h: number }> };
  switch (mode) {
    case "zones":
      result = zonesMode(nodes, edges);
      break;
    case "hub": {
      const hub = opts.hubId ?? autoHubId(nodes, edges);
      result = hub ? compoundLayered(nodes, edges, hubSeed(hub)) : compoundLayered(nodes, edges);
      break;
    }
    case "grid":
      result = gridMode(nodes);
      break;
    case "flow":
    default:
      result = compoundLayered(nodes, edges);
      break;
  }

  const arranged = nodes.map((n) => {
    const p = result.positions.get(n.id);
    if (p) return { ...n, position: p };
    if (n.type === "zone") {
      const r = result.zoneRects.get(n.id);
      if (r) {
        return {
          ...n,
          position: { x: r.x, y: r.y },
          width: r.w,
          height: r.h,
          style: { ...n.style, width: r.w, height: r.h },
        };
      }
    }
    return n;
  });
  // Grid mode is deliberately flow-agnostic; every other mode gets the router-in-the-loop
  // crossing polish.
  return mode === "grid" ? arranged : refineByRouting(arranged, edges);
}
