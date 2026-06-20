import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cableColor, inputPorts, outputPorts, bidirectionalPorts, deviceTitle } from "../schema";
import type { DeviceNodeType } from "./types";
import "./DeviceNode.css";

/**
 * A device rendered as a card with labeled input ports on the left and output
 * ports on the right. Each port is a React Flow handle, so connections attach to
 * specific ports rather than the whole node. Sides and colors come straight from
 * the schema (port direction + signal kind).
 */
export function DeviceNode({ data }: NodeProps<DeviceNodeType>) {
  const { model, label } = data;
  const inputs = inputPorts(model);
  const outputs = outputPorts(model);
  const bidi = bidirectionalPorts(model);

  return (
    <div className="device-node">
      <header className="device-node__header">
        <span className="device-node__name">{deviceTitle(model, label)}</span>
        <span className="device-node__category">{model.type ?? model.category}</span>
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
                {/* One physical jack, both ways: overlapping target + source handles. */}
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
