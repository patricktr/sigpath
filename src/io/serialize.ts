import { cableColor, SIGPATH_SCHEMA_VERSION, emptyDiagram } from "../schema";
import type {
  Annotation,
  BlockInstance,
  BoundaryPort,
  Connection,
  DeviceInstance,
  DeviceModel,
  Diagram,
  Project,
  Revision,
  SignalProfile,
  SigpathDocument,
  Zone,
} from "../schema";
import type {
  BlockNodeType,
  CableEdgeType,
  DeviceNodeType,
  EditorDiagram,
  NoteNodeType,
  SigNode,
  ZoneNodeType,
} from "../flow/types";

/** A diagram's published interface, keyed by diagram id — used on load to synthesize
 *  each block's port model from the diagram it references. */
type BoundaryLookup = Map<string, { name: string; ports: BoundaryPort[]; rev: number }>;

/** Build the synthesized DeviceModel a block renders from: its ports ARE the referenced
 *  diagram's boundary ports (BoundaryPort is Port-shaped), so a block resolves through the
 *  same `data.model.ports` seam as a device. Curated-hidden ports are dropped here — the one
 *  seam (p2-zonetab Phase C), so every downstream consumer sees the trimmed, ordered face
 *  with no special-casing. A missing reference yields an empty, clearly-named model rather
 *  than a crash (normalizeDocument flags it — Phase A slice 5). */
export function synthesizeBlockModel(refDiagramId: string, ref?: { name: string; ports: BoundaryPort[] }): DeviceModel {
  return {
    id: `block:${refDiagramId}`,
    model: ref?.name ?? "Missing tab",
    category: "other",
    ports: ref?.ports.filter((p) => !p.hidden) ?? [],
    source: "builtin",
  };
}

/**
 * Maps between the editor's diagrams (React Flow nodes + edges) and the
 * persisted {@link SigpathDocument}. A `.sigpath` file is one project holding
 * one or more diagrams. Presentation-only details (edge stroke color) are NOT
 * stored — they're derived on load.
 */

