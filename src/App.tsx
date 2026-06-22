import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  useUpdateNodeInternals,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { DeviceNode } from "./flow/DeviceNode";
import { CableEdge } from "./flow/CableEdge";
import { arrangeLeftToRight } from "./flow/autoLayout";
import type {
  DeviceNodeType,
  CableEdgeType,
  EditorDiagram,
  SigNode,
  ZoneNodeType,
  NoteNodeType,
} from "./flow/types";
import { cableColor, cableLabel, deviceTitle } from "./schema";
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
  saveText,
  saveBinary,
} from "./io/files";
import { AddDeviceOverlay } from "./ui/AddDevice/AddDeviceOverlay";
import { CreateWizard } from "./ui/AddDevice/CreateWizard";
import { addToPersonalLibrary } from "./library/personalLibrary";
import { hydrateCatalogFromCache, checkForCatalogUpdate } from "./library/catalogUpdate";
import type { AddSurface } from "./ui/AddDevice/addDevice";
import { DiagramTabs } from "./ui/DiagramTabs";
import { ZoneNode, ZoneActionsContext, ZONE_COLORS } from "./ui/ZoneNode";
import { NoteNode, NoteActionsContext } from "./ui/NoteNode";
import { ListsPanel } from "./ui/ListsPanel";
import { deriveLists } from "./lists/derive";
import {
  cablePrefixFromConnector,
  formatCableId,
  nextCableNumber,
  renumberCables,
} from "./lists/cableId";
import { loadCatalog } from "./ui/AddDevice/addDevice";
import { findConverters, type ConverterCandidate } from "./library/converters";
import {
  getConverterDefault,
  setConverterDefault,
  loadConverterDefaults,
  clearConverterDefault,
  converterPairKey,
} from "./library/userPrefs";
import { diagramImageBase64, diagramPdfBase64, listsToCsv, type ExportKind } from "./io/export";
import { ValidationPanel } from "./ui/ValidationPanel";
import { validate, type ValidationIssue } from "./validation/validate";
import { LeftRail } from "./ui/LeftRail";
import { Inspector } from "./ui/Inspector";
import "./App.css";

/** Registered once at module scope so the reference stays stable across renders. */
const nodeTypes = { device: DeviceNode, zone: ZoneNode, note: NoteNode };
const edgeTypes = { cable: CableEdge };

/** Grid size (px) for snap-to-grid and the background dots. */
const GRID = 24;

function AppInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<SigNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CableEdgeType>([]);
  // React Flow caches each node's handle bounds at mount; editing a device's ports
  // changes its handles, so we must tell React Flow to re-measure (otherwise a new
  // port's handle is unknown and a cable dropped on it resolves to a phantom).
  const updateNodeInternals = useUpdateNodeInternals();

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
    signalProfile,
    setSignalProfile,
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
  const [addSurface, setAddSurface] = useState<AddSurface>("none");
  // Device being edited, and the placed node it came from (if any).
  const [editModel, setEditModel] = useState<DeviceModel | null>(null);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const [addToast, setAddToast] = useState<string | null>(null);
  // When a mismatch has >1 candidate converter (and no learned default), the user
  // picks one here; the connector pair is kept so the pick can be remembered.
  const [converterChoice, setConverterChoice] = useState<{
    edgeId: string;
    label: string;
    candidates: ConverterCandidate[];
    srcConn: string;
    tgtConn: string;
    /** The remembered default's model id, if any (marked in the chooser). */
    defaultId?: string;
  } | null>(null);
  // When the library has no converter for a mismatch, pre-fill the create wizard.
  const [converterDraft, setConverterDraft] = useState<{
    edgeId: string;
    seed: DeviceModel;
    srcConn: string;
    tgtConn: string;
  } | null>(null);
  // Preferences modal (currently: learned converter defaults).
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefRows, setPrefRows] = useState<
    { pairKey: string; pairLabel: string; deviceName: string }[]
  >([]);
  const [listsOpen, setListsOpen] = useState(false);
  const [closePrompt, setClosePrompt] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [snap, setSnap] = useState(true);
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
  const flowWrapRef = useRef<HTMLDivElement>(null);

  // Drawing a connection auto-types the cable from the source port's connector.
  const onConnect = useCallback(
    (connection: Connection) => {
      takeSnapshot();
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const port =
        sourceNode?.type === "device"
          ? sourceNode.data.model.ports.find((p) => p.id === connection.sourceHandle)
          : undefined;
      const cableTypeId = port?.connector;
      const color = cableColor(cableTypeId);
      // Auto-number the run: next free in its signal group's sequence (VID-001…),
      // computed against the live edges so rapid draws don't collide.
      setEdges((eds) => {
        const prefix = cablePrefixFromConnector(cableTypeId);
        const edge: CableEdgeType = {
          id: `cable-${crypto.randomUUID()}`,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          type: "cable",
          style: { stroke: color, strokeWidth: 2 },
          data: {
            cableTypeId: cableTypeId ?? "",
            number: formatCableId(prefix, nextCableNumber(prefix, eds)),
          },
        };
        return addEdge(edge, eds);
      });
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
      const cableTypeId = port?.connector;
      const color = cableColor(cableTypeId);
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
      // Spawn at the center of the current viewport — when adding, the cursor is
      // over the device picker, so center-of-view is the useful anchor. Offset by
      // ~half a node so it lands centered, snap to grid, and drift a little per
      // add so a rapid burst doesn't stack on one spot.
      const snap = (v: number) => Math.round(v / GRID) * GRID;
      const wrap = flowWrapRef.current;
      const inst = rf.current;
      let position = { x: 80 + (i % 6) * 32, y: 90 + (i % 6) * 32 };
      if (wrap && inst) {
        const r = wrap.getBoundingClientRect();
        const c = inst.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        const drift = (i % 6) * GRID;
        position = { x: snap(c.x - 100 + drift), y: snap(c.y - 40 + drift) };
      }
      const node: DeviceNodeType = {
        id: crypto.randomUUID(),
        type: "device",
        position,
        data: { model },
      };
      setNodes((nds) => [...nds, node]);
      setStatus(`Added ${model.model}`);
    },
    [setNodes, takeSnapshot],
  );

  // Place a device from the Add-Device flow, then show a toast and close.
  const placeDevice = useCallback(
    (model: DeviceModel) => {
      addModelToCanvas(model);
      setAddToast(`Placed “${deviceTitle(model)}” on canvas`);
      setAddSurface("none");
    },
    [addModelToCanvas],
  );

  // ⌘K → Quick Switcher, ⌘⇧K → Equipment Database.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setAddSurface(e.shiftKey ? "browser" : "palette");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!addToast) return;
    const t = window.setTimeout(() => setAddToast(null), 1900);
    return () => window.clearTimeout(t);
  }, [addToast]);

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
  const validation = useMemo(
    () => validate(nodes, edges, signalProfile),
    [nodes, edges, signalProfile],
  );

  // Overlay validation styling onto the live edges without mutating state:
  // errors are solid red + animated, warnings are dashed amber. A selected edge
  // is then thickened and given a glow halo on top, so a selected error edge
  // still reads as red AND clearly looks selected.
  const displayEdges = useMemo<CableEdgeType[]>(() => {
    const { errorEdges, warnEdges } = validation;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const portColor = (nodeId: string, handleId: string | null | undefined): string | undefined => {
      const n = byId.get(nodeId);
      const port =
        n?.type === "device" ? n.data.model.ports.find((p) => p.id === handleId) : undefined;
      return port ? cableColor(port.connector) : undefined;
    };
    return edges.map((e) => {
      let style: CSSProperties;
      let animated = e.animated;
      let data = e.data;
      if (errorEdges.has(e.id)) {
        style = { ...e.style, stroke: "#ef4444", strokeWidth: 2.5 };
        animated = true;
      } else if (warnEdges.has(e.id)) {
        style = { ...e.style, stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "6 4" };
      } else {
        style = { ...e.style };
        // A valid run whose two ends differ in color is a transition/adapter cable —
        // stroke it with a source→target gradient (the cable that is the converter).
        const from = portColor(e.source, e.sourceHandle);
        const to = portColor(e.target, e.targetHandle);
        if (from && to && from !== to) {
          data = { ...(e.data ?? { cableTypeId: "" }), gradient: { from, to } };
        }
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
      return { ...e, style, animated, data };
    });
  }, [edges, validation, nodes]);

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

  // Cable legend, transition-aware: straight runs by type + named passive adapter
  // cables (HDMI→Mini-HDMI, ¼"→3.5mm). Mirrors the Lists-panel "Cables & adapters"
  // data so the rail and the lists always agree. Converters/PSUs aren't cables.
  const usedCableTypes = useMemo(() => {
    const items = [
      ...lists.cables.map((c) => ({ id: c.id, label: c.label, color: c.color, count: c.count })),
      ...lists.adapters
        .filter((a) => a.kind !== "converter")
        .map((a) => ({ id: a.key, label: a.label, color: a.color, count: a.count })),
    ];
    items.sort((a, b) => a.label.localeCompare(b.label));
    return items;
  }, [lists]);

  // Current selection drives the contextual action bar shown under the toolbar.
  const selection = useMemo(() => {
    const zones = nodes.filter((n): n is ZoneNodeType => n.selected === true && n.type === "zone");
    const devices = nodes.filter(
      (n): n is DeviceNodeType => n.selected === true && n.type === "device",
    );
    const cables = edges.filter((e) => e.selected);
    return { zones, devices, cables };
  }, [nodes, edges]);

  // The single selected cable: its resolved (transition-aware) type label, and —
  // only when the source is a combo jack — the connector choices to override it with.
  const selectedCable = useMemo(() => {
    if (selection.cables.length !== 1) return null;
    const e = selection.cables[0];
    const srcNode = nodes.find((n) => n.id === e.source);
    const srcPort =
      srcNode?.type === "device"
        ? srcNode.data.model.ports.find((p) => p.id === e.sourceHandle)
        : undefined;
    const comboOptions =
      srcPort?.accepts && srcPort.accepts.length ? [srcPort.connector, ...srcPort.accepts] : null;
    const label = lists.patches.find((p) => p.id === e.id)?.cableType ?? "";
    return { edge: e, comboOptions, label };
  }, [selection.cables, nodes, lists.patches]);

  // The selected cable's id if it's a convertible mismatch (so the contextbar can
  // offer "Add converter" too, mirroring the validation panel).
  const selectedConverterEdgeId = useMemo(() => {
    if (selection.cables.length !== 1) return null;
    const id = selection.cables[0].id;
    return validation.issues.some((i) => i.action?.type === "add-converter" && i.action.edgeId === id)
      ? id
      : null;
  }, [selection.cables, validation.issues]);

  const deviceTotal = useMemo(() => nodes.filter((n) => n.type === "device").length, [nodes]);

  const railDevices = useMemo(
    () =>
      nodes
        .filter((n): n is DeviceNodeType => n.type === "device")
        .map((n) => ({
          id: n.id,
          title: deviceTitle(n.data.model, n.data.label),
          tag: (n.data.model.type ?? n.data.model.category).slice(0, 3).toUpperCase(),
        })),
    [nodes],
  );
  const inspectorDevice = selection.devices.length === 1 ? selection.devices[0] : null;
  const selectedNodeId = inspectorDevice?.id ?? null;
  const selectNode = useCallback(
    (id: string) => setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id }))),
    [setNodes],
  );

  // Open the editor on the single selected device.
  const editSelectedDevice = useCallback(() => {
    if (!inspectorDevice) return;
    setEditModel(inspectorDevice.data.model);
    setEditNodeId(inspectorDevice.id);
  }, [inspectorDevice]);

  const cancelEdit = useCallback(() => {
    setEditModel(null);
    setEditNodeId(null);
  }, []);

  // Save an edit: update the placed node's model, re-type cables leaving any
  // changed port (cable type derives from the source port), and upsert the
  // (custom) model into the personal library so the fix persists for reuse.
  const saveEdit = useCallback(
    (m: DeviceModel) => {
      takeSnapshot();
      if (editNodeId) {
        const nodeId = editNodeId;
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId && n.type === "device" ? { ...n, data: { ...n.data, model: m } } : n,
          ),
        );
        setEdges((eds) =>
          eds.map((e) => {
            if (e.source !== nodeId) return e;
            const port = m.ports.find((p) => p.id === e.sourceHandle);
            if (!port) return e;
            return {
              ...e,
              style: { ...e.style, stroke: cableColor(port.connector), strokeWidth: 2 },
              data: { ...e.data, cableTypeId: port.connector },
            };
          }),
        );
        // The edited model may add, remove, or re-side ports — re-measure the node's
        // handles so cables can attach to the new ports (and stale ones detach).
        updateNodeInternals(nodeId);
      }
      addToPersonalLibrary(m);
      setEditModel(null);
      setEditNodeId(null);
      setStatus(`Updated ${m.model}`);
    },
    [editNodeId, setNodes, setEdges, takeSnapshot, updateNodeInternals],
  );

  // Override a cable's type (e.g. pick TRS vs XLR on a combo run). Flows into the
  // pack/patch list via cableTypeId and re-colors the edge.
  const setCableType = useCallback(
    (edgeId: string, cableTypeId: string) => {
      takeSnapshot();
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                style: { ...e.style, stroke: cableColor(cableTypeId), strokeWidth: 2 },
                data: { ...e.data, cableTypeId },
              }
            : e,
        ),
      );
    },
    [setEdges, takeSnapshot],
  );

  // Set a cable's human ID. Snapshot is taken on focus (see the input), so typing
  // a multi-character ID is a single undo step, not one per keystroke.
  const setCableId = useCallback(
    (edgeId: string, number: string) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId ? { ...e, data: { ...(e.data ?? { cableTypeId: "" }), number } } : e,
        ),
      );
    },
    [setEdges],
  );

  // Set a cable's run length in meters (undefined clears it). Snapshot on focus.
  const setCableLength = useCallback(
    (edgeId: string, lengthMeters: number | undefined) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId
            ? { ...e, data: { ...(e.data ?? { cableTypeId: "" }), lengthMeters } }
            : e,
        ),
      );
    },
    [setEdges],
  );

  // Re-sequence every cable's ID by signal group (VID-001, VID-002, AUD-001…).
  const renumberAll = useCallback(() => {
    takeSnapshot();
    setEdges((eds) => renumberCables(eds, nodesRef.current));
  }, [setEdges, takeSnapshot]);

  // Resolve a cable's two device ports (the input/output it runs between).
  const cablePorts = useCallback((edgeId: string) => {
    const edge = edgesRef.current.find((e) => e.id === edgeId);
    if (!edge) return null;
    const src = nodesRef.current.find((n) => n.id === edge.source);
    const tgt = nodesRef.current.find((n) => n.id === edge.target);
    if (!src || !tgt || src.type !== "device" || tgt.type !== "device") return null;
    const srcPort = src.data.model.ports.find((p) => p.id === edge.sourceHandle);
    const tgtPort = tgt.data.model.ports.find((p) => p.id === edge.targetHandle);
    if (!srcPort || !tgtPort) return null;
    return { edge, src, tgt, srcPort, tgtPort };
  }, []);

  // Splice a chosen converter into a mismatched run: drop the device at the run's
  // midpoint, wire source→converter-in and converter-out→target (like-to-like,
  // auto-numbered), and delete the original bad cable — all one undo step.
  const insertConverter = useCallback(
    (edgeId: string, cand: ConverterCandidate) => {
      const ctx = cablePorts(edgeId);
      if (!ctx) return;
      const { edge, src, tgt, srcPort } = ctx;
      takeSnapshot();
      const convId = crypto.randomUUID();
      const mid = (a: number, b: number) => Math.round((a + b) / 2 / GRID) * GRID;
      const convNode: DeviceNodeType = {
        id: convId,
        type: "device",
        position: { x: mid(src.position.x, tgt.position.x), y: mid(src.position.y, tgt.position.y) },
        data: { model: cand.model },
      };
      setNodes((nds) => [...nds, convNode]);
      setEdges((eds) => {
        const working = eds.filter((e) => e.id !== edgeId);
        const run = (
          source: string,
          sourceHandle: string | null | undefined,
          target: string,
          targetHandle: string | null | undefined,
          connector: string | undefined,
        ) => {
          const prefix = cablePrefixFromConnector(connector);
          working.push({
            id: `cable-${crypto.randomUUID()}`,
            source,
            target,
            sourceHandle,
            targetHandle,
            type: "cable",
            style: { stroke: cableColor(connector), strokeWidth: 2 },
            data: { cableTypeId: connector ?? "", number: formatCableId(prefix, nextCableNumber(prefix, working)) },
          });
        };
        run(edge.source, edge.sourceHandle, convId, cand.inPort.id, srcPort.connector);
        run(convId, cand.outPort.id, edge.target, edge.targetHandle, cand.outPort.connector);
        return working;
      });
      setStatus(`Inserted ${cand.model.model}`);
    },
    [cablePorts, setNodes, setEdges, takeSnapshot],
  );

  // Entry point from the validation panel / contextbar: find candidate converters
  // for a mismatched cable and either insert the only one, open a chooser, or
  // report that the library has none.
  const requestAddConverter = useCallback(
    (edgeId: string) => {
      const ctx = cablePorts(edgeId);
      if (!ctx) return;
      const { srcPort, tgtPort } = ctx;
      const candidates = findConverters(srcPort, tgtPort, loadCatalog());
      const label = `${cableLabel(srcPort.connector)} → ${cableLabel(tgtPort.connector)}`;
      if (candidates.length === 0) {
        // Nothing in the library bridges this — open the create wizard pre-filled
        // with the right in/out ports so the user can model the converter once.
        const a = cableLabel(srcPort.connector);
        const b = cableLabel(tgtPort.connector);
        setConverterDraft({
          edgeId,
          srcConn: srcPort.connector,
          tgtConn: tgtPort.connector,
          seed: {
            id: "draft",
            model: `${a} → ${b} converter`,
            category: "converter",
            type: "Converter",
            source: "custom",
            ports: [
              { id: crypto.randomUUID(), name: `${a} In`, direction: "input", connector: srcPort.connector },
              { id: crypto.randomUUID(), name: `${b} Out`, direction: "output", connector: tgtPort.connector },
            ],
          },
        });
        return;
      }
      // Only one bridge — just use it. With a real choice, always open the chooser
      // so the remembered default can be overridden (the default is marked + first).
      if (candidates.length === 1) {
        insertConverter(edgeId, candidates[0]);
        setAddToast(`Inserted ${candidates[0].model.model}`);
        return;
      }
      const defaultId = getConverterDefault(srcPort.connector, tgtPort.connector);
      const ordered = [...candidates].sort(
        (a, b) => Number(b.model.id === defaultId) - Number(a.model.id === defaultId),
      );
      setConverterChoice({
        edgeId,
        label,
        candidates: ordered,
        srcConn: srcPort.connector,
        tgtConn: tgtPort.connector,
        defaultId,
      });
    },
    [cablePorts, insertConverter],
  );

  // Preferences: build the learned converter-defaults list (pair → device).
  const openPreferences = useCallback(() => {
    const byId = new Map(loadCatalog().map((m) => [m.id, m]));
    const rows = Object.entries(loadConverterDefaults()).map(([pairKey, modelId]) => {
      const [src, tgt] = pairKey.split(">");
      const m = byId.get(modelId);
      return {
        pairKey,
        pairLabel: `${cableLabel(src)} → ${cableLabel(tgt)}`,
        deviceName: m
          ? m.manufacturer
            ? `${m.manufacturer} ${m.model}`
            : m.model
          : "(removed device)",
      };
    });
    setPrefRows(rows);
    setPrefsOpen(true);
  }, []);

  const clearPref = useCallback((pairKey: string) => {
    clearConverterDefault(pairKey);
    setPrefRows((rows) => rows.filter((r) => r.pairKey !== pairKey));
  }, []);

  // Reflect the resolved theme on <html> so the token system swaps.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  // Latest menu handlers, read live through a ref so the listener effect can
  // register exactly once. If the effect instead depended on these callbacks,
  // it would re-run on every edit (handleExport → lists → nodes/edges) and —
  // because Tauri's listen()/unlisten are async — leak duplicate listeners, so
  // one menu command fires N times (e.g. "Insert Zone" spawning several zones).
  const menuActions = {
    open: handleOpen,
    save: handleSave,
    saveAs: handleSaveAs,
    export: handleExport,
    undo,
    redo,
    insertDevice: () => setAddSurface("palette"),
    insertZone: addZoneToCanvas,
    insertNote: addNoteToCanvas,
    fitView: handleFit,
    zoomZone: handleZoomToZone,
    theme: applyTheme,
    arrange: handleArrange,
  };
  const menuActionsRef = useRef(menuActions);
  menuActionsRef.current = menuActions;

  // Menu commands arrive as events emitted to this (focused) window from Rust.
  // Registered once; `track` makes the async (un)listen leak-proof under React
  // StrictMode's mount→unmount→mount — if cleanup runs before listen() resolves,
  // the resolved unlisten fires immediately instead of being stranded.
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      void p.then((un) => (disposed ? un() : cleanups.push(un)));
    };
    track(listen("menu:open", () => void menuActionsRef.current.open()));
    track(listen("menu:save", () => void menuActionsRef.current.save()));
    track(listen("menu:saveAs", () => void menuActionsRef.current.saveAs()));
    track(listen<ExportKind>("menu:export", (e) => void menuActionsRef.current.export(e.payload)));
    track(listen("menu:undo", () => menuActionsRef.current.undo()));
    track(listen("menu:redo", () => menuActionsRef.current.redo()));
    track(listen("menu:insertDevice", () => menuActionsRef.current.insertDevice()));
    track(listen("menu:insertZone", () => menuActionsRef.current.insertZone()));
    track(listen("menu:insertNote", () => menuActionsRef.current.insertNote()));
    track(listen("menu:fitView", () => menuActionsRef.current.fitView()));
    track(listen("menu:zoomZone", () => menuActionsRef.current.zoomZone()));
    track(listen<"system" | "light" | "dark">("menu:theme", (e) => menuActionsRef.current.theme(e.payload)));
    track(listen("menu:arrange", () => menuActionsRef.current.arrange()));
    return () => {
      disposed = true;
      cleanups.forEach((un) => un());
    };
  }, []);

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

  // Pull community-catalog updates on launch: a cached snapshot supersedes the
  // bundled one immediately; then a (non-blocking) network check applies a newer
  // one if the catalog source is configured. Toast only on an actual update.
  useEffect(() => {
    void (async () => {
      await hydrateCatalogFromCache();
      try {
        const r = await checkForCatalogUpdate();
        if (r.status === "updated") {
          setAddToast(`Community catalog updated · rev ${r.rev} · ${r.count} devices`);
        }
      } catch {
        /* sync is best-effort — the bundled/cached catalog still works offline */
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
        <div className="brand">
          <svg className="brand__mark" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="19" cy="13" r="4.5" fill="#3b82f6" />
            <circle cx="33" cy="13" r="4.5" fill="#22c55e" />
            <circle cx="19" cy="24" r="4.5" fill="#8b5cf6" />
            <circle cx="33" cy="24" r="4.5" fill="#06b6d4" />
            <circle cx="19" cy="35" r="4.5" fill="#f59e0b" />
            <circle cx="33" cy="35" r="4.5" fill="#ef4444" />
          </svg>
          <span className="brand__name">SIGPATH</span>
          <span className="brand__div" />
          <span className="brand__doc">
            {projectName}
            {dirty ? " ·" : ""}
          </span>
        </div>
        <span className="toolbar__spacer" />
        <div className="theme-toggle" role="group" aria-label="Theme">
          <button
            type="button"
            className={theme === "light" ? "is-on" : ""}
            onClick={() => applyTheme("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={theme === "dark" ? "is-on" : ""}
            onClick={() => applyTheme("dark")}
          >
            Dark
          </button>
        </div>
        <button
          type="button"
          className={validationOpen ? "tbtn is-on" : "tbtn"}
          onClick={() => {
            setValidationOpen((v) => !v);
            setListsOpen(false);
          }}
        >
          Validate
        </button>
        <button
          type="button"
          className={listsOpen ? "tbtn is-on" : "tbtn"}
          onClick={() => {
            setListsOpen((v) => !v);
            setValidationOpen(false);
          }}
        >
          Lists
        </button>
        <button
          type="button"
          className="tbtn"
          onClick={openPreferences}
          title="Preferences"
          aria-label="Preferences"
        >
          ⚙
        </button>
        <button
          type="button"
          className="tbtn tbtn--primary"
          onClick={() => setAddSurface("palette")}
          title="Add device (⌘K)"
        >
          ＋ Add device <span className="kbd">⌘K</span>
        </button>
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
              {selection.devices.length === 1 && (
                <button type="button" className="contextbar__btn" onClick={editSelectedDevice}>
                  Edit
                </button>
              )}
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
              {selectedCable && (
                <>
                  <label
                    className="contextbar__title"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}
                  >
                    ID
                    <input
                      value={selectedCable.edge.data?.number ?? ""}
                      placeholder="VID-001"
                      onFocus={() => takeSnapshot()}
                      onChange={(e) => setCableId(selectedCable.edge.id, e.target.value)}
                      style={{ width: 92 }}
                    />
                  </label>
                  <label
                    className="contextbar__title"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}
                  >
                    Length
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={selectedCable.edge.data?.lengthMeters ?? ""}
                      onFocus={() => takeSnapshot()}
                      onChange={(e) =>
                        setCableLength(
                          selectedCable.edge.id,
                          e.target.value === "" ? undefined : Number(e.target.value),
                        )
                      }
                      style={{ width: 60 }}
                    />
                    m
                  </label>
                </>
              )}
              {selectedCable &&
                (selectedCable.comboOptions ? (
                  <label
                    className="contextbar__title"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}
                  >
                    Cable type
                    <select
                      value={selectedCable.edge.data?.cableTypeId ?? ""}
                      onChange={(e) => setCableType(selectedCable.edge.id, e.target.value)}
                    >
                      {selectedCable.comboOptions.map((c) => (
                        <option key={c} value={c}>
                          {cableLabel(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span
                    className="contextbar__title"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}
                  >
                    Cable type
                    <strong style={{ fontWeight: 600 }}>{selectedCable.label}</strong>
                  </span>
                ))}
              {selectedConverterEdgeId && (
                <button
                  type="button"
                  className="contextbar__btn"
                  onClick={() => requestAddConverter(selectedConverterEdgeId)}
                >
                  ＋ Add converter
                </button>
              )}
              <button type="button" className="contextbar__btn" onClick={deleteSelection}>
                Delete
              </button>
            </>
          )}
        </div>
      )}

      <div className="workspace">
        <LeftRail
          cables={usedCableTypes}
          devices={railDevices}
          selectedId={selectedNodeId}
          onSelect={selectNode}
        />
        <div className="canvas-wrap" ref={flowWrapRef}>
          <ZoneActionsContext.Provider value={zoneActions}>
            <NoteActionsContext.Provider value={noteActions}>
              <ReactFlow
                nodes={nodes}
                edges={displayEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
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
                defaultEdgeOptions={{ type: "cable" }}
                minZoom={0.1}
                maxZoom={4}
                colorMode={theme}
                fitView
              >
                <Background
                  id="minor"
                  variant={BackgroundVariant.Lines}
                  gap={GRID}
                  color="var(--grid-minor)"
                />
                <Background
                  id="major"
                  variant={BackgroundVariant.Lines}
                  gap={GRID * 5}
                  color="var(--grid-major)"
                />
                <MiniMap pannable zoomable />
                <Controls />
              </ReactFlow>
            </NoteActionsContext.Provider>
          </ZoneActionsContext.Provider>
          {listsOpen && (
            <ListsPanel
              lists={lists}
              onClose={() => setListsOpen(false)}
              onRenumber={renumberAll}
            />
          )}
          {validationOpen && (
            <ValidationPanel
              result={validation}
              videoFormat={signalProfile?.videoFormat}
              onSetVideoFormat={(format) => {
                setSignalProfile((p) => ({ ...p, videoFormat: format }));
                markDirty();
              }}
              onFocus={focusIssue}
              onClose={() => setValidationOpen(false)}
              onAddConverter={requestAddConverter}
            />
          )}
        </div>
        <Inspector
          model={inspectorDevice?.data.model ?? null}
          label={inspectorDevice?.data.label}
        />
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
              : validation.needsShowFormat
                ? "statusbar__val statusbar__val--needs-format"
                : validation.warningCount > 0
                  ? "statusbar__val statusbar__val--warn"
                  : "statusbar__val statusbar__val--ok"
          }
          onClick={() => {
            setValidationOpen((v) => !v);
            setListsOpen(false);
          }}
          title="Live signal validation"
        >
          <span className="statusbar__dot" />
          {validation.errorCount === 0 &&
          validation.warningCount === 0 &&
          !validation.needsShowFormat
            ? "0 Errors"
            : [
                validation.errorCount > 0
                  ? `${validation.errorCount} Error${validation.errorCount === 1 ? "" : "s"}`
                  : null,
                validation.needsShowFormat ? "Set show format" : null,
                validation.warningCount > 0
                  ? `${validation.warningCount} Warning${validation.warningCount === 1 ? "" : "s"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </button>
        <span className="statusbar__item">{deviceTotal} Devices</span>
        <span className="statusbar__item">{edges.length} Links</span>
        <span className="statusbar__spacer" />
        <button
          type="button"
          className={snap ? "statusbar__snap is-on" : "statusbar__snap"}
          onClick={() => setSnap((v) => !v)}
        >
          Snap {snap ? "On" : "Off"}
        </button>
        <span className="statusbar__item">Grid {GRID}px</span>
        <span className="statusbar__msg" title={status}>
          {status}
        </span>
      </footer>

      {addSurface !== "none" && (
        <AddDeviceOverlay
          surface={addSurface}
          onSurface={setAddSurface}
          onPlace={placeDevice}
          onClose={() => setAddSurface("none")}
        />
      )}
      {editModel && (
        <div className="adv-scrim" onMouseDown={cancelEdit}>
          <div className="adv-stop" onMouseDown={(e) => e.stopPropagation()}>
            <CreateWizard
              key={editModel.id}
              initial={editModel}
              onSave={saveEdit}
              onCancel={cancelEdit}
              onSaved={() => {}}
              onPlace={() => {}}
            />
          </div>
        </div>
      )}
      {converterDraft && (
        <div className="adv-scrim" onMouseDown={() => setConverterDraft(null)}>
          <div className="adv-stop" onMouseDown={(e) => e.stopPropagation()}>
            <CreateWizard
              seed={converterDraft.seed}
              onCancel={() => setConverterDraft(null)}
              onSaved={() => {}}
              onPlace={(m) => {
                // "Save & add to canvas" → splice the new converter into the run.
                const inPort =
                  m.ports.find((p) => p.direction === "input" && p.connector === converterDraft.srcConn) ??
                  m.ports.find((p) => p.direction === "input");
                const outPort =
                  m.ports.find((p) => p.direction === "output" && p.connector === converterDraft.tgtConn) ??
                  m.ports.find((p) => p.direction === "output");
                if (inPort && outPort) {
                  insertConverter(converterDraft.edgeId, { model: m, inPort, outPort, score: 0 });
                  setConverterDefault(converterDraft.srcConn, converterDraft.tgtConn, m.id);
                  setAddToast(`Inserted ${m.model}`);
                } else {
                  setAddToast(`Saved ${m.model} to your library`);
                }
                setConverterDraft(null);
              }}
            />
          </div>
        </div>
      )}
      {addToast && (
        <div className="adv-toast" role="status">
          {addToast}
        </div>
      )}

      {converterChoice && (
        <div className="modal-backdrop" onClick={() => setConverterChoice(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Add a converter</h2>
            <p className="modal__body">
              <strong>{converterChoice.label}</strong> —{" "}
              {converterChoice.defaultId
                ? "your default is marked; pick another to override it."
                : "pick a converter from your library:"}
            </p>
            <ul className="cvt-list">
              {converterChoice.candidates.map((c) => (
                <li key={c.model.id}>
                  <button
                    type="button"
                    className={`cvt-row${c.model.id === converterChoice.defaultId ? " cvt-row--default" : ""}`}
                    onClick={() => {
                      insertConverter(converterChoice.edgeId, c);
                      setConverterDefault(converterChoice.srcConn, converterChoice.tgtConn, c.model.id);
                      setAddToast(`Inserted ${c.model.model} · saved as default`);
                      setConverterChoice(null);
                    }}
                  >
                    <span className="cvt-row__top">
                      <span className="cvt-row__name">
                        {c.model.manufacturer ? `${c.model.manufacturer} ${c.model.model}` : c.model.model}
                      </span>
                      {c.model.id === converterChoice.defaultId && (
                        <span className="cvt-row__badge">★ Default</span>
                      )}
                    </span>
                    <span className="cvt-row__io">
                      {cableLabel(c.inPort.connector)} in → {cableLabel(c.outPort.connector)} out
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="modal__actions">
              {converterChoice.defaultId && (
                <button
                  type="button"
                  onClick={() => {
                    clearConverterDefault(
                      converterPairKey(converterChoice.srcConn, converterChoice.tgtConn),
                    );
                    setConverterChoice((prev) => (prev ? { ...prev, defaultId: undefined } : null));
                  }}
                >
                  Clear default
                </button>
              )}
              <span className="modal__spacer" />
              <button type="button" onClick={() => setConverterChoice(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {prefsOpen && (
        <div className="modal-backdrop" onClick={() => setPrefsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Preferences</h2>
            <p className="modal__body">
              Converter defaults — the device used to auto-fix each mismatch, learned when
              you pick one from the converter chooser.
            </p>
            {prefRows.length === 0 ? (
              <p className="modal__body" style={{ fontStyle: "italic" }}>
                No converter defaults yet. Pick a converter once and it’s remembered here.
              </p>
            ) : (
              <ul className="cvt-list">
                {prefRows.map((r) => (
                  <li className="pref-row" key={r.pairKey}>
                    <span className="pref-row__text">
                      <span className="cvt-row__io">{r.pairLabel}</span>
                      <span className="cvt-row__name">{r.deviceName}</span>
                    </span>
                    <button type="button" className="pref-row__clear" onClick={() => clearPref(r.pairKey)}>
                      Clear
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal__actions">
              <button type="button" onClick={() => setPrefsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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

// useUpdateNodeInternals (and React Flow's store) need the provider in an ancestor;
// App renders the canvas as a child, so wrap the whole app in one.
export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
