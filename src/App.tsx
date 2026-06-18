import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { DeviceNode } from "./flow/DeviceNode";
import { initialNodes, initialEdges } from "./flow/sampleGraph";
import { useUndoRedo } from "./flow/useUndoRedo";
import type { DeviceNodeType, CableEdgeType } from "./flow/types";
import { CABLE_TYPES, DEFAULT_CABLE_COLOR, cableTypeForPort } from "./schema";
import type { DeviceModel } from "./schema";
import { toDocument, fromDocument, parseDocument } from "./io/serialize";
import {
  promptSavePath,
  promptOpenPath,
  readTextFromPath,
  writeTextToPath,
  fileStem,
} from "./io/files";
import { AddDevicePanel } from "./ui/AddDevicePanel";
import "./App.css";

/** Registered once at module scope so the reference stays stable across renders. */
const nodeTypes = { device: DeviceNode };

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<DeviceNodeType>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CableEdgeType>(initialEdges);

  const { takeSnapshot, undo, redo, clearHistory, canUndo, canRedo } = useUndoRedo(
    nodes,
    edges,
    setNodes,
    setEdges,
  );

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [docName, setDocName] = useState("Untitled");
  const [status, setStatus] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const ids = useRef<{ projectId: string; diagramId: string }>({
    projectId: crypto.randomUUID(),
    diagramId: crypto.randomUUID(),
  });
  const addCount = useRef(0);

  // Drawing a connection auto-types the cable from the source port's connector.
  const onConnect = useCallback(
    (connection: Connection) => {
      takeSnapshot();
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const port = sourceNode?.data.model.ports.find((p) => p.id === connection.sourceHandle);
      const cableTypeId = port ? cableTypeForPort(port.connector, port.signal) : undefined;
      const color = cableTypeId
        ? CABLE_TYPES[cableTypeId]?.color ?? DEFAULT_CABLE_COLOR
        : DEFAULT_CABLE_COLOR;
      const edge: CableEdgeType = {
        id: `cable-${crypto.randomUUID()}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: "smoothstep",
        style: { stroke: color, strokeWidth: 2 },
        data: { cableTypeId: cableTypeId ?? "" },
      };
      setEdges((eds) => addEdge(edge, eds));
    },
    [nodes, setEdges, takeSnapshot],
  );

  const addModelToCanvas = useCallback(
    (model: DeviceModel) => {
      takeSnapshot();
      const i = addCount.current++;
      const node: DeviceNodeType = {
        id: crypto.randomUUID(),
        type: "device",
        position: { x: 80 + (i % 6) * 32, y: 90 + (i % 6) * 32 },
        data: { model },
      };
      setNodes((nds) => [...nds, node]);
      setStatus(`Added ${model.model}`);
    },
    [setNodes, takeSnapshot],
  );

  // Snapshot before drags and deletions so they can be undone as single steps.
  const onNodeDragStart = useCallback(() => takeSnapshot(), [takeSnapshot]);
  const onBeforeDelete = useCallback(async () => {
    takeSnapshot();
    return true;
  }, [takeSnapshot]);

  const handleNew = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setCurrentPath(null);
    setDocName("Untitled");
    ids.current = { projectId: crypto.randomUUID(), diagramId: crypto.randomUUID() };
    clearHistory();
    setStatus("New diagram");
  }, [setNodes, setEdges, clearHistory]);

  const handleSave = useCallback(async () => {
    try {
      let path = currentPath;
      if (!path) {
        path = await promptSavePath(`${docName}.sigpath`);
        if (!path) return; // cancelled
      }
      const doc = toDocument(nodes, edges, {
        projectId: ids.current.projectId,
        projectName: docName,
        diagramId: ids.current.diagramId,
        diagramName: docName,
      });
      await writeTextToPath(path, JSON.stringify(doc, null, 2));
      setCurrentPath(path);
      setDocName(fileStem(path));
      setStatus(`Saved · ${path}`);
    } catch (err) {
      setStatus(`Save failed: ${String(err)}`);
    }
  }, [currentPath, docName, nodes, edges]);

  const handleOpen = useCallback(async () => {
    try {
      const path = await promptOpenPath();
      if (!path) return; // cancelled
      const doc = parseDocument(await readTextFromPath(path));
      const restored = fromDocument(doc);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setCurrentPath(path);
      setDocName(fileStem(path));
      ids.current = {
        projectId: doc.project.id,
        diagramId: restored.diagram?.id ?? crypto.randomUUID(),
      };
      clearHistory();
      setStatus(`Opened · ${path}`);
    } catch (err) {
      setStatus(`Open failed: ${String(err)}`);
    }
  }, [setNodes, setEdges, clearHistory]);

  // Keyboard shortcuts: ⌘S save, ⌘O open, ⌘Z undo, ⌘⇧Z / ⌘Y redo.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      const key = ev.key.toLowerCase();
      if (key === "s") {
        ev.preventDefault();
        void handleSave();
      } else if (key === "o") {
        ev.preventDefault();
        void handleOpen();
      } else if (key === "z") {
        ev.preventDefault();
        if (ev.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        ev.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, handleOpen, undo, redo]);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="toolbar__brand">sigpath</span>
        <div className="toolbar__actions">
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">Redo</button>
          <span className="toolbar__sep" />
          <button type="button" onClick={handleNew}>New</button>
          <button type="button" onClick={() => void handleOpen()}>Open…</button>
          <button type="button" onClick={() => void handleSave()}>Save</button>
          <button
            type="button"
            className="toolbar__primary"
            onClick={() => setPaletteOpen((v) => !v)}
          >
            {paletteOpen ? "Close panel" : "Add device"}
          </button>
        </div>
        <span className="toolbar__doc">
          {docName}
          {currentPath ? "" : " · unsaved"}
        </span>
        <span className="toolbar__status" title={status}>{status}</span>
      </header>

      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onSelectionDragStart={onNodeDragStart}
          onBeforeDelete={onBeforeDelete}
          defaultEdgeOptions={{ type: "smoothstep" }}
          fitView
        >
          <Background />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
        {paletteOpen && (
          <AddDevicePanel onAddModel={addModelToCanvas} onClose={() => setPaletteOpen(false)} />
        )}
      </div>
    </div>
  );
}

export default App;
