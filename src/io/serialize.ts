import { cableColor, SIGPATH_SCHEMA_VERSION, emptyDiagram } from "../schema";
import type {
  Annotation,
  Connection,
  DeviceInstance,
  Diagram,
  Project,
  SigpathDocument,
  Zone,
} from "../schema";
import type {
  CableEdgeType,
  DeviceNodeType,
  EditorDiagram,
  NoteNodeType,
  SigNode,
  ZoneNodeType,
} from "../flow/types";

/**
 * Maps between the editor's diagrams (React Flow nodes + edges) and the
 * persisted {@link SigpathDocument}. A `.sigpath` file is one project holding
 * one or more diagrams. Presentation-only details (edge stroke color) are NOT
 * stored — they're derived on load.
 */

function numberOr(value: number | string | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function editorToDiagram(d: EditorDiagram): Diagram {
  const deviceNodes = d.nodes.filter((n): n is DeviceNodeType => n.type === "device");
  const zoneNodes = d.nodes.filter((n): n is ZoneNodeType => n.type === "zone");
  const noteNodes = d.nodes.filter((n): n is NoteNodeType => n.type === "note");

  const devices: DeviceInstance[] = deviceNodes.map((n) => ({
    id: n.id,
    model: n.data.model,
    label: n.data.label,
    position: n.position,
  }));

  const connections: Connection[] = d.edges.map((e) => ({
    id: e.id,
    from: { instanceId: e.source, portId: e.sourceHandle ?? "" },
    to: { instanceId: e.target, portId: e.targetHandle ?? "" },
    cableTypeId: e.data?.cableTypeId ?? "",
    number: e.data?.number,
    lengthMeters: e.data?.lengthMeters,
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
  }));

  const annotations: Annotation[] = noteNodes.map((n) => ({
    id: n.id,
    text: n.data.text,
    position: n.position,
  }));

  return { ...emptyDiagram(d.id, d.name), devices, connections, zones, annotations };
}

function diagramToEditor(d: Diagram): EditorDiagram {
  const deviceNodes: SigNode[] = d.devices.map((dev) => ({
    id: dev.id,
    type: "device",
    position: dev.position,
    data: { model: dev.model, label: dev.label },
  }));

  const zoneNodes: SigNode[] = (d.zones ?? []).map((z) => ({
    id: z.id,
    type: "zone",
    position: { x: z.rect.x, y: z.rect.y },
    width: z.rect.width,
    height: z.rect.height,
    style: { width: z.rect.width, height: z.rect.height },
    zIndex: -1,
    data: { label: z.label, color: z.color },
  }));

  const noteNodes: SigNode[] = (d.annotations ?? []).map((a) => ({
    id: a.id,
    type: "note",
    position: { x: a.position.x, y: a.position.y },
    data: { text: a.text },
  }));

  const edges: CableEdgeType[] = d.connections.map((c) => ({
    id: c.id,
    source: c.from.instanceId,
    target: c.to.instanceId,
    sourceHandle: c.from.portId,
    targetHandle: c.to.portId,
    type: "smoothstep",
    style: { stroke: cableColor(c.cableTypeId), strokeWidth: 2 },
    data: { cableTypeId: c.cableTypeId, number: c.number, lengthMeters: c.lengthMeters },
  }));

  // Zones first so they sit behind devices in the array (zIndex enforces it too).
  return { id: d.id, name: d.name, nodes: [...zoneNodes, ...deviceNodes, ...noteNodes], edges };
}

/** A fresh, empty editor diagram. */
export function emptyEditorDiagram(name = "Diagram 1"): EditorDiagram {
  return { id: crypto.randomUUID(), name, nodes: [], edges: [] };
}

/** Wrap all of the project's diagrams in a versioned document for saving. */
export function toDocument(
  diagrams: EditorDiagram[],
  meta: { projectId: string; projectName: string },
): SigpathDocument {
  const project: Project = {
    id: meta.projectId,
    name: meta.projectName,
    diagrams: diagrams.map(editorToDiagram),
  };
  return { schemaVersion: SIGPATH_SCHEMA_VERSION, project };
}

/** Reconstruct the project (name + all diagrams) from a loaded document. */
export function fromDocument(doc: SigpathDocument): {
  projectId: string;
  projectName: string;
  diagrams: EditorDiagram[];
} {
  const project = doc.project;
  const diagrams = (project?.diagrams ?? []).map(diagramToEditor);
  return {
    projectId: project?.id ?? crypto.randomUUID(),
    projectName: project?.name ?? "Untitled",
    diagrams: diagrams.length > 0 ? diagrams : [emptyEditorDiagram()],
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
