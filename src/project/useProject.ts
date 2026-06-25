import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { CableEdgeType, SigNode, EditorDiagram, ZoneNodeType } from "../flow/types";
import { deriveBoundary, embedWouldCycle, makeBlockNode, planPromoteZone } from "../flow/nesting";
import { emptyEditorDiagram, fromDocument, toDocument } from "../io/serialize";
import { pruneRevisions, snapshotHash } from "./revisions";
import { SIGPATH_SCHEMA_VERSION } from "../schema";
import type { Revision, RevisionSnapshot, SigpathDocument, SignalProfile } from "../schema";

type Options = {
  setNodes: (nodes: SigNode[]) => void;
  setEdges: (edges: CableEdgeType[]) => void;
  /** Always-fresh view of the live canvas, so the active diagram can be synced. */
  nodesRef: MutableRefObject<SigNode[]>;
  edgesRef: MutableRefObject<CableEdgeType[]>;
  /** Called whenever project content changes (edit / undo / redo), to flag "unsaved". */
  onChange?: () => void;
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
  const { setNodes, setEdges, nodesRef, edgesRef, onChange } = opts;

  const projectId = useRef<string>(crypto.randomUUID());
  const [projectName, setProjectName] = useState("Untitled");
  // Project-wide signal demand ceiling for grade validation (schema v2). Held here so
  // it round-trips through save/load; the show-format selector (Phase C) drives it.
  const [signalProfile, setSignalProfile] = useState<SignalProfile | undefined>(undefined);
  const [diagrams, setDiagrams] = useState<EditorDiagram[]>(initial);
  const [activeId, setActiveId] = useState<string>(initial[0]?.id ?? "");

  // Embedded revision history (p2-revisions). Mirrored to a ref so getDocument() / save can
  // read the just-captured list synchronously, before the state update re-renders.
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const revisionsRef = useRef<Revision[]>([]);
  revisionsRef.current = revisions;

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
    onChange?.();
    rerender();
  }, [synced, activeId, onChange, rerender]);

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
    onChange?.();
    rerender();
  }, [synced, activeId, apply, onChange, rerender]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, { diagrams: synced(), activeId }];
    apply(next);
    onChange?.();
    rerender();
  }, [synced, activeId, apply, onChange, rerender]);

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

  /** Move `draggedId` to sit at `targetId`'s position (tab reorder). Persisted order, so
   *  it's a snapshot'd, undoable edit. activeId is unchanged. */
  const reorderDiagrams = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;
      const cur = synced();
      const from = cur.findIndex((d) => d.id === draggedId);
      const to = cur.findIndex((d) => d.id === targetId);
      if (from < 0 || to < 0) return;
      takeSnapshot();
      const next = cur.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setDiagrams(next);
    },
    [synced, takeSnapshot, setDiagrams],
  );

  /** How many blocks in OTHER diagrams reference this diagram — so a delete can warn the
   *  user those blocks will degrade to "Missing tab" placeholders (decision 5). Counts
   *  the live canvas via synced(), so it's accurate for the active diagram too. */
  const blockRefCount = useCallback(
    (id: string): number => {
      let count = 0;
      for (const d of synced()) {
        if (d.id === id) continue;
        for (const n of d.nodes) if (n.type === "block" && n.data.refDiagramId === id) count += 1;
      }
      return count;
    },
    [synced],
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

  /**
   * Embed another diagram into the active one as a block (p2-zonetab). Non-destructive:
   * nothing moves — a reference block is inserted. Auto-exposes the target's interface if
   * it has none yet (persisted so every embed shares one boundary), and rejects anything
   * that would create an embed cycle. Returns an error message, or null on success.
   */
  const embedTabAsBlock = useCallback(
    (refDiagramId: string, position: { x: number; y: number } = { x: 96, y: 96 }): string | null => {
      const cur = synced();
      const target = cur.find((d) => d.id === refDiagramId);
      if (!target) return "That diagram no longer exists.";
      if (embedWouldCycle(cur, activeId, refDiagramId)) {
        return refDiagramId === activeId
          ? "A diagram can't embed itself."
          : "That would create a circular reference.";
      }
      takeSnapshot();
      // Reuse the target's published interface, or auto-expose + persist one on first embed.
      let boundary = target.boundary;
      let diagrams = cur;
      if (!boundary || boundary.ports.length === 0) {
        boundary = deriveBoundary(target);
        diagrams = cur.map((d) => (d.id === refDiagramId ? { ...d, boundary } : d));
      }
      const block = makeBlockNode(refDiagramId, target.name, boundary, position);
      setDiagrams(diagrams);
      setNodes([...nodesRef.current, block]);
      return null;
    },
    [synced, activeId, takeSnapshot, setDiagrams, setNodes, nodesRef],
  );

  /**
   * Promote a zone in the ACTIVE diagram into its own tab (p2-zonetab). Destructive but
   * atomic + undoable (decision 2 — move, not copy): the zone's contained nodes and their
   * internal cables move into a new sub-diagram; cables crossing the zone edge auto-publish
   * a boundary port and re-point onto a block that replaces the zone. Stays on the host so
   * the collapsed block is visible. Returns how many devices moved, or an error.
   */
  const promoteZoneToTab = useCallback(
    (zoneId: string): { ok: boolean; movedDevices: number; error?: string } => {
      const zone = nodesRef.current.find((n) => n.id === zoneId && n.type === "zone") as
        | ZoneNodeType
        | undefined;
      if (!zone) return { ok: false, movedDevices: 0, error: "Zone not found." };
      const diagramId = crypto.randomUUID();
      const blockId = crypto.randomUUID();
      const plan = planPromoteZone(zone, nodesRef.current, edgesRef.current, { diagramId, blockId });
      if (plan.subNodes.length === 0) {
        return { ok: false, movedDevices: 0, error: "The zone is empty — nothing to promote." };
      }
      takeSnapshot();
      const subDiagram: EditorDiagram = {
        id: diagramId,
        name: zone.data.label || "Room",
        nodes: plan.subNodes,
        edges: plan.subEdges,
        boundary: plan.boundary,
      };
      setDiagrams([...synced(), subDiagram]);
      setNodes(plan.hostNodes);
      setEdges(plan.hostEdges);
      return { ok: true, movedDevices: plan.movedDeviceCount };
    },
    [nodesRef, edgesRef, synced, takeSnapshot, setDiagrams, setNodes, setEdges],
  );

  /** Snapshot the whole project (active diagram synced) for saving, including history. */
  const getDocument = useCallback(
    (): SigpathDocument =>
      toDocument(synced(), {
        projectId: projectId.current,
        projectName,
        signalProfile,
        revisions: revisionsRef.current,
      }),
    [synced, projectName, signalProfile],
  );

  /**
   * Capture the current working state as a revision (p2-revisions). Called on save; pass a
   * `label` to mark a named milestone. Automatic (unnamed) save points dedupe against the
   * last revision and are pruned to the most recent N — named ones are kept forever. Updates
   * the ref synchronously so a save reads the new list immediately. Returns false if skipped.
   */
  const captureRevision = useCallback(
    (label?: string): boolean => {
      const project = toDocument(synced(), { projectId: projectId.current, projectName, signalProfile }).project;
      const snapshot: RevisionSnapshot = {
        name: project.name,
        diagrams: project.diagrams,
        signalProfile: project.signalProfile,
      };
      const hash = snapshotHash(snapshot);
      const prev = revisionsRef.current;
      // Skip an automatic save point that changed nothing since the last revision.
      if (!label && prev.length > 0 && prev[prev.length - 1].hash === hash) return false;
      const rev: Revision = { id: crypto.randomUUID(), at: Date.now(), label, hash, snapshot };
      const next = pruneRevisions([...prev, rev]);
      revisionsRef.current = next;
      setRevisions(next);
      return true;
    },
    [synced, projectName, signalProfile],
  );

  /** Restore a revision into the live editor — NON-DESTRUCTIVE: snapshots first (so undo
   *  brings the current state right back) and leaves the history untouched. */
  const restoreRevision = useCallback(
    (id: string) => {
      const rev = revisionsRef.current.find((r) => r.id === id);
      if (!rev) return;
      takeSnapshot();
      const parsed = fromDocument({
        schemaVersion: SIGPATH_SCHEMA_VERSION,
        project: {
          id: projectId.current,
          name: rev.snapshot.name,
          diagrams: rev.snapshot.diagrams,
          signalProfile: rev.snapshot.signalProfile,
        },
      });
      setProjectName(parsed.projectName);
      setSignalProfile(parsed.signalProfile);
      setDiagrams(parsed.diagrams);
      setActiveId(parsed.diagrams[0].id);
      loadActive(parsed.diagrams, parsed.diagrams[0].id);
      onChange?.();
    },
    [takeSnapshot, loadActive, onChange],
  );

  /** Name (or rename / clear) a revision. A label promotes a save point to a kept-forever
   *  milestone; clearing it demotes the revision back to a prunable save point. */
  const nameRevision = useCallback(
    (id: string, label: string) => {
      const trimmed = label.trim();
      const next = revisionsRef.current.map((r) =>
        r.id === id ? { ...r, label: trimmed || undefined } : r,
      );
      revisionsRef.current = next;
      setRevisions(next);
      onChange?.();
    },
    [onChange],
  );

  const loadProject = useCallback(
    (doc: SigpathDocument) => {
      const parsed = fromDocument(doc);
      projectId.current = parsed.projectId;
      setProjectName(parsed.projectName);
      setSignalProfile(parsed.signalProfile);
      setDiagrams(parsed.diagrams);
      setActiveId(parsed.diagrams[0].id);
      loadActive(parsed.diagrams, parsed.diagrams[0].id);
      revisionsRef.current = parsed.revisions;
      setRevisions(parsed.revisions);
      clearHistory();
    },
    [loadActive, clearHistory],
  );

  const newProject = useCallback(() => {
    projectId.current = crypto.randomUUID();
    setProjectName("Untitled");
    setSignalProfile(undefined);
    const fresh = emptyEditorDiagram("Diagram 1");
    setDiagrams([fresh]);
    setActiveId(fresh.id);
    loadActive([fresh], fresh.id);
    revisionsRef.current = [];
    setRevisions([]);
    clearHistory();
  }, [loadActive, clearHistory]);

  return {
    projectName,
    setProjectName,
    signalProfile,
    setSignalProfile,
    diagrams,
    activeId,
    switchDiagram,
    addDiagram,
    renameDiagram,
    reorderDiagrams,
    deleteDiagram,
    blockRefCount,
    embedTabAsBlock,
    promoteZoneToTab,
    revisions,
    captureRevision,
    restoreRevision,
    nameRevision,
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
