import { createContext, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cableColor, inputPorts, outputPorts, bidirectionalPorts, deviceTitle } from "../schema";
import type { BlockNodeType } from "./types";
import "./DeviceNode.css";

/**
 * Which referenced tabs have drifted (their published boundary no longer matches their room,
 * p2-blockdrift) and the action to refresh one. Provided above ReactFlow by App and read by
 * every BlockNode, so a block flags itself amber without threading drift through node data —
 * the same context shape ZoneNode uses for its actions.
 */
export const BlockDriftContext = createContext<{
  /** Referenced tabs whose published boundary drifted (p2-blockdrift) — keyed by refDiagramId. */
  drifted: Set<string>;
  onRefresh: (tabId: string) => void;
  /** This block's own instance id is here when a cable inside its room is under-rated for the
   *  show format (p2-deepgrade) — keyed by the block-instance id, not refDiagramId. */
  deepErrors: Set<string>;
}>({
  drifted: new Set(),
  onRefresh: () => {},
  deepErrors: new Set(),
});

/**
 * A nested-diagram reference rendered as a block (p2-zonetab — design/ZONE-TAB.html).
 * Its handles are the referenced diagram's boundary ports, carried as the synthesized
 * `data.model.ports`, so it renders with the exact same port layout as a device — cables
 * attach and route through it identically, with zero change to the routing kernels.
 * Visually it's marked as a reference (dashed accent border, "⧉ tab" hint) rather than a
 * real device. Opening the referenced tab is wired in a later Phase-A slice.
 */
export function BlockNode({ id, data }: NodeProps<BlockNodeType>) {
  const { model, label, refDiagramId } = data;
  const inputs = inputPorts(model);
  const outputs = outputPorts(model);
  const bidi = bidirectionalPorts(model);

  const { drifted, onRefresh, deepErrors } = useContext(BlockDriftContext);
  const isDrifted = drifted.has(refDiagramId);
  const hasDeepError = deepErrors.has(id);

  return (
    <div
      className="device-node device-node--block"
      style={isDrifted ? { borderColor: "#f59e0b", borderStyle: "solid" } : undefined}
    >
      <header className="device-node__header">
        <span className="device-node__name">{deviceTitle(model, label)}</span>
        {hasDeepError && (
          <span
            style={{ color: "#ef4444", marginLeft: 4 }}
            title="A cable inside this room is under-rated for the show format — see Signal check"
          >
            ⚠
          </span>
        )}
        {isDrifted ? (
          <button
            type="button"
            className="device-node__category"
            style={{ color: "#f59e0b", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            title="The room changed — refresh this block's ports"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRefresh(refDiagramId);
            }}
          >
            ⟳ refresh
          </button>
        ) : (
          <span className="device-node__category" title="Nested sub-diagram — opens its tab">⧉ tab</span>
        )}
      </header>

      {(inputs.length > 0 || outputs.length > 0) && (
        <div className="device-node__body">
          <ul className="device-node__col device-node__col--in">
            {inputs.map((port) => (
              <li className="port port--in" key={port.id}>
                <Handle
                  id={port.id}
                  type="target"
                  position={Position.Left}
                  className="port__handle"
                  style={{ background: cableColor(port.connector) }}
                />
                <span className="port__label">{port.name}</span>
              </li>
            ))}
          </ul>

          <ul className="device-node__col device-node__col--out">
            {outputs.map((port) => (
              <li className="port port--out" key={port.id}>
                <span className="port__label">{port.name}</span>
                <Handle
                  id={port.id}
                  type="source"
                  position={Position.Right}
                  className="port__handle"
                  style={{ background: cableColor(port.connector) }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {bidi.length > 0 && (
        <div className="device-node__io">
          {bidi.map((port) => (
            <div className="port port--io" key={port.id}>
              <span className="port__label">{port.name}</span>
              <span className="port__io-anchor">
                {/* One jack, both ways: overlapping target + source handles. */}
                <Handle
                  id={port.id}
                  type="target"
                  position={Position.Bottom}
                  className="port__handle"
                  style={{ background: cableColor(port.connector) }}
                />
                <Handle
                  id={port.id}
                  type="source"
                  position={Position.Bottom}
                  className="port__handle"
                  style={{ background: cableColor(port.connector) }}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
