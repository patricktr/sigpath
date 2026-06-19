import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { DeviceNode } from "./flow/DeviceNode";
import { arrangeLeftToRight } from "./flow/autoLayout";
import type {
  DeviceNodeType,
  CableEdgeType,
  EditorDiagram,
  SigNode,
  ZoneNodeType,
  NoteNodeType,
} from "./flow/types";
import { CABLE_TYPES, DEFAULT_CABLE_COLOR, cableTypeForPort } from "./schema";
import type { DeviceModel, CableTypeDef } from "./schema";
import { useProject } from "./project/useProject";
import { parseDocument } from "./io/serialize";
import {
  promptSavePath,
  promptOpenPath,
  readTextFromPath,
  writeTextToPath,
  fileStem,
  confirmDeleteDiagram,
  saveText,
  saveBinary,
} from "./io/files";
import { AddDevicePanel } from "./ui/AddDevicePanel";
import { DiagramTabs } from "./ui/DiagramTabs";
import { ZoneNode, ZoneActionsContext, ZONE_COLORS } from "./ui/ZoneNode";
import { NoteNode, NoteActionsContext } from "./ui/NoteNode";
import { Legend } from "./ui/Legend";
import { ListsPanel } from "./ui/ListsPanel";
import { deriveLists } from "./lists/derive";
import type { ExportKind } from "./ui/ExportMenu";
import { diagramImageBase64, diagramPdfBase64, listsToCsv } from "./io/export";
import { ValidationPanel } from "./ui/ValidationPanel";
import { validate, type ValidationIssue } from "./validation/validate";
import "./App.css";
import "./theme-dark.css";

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

  // "Unsaved changes" flag: set on any edit (useProject.onChange), cleared on save/open.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const markDirty = useCallback(() => setDirty(true), []);

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
  } = useProject(initialDiagrams.current, {
    setNodes,
    setEdges,
    nodesRef,
    edgesRef,
    onChange: markDirty,
  });

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [closePrompt, setClosePrompt] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [snap, setSnap] = useState(true);
  const [legendOn, setLegendOn] = useState(true);
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">(() => {
    try {
      const v = localStorage.getItem("sigpath.theme");
      return v === "light" || v === "dark" || v === "system" ? v : "system";
    } catch {
      return "system";
    }
  });
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
  const theme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

  // While following the system, update live as the OS appearance changes.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const addCount = useRef(0);
  const zoneCount = useRef(0);
  const noteCount = useRef(0);
  const rf = useRef<ReactFlowInstance<SigNode, CableEdgeType> | null>(null);

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

  // Grab either end of an existing cable and drop it on another port to re-patch
  // it. The cable type/color is re-derived from the (possibly new) source port,
  // so moving the source end re-types the cable exactly like drawing a fresh one;
  // moving only the target end re-reads the same source, leaving the color intact.
  const onReconnect = useCallback(
    (oldEdge: CableEdgeType, newConnection: Connection) => {
      takeSnapshot();
      const sourceNode = nodes.find((n) => n.id === newConnection.source);
      const port =
        sourceNode?.type === "device"
          ? sourceNode.data.model.ports.find((p) => p.id === newConnection.sourceHandle)
          : undefined;
      const cableTypeId = port ? cableTypeForPort(port.connector, port.signal) : undefined;
      const color = cableTypeId
        ? CABLE_TYPES[cableTypeId]?.color ?? DEFAULT_CABLE_COLOR
        : DEFAULT_CABLE_COLOR;
      const refreshed: CableEdgeType = {
        ...oldEdge,
        style: { ...oldEdge.style, stroke: color, strokeWidth: 2 },
        data: { ...oldEdge.data, cableTypeId: cableTypeId ?? "" },
      };
      setEdges((els) => reconnectEdge(refreshed, newConnection, els));
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

  const handleArrange = useCallback(() => {
    takeSnapshot();
    setNodes((nds) => arrangeLeftToRight(nds, edgesRef.current));
    window.setTimeout(() => rf.current?.fitView({ duration: 400, padding: 0.2 }), 50);
    setStatus("Arranged left-to-right");
  }, [setNodes, takeSnapshot]);

  const handleZoomToZone = useCallback(() => {
    const zone = nodesRef.current.find((n) => n.type === "zone" && n.selected);
    if (!zone || !rf.current) return;
    const width =
      zone.measured?.width ?? (typeof zone.style?.width === "number" ? zone.style.width : 280);
    const height =
      zone.measured?.height ?? (typeof zone.style?.height === "number" ? zone.style.height : 180);
    rf.current.fitBounds(
      { x: zone.position.x, y: zone.position.y, width, height },
      { duration: 400, padding: 0.15 },
    );
  }, []);

  const handleFit = useCallback(() => {
    rf.current?.fitView({ duration: 400, padding: 0.2 });
  }, []);

  // Theme is now chosen from the View ▸ Theme menu (which emits "menu:theme").
  const applyTheme = useCallback((next: "system" | "light" | "dark") => {
    setThemeMode(next);
    try {
      localStorage.setItem("sigpath.theme", next);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const lists = useMemo(() => deriveLists(nodes, edges), [nodes, edges]);
  const validation = useMemo(() => validate(nodes, edges), [nodes, edges]);

  // Overlay validation styling onto the live edges without mutating state:
  // errors are solid red + animated, warnings are dashed amber. A selected edge
  // is then thickened and given a glow halo on top, so a selected error edge
  // still reads as red AND clearly looks selected.
  const displayEdges = useMemo(() => {
    const { errorEdges, warnEdges } = validation;
    if (errorEdges.size === 0 && warnEdges.size === 0 && !edges.some((e) => e.selected)) {
      return edges;
    }
    return edges.map((e) => {
      let style: CSSProperties;
      let animated = e.animated;
      if (errorEdges.has(e.id)) {
        style = { ...e.style, stroke: "#ef4444", strokeWidth: 2.5 };
        animated = true;
      } else if (warnEdges.has(e.id)) {
        style = { ...e.style, stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "6 4" };
      } else {
        style = { ...e.style };
      }
      if (e.selected) {
        const base = typeof style.strokeWidth === "number" ? style.strokeWidth : 2;
        const glow = style.stroke ?? "#3b82f6";
        style = {
          ...style,
          strokeWidth: base + 2,
          filter: `drop-shadow(0 0 2px ${glow}) drop-shadow(0 0 6px ${glow})`,
        };
      }
      return { ...e, style, animated };
    });
  }, [edges, validation]);

  const focusIssue = useCallback(
    (issue: ValidationIssue) => {
      if (issue.edgeId) {
        setEdges((es) => es.map((e) => ({ ...e, selected: e.id === issue.edgeId })));
      }
      if (issue.focusNodeIds.length && rf.current) {
        rf.current.fitView({
          nodes: issue.focusNodeIds.map((id) => ({ id })),
          duration: 400,
          padding: 0.4,
          maxZoom: 1.4,
        });
      }
    },
    [setEdges],
  );

  const handleExport = useCallback(
    async (kind: ExportKind) => {
      try {
        const base = (projectName || "diagram").replace(/\s+/g, "-");
        if (kind === "csv") {
          const saved = await saveText(listsToCsv(lists), `${base}-lists.csv`, "csv");
          if (saved) setStatus(`Exported · ${saved}`);
          return;
        }
        if (!rf.current) return;
        const dark = theme === "dark";
        if (kind === "pdf") {
          const saved = await saveBinary(await diagramPdfBase64(rf.current, dark), `${base}.pdf`, "pdf");
          if (saved) setStatus(`Exported · ${saved}`);
        } else {
          const ext = kind === "png" ? "png" : "jpg";
          const saved = await saveBinary(
            await diagramImageBase64(rf.current, kind, dark),
            `${base}.${ext}`,
            ext,
          );
          if (saved) setStatus(`Exported · ${saved}`);
        }
      } catch (err) {
        setStatus(`Export failed: ${String(err)}`);
      }
    },
    [lists, projectName, theme],
  );

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

  // Cable types actually used in the current diagram, for the legend.
  const usedCableTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of edges) {
      const id = e.data?.cableTypeId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const items: { type: CableTypeDef; count: number }[] = [];
    for (const [id, count] of counts) {
      const type = CABLE_TYPES[id];
      if (type) items.push({ type, count });
    }
    items.sort((a, b) => a.type.label.localeCompare(b.type.label));
    return items;
  }, [edges]);

  // Current selection drives the contextual action bar shown under the toolbar.
  const selection = useMemo(() => {
    const zones = nodes.filter((n): n is ZoneNodeType => n.selected === true && n.type === "zone");
    const devices = nodes.filter(
      (n): n is DeviceNodeType => n.selected === true && n.type === "device",
    );
    const cables = edges.filter((e) => e.selected);
    return { zones, devices, cables };
  }, [nodes, edges]);

  const deviceTotal = useMemo(() => nodes.filter((n) => n.type === "device").length, [nodes]);

  const contextKind: "zone" | "device" | "edge" | null =
    selection.zones.length === 1 && selection.devices.length === 0 && selection.cables.length === 0
      ? "zone"
      : selection.devices.length > 0
        ? "device"
        : selection.cables.length > 0
          ? "edge"
          : null;
  const activeZone = selection.zones[0];

  const deleteSelection = useCallback(() => {
    const delNodes = nodesRef.current.filter((n) => n.selected).map((n) => ({ id: n.id }));
    const delEdges = edgesRef.current.filter((e) => e.selected).map((e) => ({ id: e.id }));
    if (delNodes.length === 0 && delEdges.length === 0) return;
    // deleteElements runs onBeforeDelete, which snapshots for undo.
    void rf.current?.deleteElements({ nodes: delNodes, edges: delEdges });
  }, []);

  const duplicateSelection = useCallback(() => {
    const sel = nodesRef.current.filter((n) => n.selected && n.type === "device");
    if (sel.length === 0) return;
    takeSnapshot();
    const clones: SigNode[] = sel.map((n) => ({
      ...n,
      id: crypto.randomUUID(),
      position: { x: n.position.x + 28, y: n.position.y + 28 },
      selected: false,
    }));
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...clones]);
    setStatus(`Duplicated ${clones.length} device${clones.length === 1 ? "" : "s"}`);
  }, [setNodes, takeSnapshot]);

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

  const handleSave = useCallback(async (): Promise<boolean> => {
    try {
      let path = currentPath;
      if (!path) {
        path = await promptSavePath(`${projectName}.sigpath`);
        if (!path) return false; // cancelled
      }
      await writeTextToPath(path, JSON.stringify(getDocument(), null, 2));
      setCurrentPath(path);
      setProjectName(fileStem(path));
      setDirty(false);
      setStatus(`Saved · ${path}`);
      return true;
    } catch (err) {
      setStatus(`Save failed: ${String(err)}`);
      return false;
    }
  }, [currentPath, projectName, getDocument, setProjectName]);

  // Save As always prompts for a fresh path (File ▸ Save As).
  const handleSaveAs = useCallback(async (): Promise<boolean> => {
    try {
      const path = await promptSavePath(`${projectName}.sigpath`);
      if (!path) return false;
      await writeTextToPath(path, JSON.stringify(getDocument(), null, 2));
      setCurrentPath(path);
      setProjectName(fileStem(path));
      setDirty(false);
      setStatus(`Saved · ${path}`);
      return true;
    } catch (err) {
      setStatus(`Save failed: ${String(err)}`);
      return false;
    }
  }, [projectName, getDocument, setProjectName]);

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
        setDirty(false);
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

  // ⌘W / red-button close: if there are unsaved changes, intercept and prompt.
  const closeWindowNow = useCallback(() => {
    void getCurrentWindow().destroy();
  }, []);
  const onCloseSave = useCallback(async () => {
    setClosePrompt(false);
    if (await handleSave()) closeWindowNow();
  }, [handleSave, closeWindowNow]);
  const onCloseDiscard = useCallback(() => {
    setClosePrompt(false);
    closeWindowNow();
  }, [closeWindowNow]);
  const onCloseCancel = useCallback(() => setClosePrompt(false), []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (!dirtyRef.current) return; // clean — let it close
        event.preventDefault();
        setClosePrompt(true);
      })
      .then((un) => {
        unlisten = un;
      });
    return () => unlisten?.();
  }, []);

  // Undo/Redo, like New/Open/Save, are owned by the native menu accelerators
  // (⌘Z / ⌘⇧Z) and arrive as menu:undo / menu:redo events below.

  // Menu commands arrive as events emitted to this (focused) window from Rust.
  useEffect(() => {
    const unlisteners = [
      listen("menu:open", () => void handleOpen()),
      listen("menu:save", () => void handleSave()),
      listen("menu:saveAs", () => void handleSaveAs()),
      listen<ExportKind>("menu:export", (e) => void handleExport(e.payload)),
      listen("menu:undo", () => undo()),
      listen("menu:redo", () => redo()),
      listen("menu:insertDevice", () => {
        setPaletteOpen(true);
        setListsOpen(false);
        setValidationOpen(false);
      }),
      listen("menu:insertZone", () => addZoneToCanvas()),
      listen("menu:insertNote", () => addNoteToCanvas()),
      listen("menu:fitView", () => handleFit()),
      listen("menu:zoomZone", () => handleZoomToZone()),
      listen<"system" | "light" | "dark">("menu:theme", (e) => applyTheme(e.payload)),
      listen("menu:arrange", () => handleArrange()),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()));
    };
  }, [
    handleOpen,
    handleSave,
    handleSaveAs,
    handleExport,
    undo,
    redo,
    addZoneToCanvas,
    addNoteToCanvas,
    handleFit,
    handleZoomToZone,
    applyTheme,
    handleArrange,
  ]);

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
          setDirty(false);
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
    <div className={theme === "dark" ? "app app--dark" : "app"}>
      <header className="toolbar">
        <span className="toolbar__brand">sigpath</span>
        <div className="toolbar__groups">
          <div className="tgroup">
            <div className="tgroup__seg">
              <button type="button" onClick={addZoneToCanvas} title="Add a zone">
                <span className="tgroup__icon">▢</span>Zone
              </button>
              <button type="button" onClick={addNoteToCanvas} title="Add a note">
                <span className="tgroup__icon">▭</span>Note
              </button>
            </div>
            <span className="tgroup__label">Insert</span>
          </div>

          <div className="tgroup">
            <div className="tgroup__seg">
              <button
                type="button"
                onClick={handleArrange}
                title="Arrange devices left-to-right by signal flow"
              >
                <span className="tgroup__icon">↦</span>Arrange
              </button>
              <button type="button" onClick={handleFit} title="Fit the whole diagram to the view">
                <span className="tgroup__icon">⤢</span>Fit
              </button>
            </div>
            <span className="tgroup__label">Layout</span>
          </div>

          <div className="tgroup">
            <div className="tgroup__seg tgroup__seg--toggle">
              <button
                type="button"
                className={snap ? "is-on" : ""}
                aria-pressed={snap}
                onClick={() => setSnap((v) => !v)}
                title="Snap to grid"
              >
                Snap
              </button>
              <button
                type="button"
                className={legendOn ? "is-on" : ""}
                aria-pressed={legendOn}
                onClick={() => setLegendOn((v) => !v)}
                title="Show cable-type legend"
              >
                Legend
              </button>
              <button
                type="button"
                className={listsOpen ? "is-on" : ""}
                aria-pressed={listsOpen}
                onClick={() => {
                  setListsOpen((v) => !v);
                  setPaletteOpen(false);
                  setValidationOpen(false);
                }}
                title="Pack list & patch list"
              >
                Lists
              </button>
            </div>
            <span className="tgroup__label">View</span>
          </div>
        </div>

        <button
          type="button"
          className="toolbar__primary"
          onClick={() => {
            setPaletteOpen((v) => !v);
            setListsOpen(false);
            setValidationOpen(false);
          }}
        >
          {paletteOpen ? "Close panel" : "+ Add device"}
        </button>

        <span className="toolbar__doc">
          {projectName}
          {dirty ? " · unsaved" : ""}
        </span>
      </header>

      {contextKind && (
        <div className="contextbar">
          {contextKind === "zone" && activeZone && (
            <>
              <span className="contextbar__title">
                <span className="contextbar__dot" style={{ background: activeZone.data.color }} />
                Zone “{activeZone.data.label}”
              </span>
              <span className="contextbar__sep" />
              <div className="contextbar__swatches">
                {ZONE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={
                      c === activeZone.data.color
                        ? "contextbar__swatch is-active"
                        : "contextbar__swatch"
                    }
                    style={{ background: c }}
                    onClick={() => recolorZone(activeZone.id, c)}
                    aria-label={`Set zone color ${c}`}
                  />
                ))}
              </div>
              <span className="contextbar__sep" />
              <button type="button" className="contextbar__btn" onClick={handleZoomToZone}>
                ⤢ Zoom to zone
              </button>
              <button type="button" className="contextbar__btn" onClick={deleteSelection}>
                Delete
              </button>
            </>
          )}
          {contextKind === "device" && (
            <>
              <span className="contextbar__title">
                {selection.devices.length} device{selection.devices.length === 1 ? "" : "s"} selected
              </span>
              <span className="contextbar__sep" />
              <button type="button" className="contextbar__btn" onClick={duplicateSelection}>
                Duplicate
              </button>
              <button type="button" className="contextbar__btn" onClick={deleteSelection}>
                Delete
              </button>
            </>
          )}
          {contextKind === "edge" && (
            <>
              <span className="contextbar__title">
                {selection.cables.length} cable{selection.cables.length === 1 ? "" : "s"} selected
              </span>
              <span className="contextbar__sep" />
              <button type="button" className="contextbar__btn" onClick={deleteSelection}>
                Delete
              </button>
            </>
          )}
        </div>
      )}

      <div className="flow-wrap">
        <ZoneActionsContext.Provider value={zoneActions}>
          <NoteActionsContext.Provider value={noteActions}>
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            reconnectRadius={20}
            onNodeDragStart={onNodeDragStart}
            onSelectionDragStart={onNodeDragStart}
            onBeforeDelete={onBeforeDelete}
            onInit={(inst) => {
              rf.current = inst;
            }}
            snapToGrid={snap}
            snapGrid={[GRID, GRID]}
            defaultEdgeOptions={{ type: "smoothstep" }}
            minZoom={0.1}
            maxZoom={4}
            colorMode={theme}
            fitView
          >
            <Background gap={GRID} />
            <MiniMap pannable zoomable />
            <Controls />
            {legendOn && usedCableTypes.length > 0 && (
              <Panel position="top-right">
                <Legend items={usedCableTypes} />
              </Panel>
            )}
          </ReactFlow>
          </NoteActionsContext.Provider>
        </ZoneActionsContext.Provider>
        {paletteOpen && (
          <AddDevicePanel onAddModel={addModelToCanvas} onClose={() => setPaletteOpen(false)} />
        )}
        {listsOpen && <ListsPanel lists={lists} onClose={() => setListsOpen(false)} />}
        {validationOpen && (
          <ValidationPanel
            result={validation}
            onFocus={focusIssue}
            onClose={() => setValidationOpen(false)}
          />
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

      <footer className="statusbar">
        <button
          type="button"
          className={
            validation.errorCount > 0
              ? "statusbar__val statusbar__val--error"
              : validation.warningCount > 0
                ? "statusbar__val statusbar__val--warn"
                : "statusbar__val statusbar__val--ok"
          }
          aria-pressed={validationOpen}
          onClick={() => {
            setValidationOpen((v) => !v);
            setPaletteOpen(false);
            setListsOpen(false);
          }}
          title="Live signal validation — click for details"
        >
          <span className="statusbar__dot" />
          {validation.errorCount === 0 && validation.warningCount === 0
            ? "All signals valid"
            : [
                validation.errorCount > 0
                  ? `✕ ${validation.errorCount} error${validation.errorCount === 1 ? "" : "s"}`
                  : null,
                validation.warningCount > 0
                  ? `⚠ ${validation.warningCount} warning${validation.warningCount === 1 ? "" : "s"}`
                  : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
        </button>
        <span className="statusbar__sep" />
        <span className="statusbar__item">
          {deviceTotal} device{deviceTotal === 1 ? "" : "s"} · {edges.length} cable
          {edges.length === 1 ? "" : "s"}
        </span>
        <span className="statusbar__msg" title={status}>
          {status}
        </span>
      </footer>

      {closePrompt && (
        <div className="modal-backdrop" onClick={onCloseCancel}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Unsaved changes</h2>
            <p className="modal__body">
              Do you want to save the changes to “{projectName}” before closing?
            </p>
            <div className="modal__actions">
              <button type="button" onClick={onCloseDiscard}>
                Don&rsquo;t Save
              </button>
              <span className="modal__spacer" />
              <button type="button" onClick={onCloseCancel}>
                Cancel
              </button>
              <button type="button" className="modal__primary" onClick={() => void onCloseSave()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
