import { useCallback, useRef, useState } from "react";
import type { DeviceNodeType, CableEdgeType } from "./types";

type Snapshot = { nodes: DeviceNodeType[]; edges: CableEdgeType[] };

const MAX_HISTORY = 100;

/**
 * Lightweight undo/redo for the canvas. Snapshots are taken at discrete
 * interaction boundaries (call `takeSnapshot()` *before* a mutation: connect,
 * delete, drag-start, add). React Flow produces a fresh nodes/edges array on
 * every change, so storing references is enough — no deep cloning needed.
 */
export function useUndoRedo(
  nodes: DeviceNodeType[],
  edges: CableEdgeType[],
  setNodes: (nodes: DeviceNodeType[]) => void,
  setEdges: (edges: CableEdgeType[]) => void,
) {
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);

  // Always-fresh view of the current canvas, for snapshotting from callbacks.
  const current = useRef<Snapshot>({ nodes, edges });
  current.current = { nodes, edges };

  // Force a re-render so canUndo/canRedo (and the toolbar) stay in sync.
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  const takeSnapshot = useCallback(() => {
    past.current = [...past.current, current.current].slice(-MAX_HISTORY);
    future.current = [];
    rerender();
  }, [rerender]);

  const undo = useCallback(() => {
    const previous = past.current[past.current.length - 1];
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [current.current, ...future.current];
    setNodes(previous.nodes);
    setEdges(previous.edges);
    rerender();
  }, [setNodes, setEdges, rerender]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, current.current];
    setNodes(next.nodes);
    setEdges(next.edges);
    rerender();
  }, [setNodes, setEdges, rerender]);

  const clearHistory = useCallback(() => {
    past.current = [];
    future.current = [];
    rerender();
  }, [rerender]);

  return {
    takeSnapshot,
    undo,
    redo,
    clearHistory,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
