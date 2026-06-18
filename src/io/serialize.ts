import { CABLE_TYPES, DEFAULT_CABLE_COLOR, SIGPATH_SCHEMA_VERSION, emptyDiagram } from "../schema";
import type { Connection, DeviceInstance, Diagram, Project, SigpathDocument } from "../schema";
import type { CableEdgeType, DeviceNodeType, EditorDiagram } from "../flow/types";

/**
 * Maps between the editor's diagrams (React Flow nodes + edges) and the
 * persisted {@link SigpathDocument}. A `.sigpath` file is one project holding
 * one or more diagrams. Presentation-only details (edge stroke color) are NOT
 * stored — they're derived from the cable type on load.
 */

function editorToDiagram(d: EditorDiagram): Diagram {
  const devices: DeviceInstance[] = d.nodes.map((n) => ({
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

  return { ...emptyDiagram(d.id, d.name), devices, connections };
}

function diagramToEditor(d: Diagram): EditorDiagram {
  const nodes: DeviceNodeType[] = d.devices.map((dev) => ({
    id: dev.id,
    type: "device",
    position: dev.position,
    data: { model: dev.model, label: dev.label },
  }));

  const edges: CableEdgeType[] = d.connections.map((c) => ({
    id: c.id,
    source: c.from.instanceId,
    target: c.to.instanceId,
    sourceHandle: c.from.portId,
    targetHandle: c.to.portId,
    type: "smoothstep",
    style: { stroke: CABLE_TYPES[c.cableTypeId]?.color ?? DEFAULT_CABLE_COLOR, strokeWidth: 2 },
    data: { cableTypeId: c.cableTypeId, number: c.number, lengthMeters: c.lengthMeters },
  }));

  return { id: d.id, name: d.name, nodes, edges };
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
