import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
import type {
  DeviceNodeType,
  CableEdgeType,
  EditorDiagram,
  SigNode,
  ZoneNodeType,
  NoteNodeType,
} from "./flow/types";
import { CABLE_TYPES, DEFAULT_CABLE_COLOR, cableTypeForPort } from "./schema";
import type { DeviceModel } from "./schema";
import { useProject } from "./project/useProject";
import { parseDocument } from "./io/serialize";
import {
  promptSavePath,
  promptOpenPath,
  readTextFromPath,
  writeTextToPath,
  fileStem,
  confirmDeleteDiagram,
} from "./io/files";
import { AddDevicePanel } from "./ui/AddDevicePanel";
import { DiagramTabs } from "./ui/DiagramTabs";
import { ZoneNode, ZoneActionsContext, ZONE_COLORS } from "./ui/ZoneNode";
import { NoteNode, NoteActionsContext } from "./ui/NoteNode";
import "./App.css";

/** Registered once at module scope so the reference stays stable across renders. */
const nodeTypes = { device: DeviceNode, zone: ZoneNode, note: NoteNode };

/** Grid size (px) for snap-to-grid and the background dots. */
const GRID = 16;

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<SigNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CableEdgeType>([]);

  // Always-fresh views of the live canvas for the project hook to snapshot.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const initialDiagrams = useRef<EditorDiagram[]>([
    { id: crypto.randomUUID(), name: "Diagram 1", nodes: [], edges: [] },
  ]);

  const {
    projectName,
    setProjectName,
    diagrams,
    activeId,
    switchDiagram,
    addDiagram,
    renameDiagram,
    deleteDiagram,
    getDocument,
    loadProject,
    takeSnapshot,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProject(initialDiagrams.current, { setNodes, setEdges, nodesRef, edgesRef });

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snap, setSnap] = useState(true);
  const addCount = useRef(0);
  const zoneCount = useRef(0);
  const noteCount = useRef(0);

  // Drawing a connection auto-types the cable from the source port's connector.
  const onConnect = useCallback(
    (connection: Connection) => {
      takeSnapshot();
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const port =
        sourceNode?.type === "device"
          ? sourceNode.data.model.ports.find((p) => p.id === connection.sourceHandle)
          : undefined;
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

  const addZoneToCanvas = useCallback(() => {
    takeSnapshot();
    const i = zoneCount.current++;
    const zone: ZoneNodeType = {
      id: crypto.randomUUID(),
      type: "zone",
      position: { x: 40 + (i % 4) * 48, y: 60 + (i % 4) * 48 },
      width: 300,
      height: 200,
      style: { width: 300, height: 200 },
      zIndex: -1,
      data: { label: `Zone ${i + 1}`, color: ZONE_COLORS[i % ZONE_COLORS.length] },
    };
    setNodes((nds) => [...nds, zone]);
    setStatus("Added zone");
  }, [setNodes, takeSnapshot]);

  const addNoteToCanvas = useCallback(() => {
    takeSnapshot();
    const i = noteCount.current++;
    const note: NoteNodeType = {
      id: crypto.randomUUID(),
      type: "note",
      position: { x: 120 + (i % 5) * 36, y: 120 + (i % 5) * 36 },
      data: { text: "" },
    };
    setNodes((nds) => [...nds, note]);
    setStatus("Added note");
  }, [setNodes, takeSnapshot]);

  const renameZone = useCallback(
    (id: string, label: string) => {
      takeSnapshot();
      setNodes((nds) =>
        nds.map((n) => (n.id === id && n.type === "zone" ? { ...n, data: { ...n.data, label } } : n)),
      );
    },
    [setNodes, takeSnapshot],
  );

  const recolorZone = useCallback(
    (id: string, color: string) => {
      takeSnapshot();
      setNodes((nds) =>
        nds.map((n) => (n.id === id && n.type === "zone" ? { ...n, data: { ...n.data, color } } : n)),
      );
    },
    [setNodes, takeSnapshot],
  );

  const zoneActions = useMemo(
    () => ({ rename: renameZone, recolor: recolorZone, beginChange: takeSnapshot }),
    [renameZone, recolorZone, takeSnapshot],
  );

  const setNoteText = useCallback(
    (id: string, text: string) => {
      takeSnapshot();
      setNodes((nds) =>
        nds.map((n) => (n.id === id && n.type === "note" ? { ...n, data: { ...n.data, text } } : n)),
      );
    },
    [setNodes, takeSnapshot],
  );

  const noteActions = useMemo(() => ({ setText: setNoteText }), [setNoteText]);

  // Snapshot before drags and deletions so they can be undone as single steps.
  const onNodeDragStart = useCallback(() => takeSnapshot(), [takeSnapshot]);
  const onBeforeDelete = useCallback(async () => {
    takeSnapshot();
    return true;
  }, [takeSnapshot]);

  const handleDeleteDiagram = useCallback(
    async (id: string) => {
      const name = diagrams.find((d) => d.id === id)?.name ?? "this diagram";
      if (await confirmDeleteDiagram(name)) deleteDiagram(id);
    },
    [diagrams, deleteDiagram],
  );

  const handleNew = useCallback(() => {
    void invoke("new_window");
  }, []);

  const handleSave = useCallback(async () => {
    try {
      let path = currentPath;
      if (!path) {
        path = await promptSavePath(`${projectName}.sigpath`);
        if (!path) return; // cancelled
      }
      await writeTextToPath(path, JSON.stringify(getDocument(), null, 2));
      setCurrentPath(path);
      setProjectName(fileStem(path));
      setStatus(`Saved · ${path}`);
    } catch (err) {
      setStatus(`Save failed: ${String(err)}`);
    }
  }, [currentPath, projectName, getDocument, setProjectName]);

  const handleOpen = useCallback(async () => {
    try {
      const path = await promptOpenPath();
      if (!path) return; // cancelled
      const isBlank =
        currentPath === null && nodesRef.current.length === 0 && edgesRef.current.length === 0;
      if (isBlank) {
        // This window is an untouched blank document — open into it.
        loadProject(parseDocument(await readTextFromPath(path)));
        setCurrentPath(path);
        setProjectName(fileStem(path));
        setStatus(`Opened · ${path}`);
      } else {
        // This window has work in it — open the file in a new window instead.
        await invoke("open_window", { path });
        setStatus(`Opening ${fileStem(path)}…`);
      }
    } catch (err) {
      setStatus(`Open failed: ${String(err)}`);
    }
  }, [currentPath, loadProject, setProjectName]);

  // Undo/redo shortcuts (New/Open/Save are owned by the native menu accelerators).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      const key = ev.key.toLowerCase();
      if (key === "z") {
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
  }, [undo, redo]);

  // File-menu Open/Save arrive as events emitted to this (focused) window from Rust.
  useEffect(() => {
    const unlisteners = [
      listen("menu:open", () => void handleOpen()),
      listen("menu:save", () => void handleSave()),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()));
    };
  }, [handleOpen, handleSave]);

  // On launch, do what this window was created for: load a file, or (the
  // no-windows ⌘O case) show the open dialog and load into this same window.
  useEffect(() => {
    void (async () => {
      try {
        const pending = await invoke<{ kind: string; path?: string } | null>("take_pending_open");
        if (!pending) return;
        if (pending.kind === "file" && pending.path) {
          loadProject(parseDocument(await readTextFromPath(pending.path)));
          setCurrentPath(pending.path);
          setProjectName(fileStem(pending.path));
          setStatus(`Opened · ${pending.path}`);
        } else if (pending.kind === "openDialog") {
          await handleOpen();
        }
      } catch (err) {
        setStatus(`Open failed: ${String(err)}`);
      }
    })();
  }, []);

  // Copy/paste of selected device nodes. Uses the DOM clipboard events so it
  // coexists with the Edit menu's text copy/paste: when a text field is focused
  // we let the default happen; on the canvas we copy/paste devices instead.
  useEffect(() => {
    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onCopy = (e: ClipboardEvent) => {
      if (isTextTarget(e.target)) return;
      const selected = nodesRef.current.filter((n) => n.selected && n.type === "device");
      if (selected.length === 0) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", JSON.stringify({ __sigpath: "devices", nodes: selected }));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTextTarget(e.target)) return;
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      let data: { __sigpath?: string; nodes?: SigNode[] };
      try {
        data = JSON.parse(text);
      } catch {
        return;
      }
      if (data?.__sigpath !== "devices" || !Array.isArray(data.nodes) || data.nodes.length === 0) return;
      e.preventDefault();
      takeSnapshot();
      const clones: SigNode[] = data.nodes.map((n) => ({
        ...n,
        id: crypto.randomUUID(),
        position: { x: n.position.x + 28, y: n.position.y + 28 },
        selected: false,
      }));
      setNodes((nds) => [...nds, ...clones]);
      setStatus(`Pasted ${clones.length} device${clones.length === 1 ? "" : "s"}`);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [setNodes, takeSnapshot]);

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
            className={snap ? "toolbar__toggle toolbar__toggle--on" : "toolbar__toggle"}
            onClick={() => setSnap((v) => !v)}
            aria-pressed={snap}
            title="Snap to grid"
          >
            Snap
          </button>
          <span className="toolbar__sep" />
          <button type="button" onClick={addZoneToCanvas} title="Add a zone">Add zone</button>
          <button type="button" onClick={addNoteToCanvas} title="Add a note">Add note</button>
          <button
            type="button"
            className="toolbar__primary"
            onClick={() => setPaletteOpen((v) => !v)}
          >
            {paletteOpen ? "Close panel" : "Add device"}
          </button>
        </div>
        <span className="toolbar__doc">
          {projectName}
          {currentPath ? "" : " · unsaved"}
        </span>
        <span className="toolbar__status" title={status}>{status}</span>
      </header>

      <div className="flow-wrap">
        <ZoneActionsContext.Provider value={zoneActions}>
          <NoteActionsContext.Provider value={noteActions}>
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
            snapToGrid={snap}
            snapGrid={[GRID, GRID]}
            defaultEdgeOptions={{ type: "smoothstep" }}
            fitView
          >
            <Background gap={GRID} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
          </NoteActionsContext.Provider>
        </ZoneActionsContext.Provider>
        {paletteOpen && (
          <AddDevicePanel onAddModel={addModelToCanvas} onClose={() => setPaletteOpen(false)} />
        )}
      </div>

      <DiagramTabs
        diagrams={diagrams.map((d) => ({ id: d.id, name: d.name }))}
        activeId={activeId}
        onSwitch={switchDiagram}
        onAdd={addDiagram}
        onRename={renameDiagram}
        onDelete={handleDeleteDiagram}
      />
    </div>
  );
}

export default App;
