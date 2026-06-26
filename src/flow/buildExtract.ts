import { deriveBoundary, planPromoteZone } from "./nesting";
import { editorToDiagram } from "../io/serialize";
import { BUILD_FORMAT_VERSION, SIGPATH_SCHEMA_VERSION, buildContentHash } from "../schema";
import type { Build, Diagram } from "../schema";
import type { BlockNodeType, CableEdgeType, EditorDiagram, SigNode, ZoneNodeType } from "./types";

/**
 * Extract a zone or tab into a reusable {@link Build} (p2-savebuild). Pure: takes a snapshot
 * of editor diagrams (what `useProject.synced()` holds) and returns a self-contained build
 * record — the saved sub-diagram plus the transitive closure of everything it embeds via
 * blocks, each device carrying its full model snapshot. Reuses the nesting verbs'
 * building blocks (`planPromoteZone`, `deriveBoundary`) so a build is, by construction, a
 * thing the existing `embedTabAsBlock` can later stamp back in.
 */

/** Caller-supplied metadata; ids/timestamps default but can be pinned for deterministic use. */
export type BuildMeta = {
  name: string;
  category?: string;
  author?: string;
  /** Stable build id; defaults to a fresh uuid. */
  id?: string;
  /** Revision; defaults to 1 (bump when re-saving an existing build id). */
  rev?: number;
  /** Epoch ms; defaults to Date.now(). */
  now?: number;
};

/** Cap matching flatten()'s — a hand-edited/cyclic snapshot can't drive closure forever. */
const CLOSURE_DEPTH_CAP = 12;

/**
 * The root editor diagram plus every diagram it transitively embeds through block nodes,
 * root first, de-duplicated. A diagram with no blocks yields just itself. Cycles and runaway
 * depth are bounded (a back-edge is simply not re-visited).
 */
export function collectClosure(rootId: string, diagrams: EditorDiagram[]): EditorDiagram[] {
  const byId = new Map(diagrams.map((d) => [d.id, d]));
  const out: EditorDiagram[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    const d = byId.get(id);
    if (!d || seen.has(id) || depth > CLOSURE_DEPTH_CAP) return;
    seen.add(id);
    out.push(d);
    for (const n of d.nodes) if (n.type === "block") visit(n.data.refDiagramId, depth + 1);
  };
  visit(rootId, 0);
  return out;
}

/** Ensure a diagram publishes a boundary so it can be embedded as a block; auto-derive one
 *  (every un-wired device port) if it has none yet — the same face `embedTabAsBlock` mints. */
function withBoundary(ed: EditorDiagram): EditorDiagram {
  if (ed.boundary && ed.boundary.ports.length > 0) return ed;
  return { ...ed, boundary: deriveBoundary(ed) };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** Does this editor diagram hold any port-bearing content worth saving? */
function hasContent(ed: EditorDiagram): boolean {
  return ed.nodes.some((n) => n.type === "device" || n.type === "block");
}

/** Assemble a Build from an already-persisted closure, stamping metadata + content hash. */
function assembleBuild(diagrams: Diagram[], rootDiagramId: string, meta: BuildMeta): Build {
  const now = meta.now ?? Date.now();
  return {
    formatVersion: BUILD_FORMAT_VERSION,
    id: meta.id ?? crypto.randomUUID(),
    name: meta.name,
    ...(meta.category ? { category: meta.category } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    rev: meta.rev ?? 1,
    contentHash: buildContentHash(diagrams, rootDiagramId),
    createdAt: now,
    updatedAt: now,
    schemaVersion: SIGPATH_SCHEMA_VERSION,
    rootDiagramId,
    diagrams,
  };
}

/**
 * Re-mint every diagram id in a build's closure (rewriting block `refDiagramId`s to match) so
 * a build can be stamped into a project without colliding with existing diagram ids. Returns
 * the fresh diagrams + the new root id. Device / connection / zone / boundary-port ids are
 * diagram-scoped and kept — only diagram ids are project-unique, so this is all the remapping
 * an insert needs. Pure; the caller appends the result and embeds `rootId` as a block.
 */
export function remapBuildIds(build: Build): { diagrams: Diagram[]; rootId: string } {
  const idMap = new Map(build.diagrams.map((d) => [d.id, crypto.randomUUID()]));
  const diagrams = build.diagrams.map((d) => ({
    ...d,
    id: idMap.get(d.id) ?? d.id,
    ...(d.blocks ? { blocks: d.blocks.map((b) => ({ ...b, refDiagramId: idMap.get(b.refDiagramId) ?? b.refDiagramId })) } : {}),
  }));
  return { diagrams, rootId: idMap.get(build.rootDiagramId) ?? build.rootDiagramId };
}

/**
 * Save a whole tab as a build. The tab is the root; its full embed closure rides along so
 * a build that itself contains blocks stays complete (no "Missing tab" on re-insert).
 */
export function extractTabAsBuild(
  rootId: string,
  diagrams: EditorDiagram[],
  meta: BuildMeta,
): Build | { error: string } {
  const root = diagrams.find((d) => d.id === rootId);
  if (!root) return { error: "That tab no longer exists." };
  if (!hasContent(root)) return { error: "This tab is empty — nothing to save." };
  const closure = collectClosure(rootId, diagrams).map(withBoundary).map(editorToDiagram);
  return assembleBuild(closure, rootId, meta);
}

/**
 * Save a zone within a tab as a build. Reuses {@link planPromoteZone} NON-destructively
 * (the host-mutation half of the plan is discarded): the zone's geometric members + their
 * internal cables become the build's root sub-diagram, and cables crossing the zone edge
 * auto-publish boundary ports — so the saved unit exposes exactly the face it had inside the
 * room. Any blocks the zone contained pull their referenced diagrams into the closure too.
 */
export function extractZoneAsBuild(
  zone: ZoneNodeType,
  hostNodes: SigNode[],
  hostEdges: CableEdgeType[],
  diagrams: EditorDiagram[],
  meta: BuildMeta,
): Build | { error: string } {
  const rootDiagramId = crypto.randomUUID();
  // planPromoteZone needs a host-side blockId for the block it would leave behind; we throw
  // that half away and keep only the extracted sub-diagram, so the id is a throwaway.
  const plan = planPromoteZone(zone, hostNodes, hostEdges, { diagramId: rootDiagramId, blockId: crypto.randomUUID() });
  if (plan.subNodes.length === 0) return { error: "The zone is empty — nothing to save." };

  const root: EditorDiagram = {
    id: rootDiagramId,
    name: meta.name || zone.data.label || "Build",
    nodes: plan.subNodes,
    edges: plan.subEdges,
    boundary: plan.boundary,
  };

  // A zone can contain blocks → carry their referenced diagrams (and theirs) into the build.
  const nested = root.nodes
    .filter((n): n is BlockNodeType => n.type === "block")
    .flatMap((n) => collectClosure(n.data.refDiagramId, diagrams));
  const closure = dedupeById([root, ...nested]).map(withBoundary).map(editorToDiagram);
  return assembleBuild(closure, rootDiagramId, meta);
}
