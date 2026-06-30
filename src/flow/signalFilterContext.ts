import { createContext } from "react";

/**
 * Per-node signal-filter dimming (p2-typefilter, slice 3), provided above ReactFlow and read by
 * DeviceNode / BlockNode — same context shape as BlockDriftContext, so a node fades its own
 * non-matching ports without threading filter state through node data. Whole-node fade/hide is
 * handled by App's `displayNodes` layer; this context only governs per-port fade on a node that
 * stays active. `litPorts` are the ports to keep lit; anything else on an active node fades.
 */
export type SignalFilterCtx = {
  filtering: boolean;
  litPorts: Map<string, Set<string>>;
  activeNodeIds: Set<string>;
};

export const SignalFilterContext = createContext<SignalFilterCtx>({
  filtering: false,
  litPorts: new Map(),
  activeNodeIds: new Set(),
});

/**
 * Should this port fade? Only on an ACTIVE (kept-full) node — an inactive node is faded whole by
 * the `displayNodes` layer, so we never double-dim its ports.
 */
export function portFaded(ctx: SignalFilterCtx, nodeId: string, portId: string): boolean {
  return ctx.filtering && ctx.activeNodeIds.has(nodeId) && !ctx.litPorts.get(nodeId)?.has(portId);
}
