import { CABLE_TYPES, DEFAULT_CABLE_COLOR, SIGPATH_SCHEMA_VERSION, emptyDiagram } from "../schema";
import type { Connection, DeviceInstance, Diagram, Project, SigpathDocument } from "../schema";
import type { DeviceNodeType, CableEdgeType } from "../flow/types";

/**
 * Maps between the React Flow canvas (nodes + edges) and the persisted
 * {@link SigpathDocument}. Presentation-only details (edge stroke color) are
 * NOT stored — they're derived from the cable type on load — so the saved file
 * stays a clean domain document.
 */

type DocMeta = {
  projectId: string;
  projectName: string;
  diagramId: string;
  diagramName: string;
};

function toDiagram(nodes: DeviceNodeType[], edges: CableEdgeType[], id: string, name: string): Diagram {
  const devices: DeviceInstance[] = nodes.map((n) => ({
    id: n.id,
    model: n.data.model,
    label: n.data.label,
    position: n.position,
  }));

  const connections: Connection[] = edges.map((e) => ({
    id: e.id,
    from: { instanceId: e.source, portId: e.sourceHandle ?? "" },
    to: { instanceId: e.target, portId: e.targetHandle ?? "" },
    cableTypeId: e.data?.cableTypeId ?? "",
    number: e.data?.number,
    lengthMeters: e.data?.lengthMeters,
  }));

  return { ...emptyDiagram(id, name), devices, connections };
}

/** Wrap the current canvas in a complete, versioned document for saving. */
export function toDocument(nodes: DeviceNodeType[], edges: CableEdgeType[], meta: DocMeta): SigpathDocument {
  const diagram = toDiagram(nodes, edges, meta.diagramId, meta.diagramName);
  const project: Project = { id: meta.projectId, name: meta.projectName, diagrams: [diagram] };
  return { schemaVersion: SIGPATH_SCHEMA_VERSION, project };
}

/** Reconstruct canvas nodes/edges from a loaded document's first diagram. */
export function fromDocument(doc: SigpathDocument): {
  nodes: DeviceNodeType[];
  edges: CableEdgeType[];
  diagram: Diagram | null;
} {
  const diagram = doc.project?.diagrams?.[0] ?? null;
  if (!diagram) return { nodes: [], edges: [], diagram: null };

  const nodes: DeviceNodeType[] = diagram.devices.map((d) => ({
    id: d.id,
    type: "device",
    position: d.position,
    data: { model: d.model, label: d.label },
  }));

  const edges: CableEdgeType[] = diagram.connections.map((c) => ({
    id: c.id,
    source: c.from.instanceId,
    target: c.to.instanceId,
    sourceHandle: c.from.portId,
    targetHandle: c.to.portId,
    type: "smoothstep",
    style: { stroke: CABLE_TYPES[c.cableTypeId]?.color ?? DEFAULT_CABLE_COLOR, strokeWidth: 2 },
    data: { cableTypeId: c.cableTypeId, number: c.number, lengthMeters: c.lengthMeters },
  }));

  return { nodes, edges, diagram };
}

/** Parse + minimally validate a loaded JSON string into a document. */
export function parseDocument(json: string): SigpathDocument {
  const data = JSON.parse(json) as SigpathDocument;
  if (!data || typeof data !== "object" || !data.project) {
    throw new Error("Not a valid sigpath document");
  }
  return data;
}
