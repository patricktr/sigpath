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
import type { DeviceNodeType, CableEdgeType } from "./flow/types";
import { toDocument, fromDocument, parseDocument } from "./io/serialize";
import {
  promptSavePath,
  promptOpenPath,
  readTextFromPath,
  writeTextToPath,
  fileStem,
} from "./io/files";
import "./App.css";

/** Registered once at module scope so the reference stays stable across renders. */
const nodeTypes = { device: DeviceNode };

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<DeviceNodeType>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CableEdgeType>(initialEdges);

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [docName, setDocName] = useState("Untitled");
  const [status, setStatus] = useState("");
  const ids = useRef<{ projectId: string; diagramId: string }>({
    projectId: crypto.randomUUID(),
    diagramId: crypto.randomUUID(),
  });

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const handleNew = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setCurrentPath(null);
    setDocName("Untitled");
    ids.current = { projectId: crypto.randomUUID(), diagramId: crypto.randomUUID() };
    setStatus("New diagram");
  }, [setNodes, setEdges]);

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
      setStatus(`Opened · ${path}`);
    } catch (err) {
      setStatus(`Open failed: ${String(err)}`);
    }
  }, [setNodes, setEdges]);

  // Native-app keyboard shortcuts: Cmd/Ctrl+S to save, Cmd/Ctrl+O to open.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      if (ev.key === "s") {
        ev.preventDefault();
        void handleSave();
      } else if (ev.key === "o") {
        ev.preventDefault();
        void handleOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, handleOpen]);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="toolbar__brand">sigpath</span>
        <div className="toolbar__actions">
          <button type="button" onClick={handleNew}>New</button>
          <button type="button" onClick={() => void handleOpen()}>Open…</button>
          <button type="button" onClick={() => void handleSave()}>Save</button>
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
          defaultEdgeOptions={{ type: "smoothstep" }}
          fitView
        >
          <Background />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export default App;