function numberOr(value: number | string | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

export function editorToDiagram(d: EditorDiagram): Diagram {
  const deviceNodes = d.nodes.filter((n): n is DeviceNodeType => n.type === "device");
  const zoneNodes = d.nodes.filter((n): n is ZoneNodeType => n.type === "zone");
  const noteNodes = d.nodes.filter((n): n is NoteNodeType => n.type === "note");
  const blockNodes = d.nodes.filter((n): n is BlockNodeType => n.type === "block");

  const devices: DeviceInstance[] = deviceNodes.map((n) => ({
    id: n.id,
    model: n.data.model,
    label: n.data.label,
    position: n.position,
    ...(n.data.signalPins ? { signalPins: n.data.signalPins } : {}),
  }));

  const connections: Connection[] = d.edges.map((e) => ({
    id: e.id,
    from: { instanceId: e.source, portId: e.sourceHandle ?? "" },
    to: { instanceId: e.target, portId: e.targetHandle ?? "" },
    cableTypeId: e.data?.cableTypeId ?? "",
    number: e.data?.number,
    lengthMeters: e.data?.lengthMeters,
    note: e.data?.note,
    cableGrade: e.data?.cableGrade,
    signalGrade: e.data?.signalGrade,
    jogOffset: e.data?.jogOffset,
  }));

  const zones: Zone[] = zoneNodes.map((z) => ({
    id: z.id,
    label: z.data.label,
    color: z.data.color,
    rect: {
      x: z.position.x,
      y: z.position.y,
      // NodeResizer writes the live size to `measured`, not `style`, so read that
      // first (falling back to width/height, then the initial style).
      width: z.measured?.width ?? z.width ?? numberOr(z.style?.width, 280),
      height: z.measured?.height ?? z.height ?? numberOr(z.style?.height, 180),
    },
    obstacle: z.data.obstacle,
  }));

  const annotations: Annotation[] = noteNodes.map((n) => ({
    id: n.id,
    text: n.data.text,
    position: n.position,
    obstacle: n.data.obstacle,
  }));

  // Blocks persist only their reference + placement; the synthesized port model is
  // rebuilt from the referenced diagram's boundary on load (never stored).
  const blocks: BlockInstance[] = blockNodes.map((n) => ({
    id: n.id,
    refDiagramId: n.data.refDiagramId,
    label: n.data.label,
    position: n.position,
    obstacle: n.data.obstacle,
    boundaryRev: n.data.boundaryRev,
  }));

  return {
    ...emptyDiagram(d.id, d.name),
    devices,
    connections,
    zones,
    annotations,
    ...(blocks.length ? { blocks } : {}),
    ...(d.boundary ? { boundary: d.boundary } : {}),
    ...(d.trunks?.length ? { trunks: d.trunks } : {}),
  };
}

function diagramToEditor(d: Diagram, boundaryById: BoundaryLookup): EditorDiagram {
  const deviceNodes: SigNode[] = d.devices.map((dev) => ({
    id: dev.id,
    type: "device",
    position: dev.position,
    data: { model: dev.model, label: dev.label, ...(dev.signalPins ? { signalPins: dev.signalPins } : {}) },
  }));

  const blockNodes: SigNode[] = (d.blocks ?? []).map((b) => {
    const ref = boundaryById.get(b.refDiagramId);
    return {
      id: b.id,
      type: "block",
      position: b.position,
      data: {
        refDiagramId: b.refDiagramId,
        label: b.label,
        model: synthesizeBlockModel(b.refDiagramId, ref),
        boundaryRev: b.boundaryRev,
        // Bound to a different published rev than the tab now exposes (rev is a content hash
        // of the boundary, p2-blockdrift). A coarse load-time hint; the live amber flag is
        // computed per render from the room content (hasBoundaryDrift), not this field.
        drift: ref ? b.boundaryRev !== ref.rev : false,
        obstacle: b.obstacle,
      },
    };
  });

  const zoneNodes: SigNode[] = (d.zones ?? []).map((z) => ({
    id: z.id,
    type: "zone",
    position: { x: z.rect.x, y: z.rect.y },
    width: z.rect.width,
    height: z.rect.height,
    style: { width: z.rect.width, height: z.rect.height },
    zIndex: -1,
    data: { label: z.label, color: z.color, obstacle: z.obstacle },
  }));

  const noteNodes: SigNode[] = (d.annotations ?? []).map((a) => ({
    id: a.id,
    type: "note",
    position: { x: a.position.x, y: a.position.y },
    data: { text: a.text, obstacle: a.obstacle },
  }));

  const edges: CableEdgeType[] = d.connections.map((c) => ({
    id: c.id,
    source: c.from.instanceId,
    target: c.to.instanceId,
    sourceHandle: c.from.portId,
    targetHandle: c.to.portId,
    type: "cable",
    style: { stroke: cableColor(c.cableTypeId), strokeWidth: 2 },
    data: {
      cableTypeId: c.cableTypeId,
      number: c.number,
      lengthMeters: c.lengthMeters,
      note: c.note,
      cableGrade: c.cableGrade,
      signalGrade: c.signalGrade,
      jogOffset: c.jogOffset,
    },
  }));

  // Zones first so they sit behind devices in the array (zIndex enforces it too).
  return {
    id: d.id,
    name: d.name,
    nodes: [...zoneNodes, ...deviceNodes, ...blockNodes, ...noteNodes],
    edges,
    ...(d.boundary ? { boundary: d.boundary } : {}),
    ...(d.trunks ? { trunks: d.trunks } : {}),
  };
}

/** A fresh, empty editor diagram. */
export function emptyEditorDiagram(name = "Diagram 1"): EditorDiagram {
  return { id: crypto.randomUUID(), name, nodes: [], edges: [] };
}

/** Wrap all of the project's diagrams in a versioned document for saving. */
export function toDocument(
  diagrams: EditorDiagram[],
  meta: { projectId: string; projectName: string; signalProfile?: SignalProfile; revisions?: Revision[] },
): SigpathDocument {
  const project: Project = {
    id: meta.projectId,
    name: meta.projectName,
    diagrams: diagrams.map(editorToDiagram),
    ...(meta.signalProfile ? { signalProfile: meta.signalProfile } : {}),
    ...(meta.revisions && meta.revisions.length ? { revisions: meta.revisions } : {}),
  };
  return { schemaVersion: SIGPATH_SCHEMA_VERSION, project };
}

/** Reconstruct the project (name + all diagrams + signal profile + history) from a loaded document. */
export function fromDocument(doc: SigpathDocument): {
  projectId: string;
  projectName: string;
  diagrams: EditorDiagram[];
  signalProfile?: SignalProfile;
  revisions: Revision[];
} {
  const project = normalizeDocument(doc).project;
  // Index every diagram's published interface first, so a block can synthesize its port
  // model from the diagram it references (which may be defined after it in the array).
  const boundaryById: BoundaryLookup = new Map();
  for (const dg of project?.diagrams ?? []) {
    if (dg.boundary) boundaryById.set(dg.id, { name: dg.name, ports: dg.boundary.ports, rev: dg.boundary.rev });
  }
  const diagrams = (project?.diagrams ?? []).map((dg) => diagramToEditor(dg, boundaryById));
  return {
    projectId: project?.id ?? crypto.randomUUID(),
    projectName: project?.name ?? "Untitled",
    diagrams: diagrams.length > 0 ? diagrams : [emptyEditorDiagram()],
    signalProfile: project?.signalProfile,
    revisions: project?.revisions ?? [],
  };
}

/** Parse + minimally validate a loaded JSON string into a document. */
export function parseDocument(json: string): SigpathDocument {
  const data = JSON.parse(json) as SigpathDocument;
  if (!data || typeof data !== "object" || !data.project) {
    throw new Error("Not a valid sigpath document");
  }
  return data;
}

/**
 * Drop any block whose reference would close an embed cycle — self-embed (A → A) or a
 * back-edge (A → B → A) — so a hand-edited or future file can't drive flatten()/render
 * into infinite recursion. Standard DFS: a ref to a diagram currently on the recursion
 * stack is the offending block. Cables to a dropped block then resolve to nothing and
 * surface as a normal "Broken connection" in validation rather than hanging the app.
 */
function breakEmbedCycles(diagrams: Diagram[]): Diagram[] {
  const byId = new Map(diagrams.map((d) => [d.id, d]));
  const dropped = new Set<string>(); // `${hostId}::${blockId}`
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    onStack.add(id);
    for (const b of byId.get(id)?.blocks ?? []) {
      if (b.refDiagramId === id || onStack.has(b.refDiagramId)) dropped.add(`${id}::${b.id}`);
      else if (byId.has(b.refDiagramId)) visit(b.refDiagramId);
    }
    onStack.delete(id);
    done.add(id);
  };
  for (const d of diagrams) visit(d.id);
  if (dropped.size === 0) return diagrams;
  return diagrams.map((d) =>
    d.blocks ? { ...d, blocks: d.blocks.filter((b) => !dropped.has(`${d.id}::${b.id}`)) } : d,
  );
}

/**
 * Loader hygiene run on every document before it becomes editor state: guarantees a
 * non-empty diagram list and breaks block-embed cycles. Pure — returns a cleaned
 * document; the original is untouched. (Endpoint integrity is left to validation, which
 * already surfaces a dangling cable as "Broken connection" rather than dropping it.)
 */
export function normalizeDocument(doc: SigpathDocument): SigpathDocument {
  const project = doc.project ?? { id: crypto.randomUUID(), name: "Untitled", diagrams: [] };
  const acyclic = breakEmbedCycles(project.diagrams ?? []);
  const diagrams = acyclic.length ? acyclic : [emptyDiagram(crypto.randomUUID(), "Diagram 1")];
  return { ...doc, project: { ...project, diagrams } };
}
