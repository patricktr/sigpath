import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cableColor, inputPorts, outputPorts, bidirectionalPorts, deviceTitle } from "../schema";
import type { BlockNodeType } from "./types";
import "./DeviceNode.css";

/**
 * A nested-diagram reference rendered as a block (p2-zonetab — design/ZONE-TAB.html).
 * Its handles are the referenced diagram's boundary ports, carried as the synthesized
 * `data.model.ports`, so it renders with the exact same port layout as a device — cables
 * attach and route through it identically, with zero change to the routing kernels.
 * Visually it's marked as a reference (dashed accent border, "⧉ tab" hint) rather than a
 * real device. Opening the referenced tab is wired in a later Phase-A slice.
 */
export function BlockNode({ data }: NodeProps<BlockNodeType>) {
  const { model, label } = data;
  const inputs = inputPorts(model);
  const outputs = outputPorts(model);
  const bidi = bidirectionalPorts(model);

  return (
    <div className="device-node device-node--block">
      <header className="device-node__header">
        <span className="device-node__name">{deviceTitle(model, label)}</span>
        <span className="device-node__category" title="Nested sub-diagram — opens its tab">⧉ tab</span>
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
