import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { CableEdgeType, DeviceNodeType, EditorDiagram } from "../flow/types";
import { emptyEditorDiagram, fromDocument, toDocument } from "../io/serialize";
import type { SigpathDocument } from "../schema";

type Options = {
  setNodes: (nodes: DeviceNodeType[]) => void;
  setEdges: (edges: CableEdgeType[]) => void;
  /** Always-fresh view of the live canvas, so the active diagram can be synced. */
  nodesRef: MutableRefObject<DeviceNodeType[]>;
  edgesRef: MutableRefObject<CableEdgeType[]>;
};

/** Undo unit = the whole project: every diagram plus which one is active. */
type ProjectSnapshot = { diagrams: EditorDiagram[]; activeId: string };

const MAX_HISTORY = 100;

/**
 * Owns the open project (name + diagrams + active diagram) AND its undo history.
 * Undo operates at the project level, so it covers both canvas edits and
 * structural changes (add / delete / rename diagram), and works across switches.
 * The active diagram's live content lives in React Flow state; the matching
 * `diagrams` entry is synced on demand (snapshot / switch / save).
 */
export function useProject(initial: EditorDiagram[], opts: Options) {
  const { setNodes, setEdges, nodesRef, edgesRef } = opts;

  const projectId = useRef<string>(crypto.randomUUID());
  const [projectName, setProjectName] = useState("Untitled");
  const [diagrams, setDiagrams] = useState<EditorDiagram[]>(initial);
  const [activeId, setActiveId] = useState<string>(initial[0]?.id ?? "");

  const past = useRef<ProjectSnapshot[]>([]);
  const future = useRef<ProjectSnapshot[]>([]);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  /** Current diagrams with the active one synced from the live canvas. */
  const synced = useCallback(
    (): EditorDiagram[] =>
      diagrams.map((d) =>
        d.id === activeId ? { ...d, nodes: nodesRef.current, edges: edgesRef.current } : d,
      ),
    [diagrams, activeId, nodesRef, edgesRef],
  );

  const loadActive = useCallback(
    (list: EditorDiagram[], id: string) => {
      const active = list.find((d) => d.id === id) ?? list[0];
      if (active) {
        setNodes(active.nodes);
        setEdges(active.edges);
      }
    },
    [setNodes, setEdges],
  );

  /** Capture the whole project. Call BEFORE any edit (canvas or structural). */
  const takeSnapshot = useCallback(() => {
    past.current = [...past.current, { diagrams: synced(), activeId }].slice(-MAX_HISTORY);
    future.current = [];
    rerender();
  }, [synced, activeId, rerender]);

  const clearHistory = useCallback(() => {
    past.current = [];
    future.current = [];
    rerender();
  }, [rerender]);

  const apply = useCallback(
    (snap: ProjectSnapshot) => {
      setDiagrams(snap.diagrams);
      setActiveId(snap.activeId);
      loadActive(snap.diagrams, snap.activeId);
    },
    [loadActive],
  );

  const undo = useCallback(() => {
    const previous = past.current[past.current.length - 1];
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [{ diagrams: synced(), activeId }, ...future.current];
    apply(previous);
    rerender();
  }, [synced, activeId, apply, rerender]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, { diagrams: synced(), activeId }];
    apply(next);
    rerender();
  }, [synced, activeId, apply, rerender]);

  // Switching is navigation, not an edit: no snapshot, history preserved.
  const switchDiagram = useCallback(
    (id: string) => {
      if (id === activeId) return;
      const cur = synced();
      const target = cur.find((d) => d.id === id);
      if (!target) return;
      setDiagrams(cur);
      setActiveId(id);
      setNodes(target.nodes);
      setEdges(target.edges);
    },
    [activeId, synced, setNodes, setEdges],
  );

  const addDiagram = useCallback(() => {
    takeSnapshot();
    const cur = synced();
    const created = emptyEditorDiagram(`Diagram ${cur.length + 1}`);
    setDiagrams([...cur, created]);
    setActiveId(created.id);
    setNodes(created.nodes);
    setEdges(created.edges);
  }, [takeSnapshot, synced, setNodes, setEdges]);

  const renameDiagram = useCallback(
    (id: string, name: string) => {
      takeSnapshot();
      setDiagrams((ds) => ds.map((d) => (d.id === id ? { ...d, name } : d)));
    },
    [takeSnapshot],
  );

  const deleteDiagram = useCallback(
    (id: string) => {
      takeSnapshot();
      const remaining = synced().filter((d) => d.id !== id);
      if (remaining.length === 0) {
        const fresh = emptyEditorDiagram("Diagram 1");
        setDiagrams([fresh]);
        setActiveId(fresh.id);
        loadActive([fresh], fresh.id);
        return;
      }
      setDiagrams(remaining);
      if (id === activeId) {
        setActiveId(remaining[0].id);
        loadActive(remaining, remaining[0].id);
      }
    },
    [takeSnapshot, synced, activeId, loadActive],
  );

  /** Snapshot the whole project (active diagram synced) for saving. */
  const getDocument = useCallback(
    (): SigpathDocument => toDocument(synced(), { projectId: projectId.current, projectName }),
    [synced, projectName],
  );

  const loadProject = useCallback(
    (doc: SigpathDocument) => {
      const parsed = fromDocument(doc);
      projectId.current = parsed.projectId;
      setProjectName(parsed.projectName);
      setDiagrams(parsed.diagrams);
      setActiveId(parsed.diagrams[0].id);
      loadActive(parsed.diagrams, parsed.diagrams[0].id);
      clearHistory();
    },
    [loadActive, clearHistory],
  );

  const newProject = useCallback(() => {
    projectId.current = crypto.randomUUID();
    setProjectName("Untitled");
    const fresh = emptyEditorDiagram("Diagram 1");
    setDiagrams([fresh]);
    setActiveId(fresh.id);
    loadActive([fresh], fresh.id);
    clearHistory();
  }, [loadActive, clearHistory]);

  return {
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
    newProject,
    takeSnapshot,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
