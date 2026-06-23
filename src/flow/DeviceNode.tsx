import { useContext, type MouseEvent, type PointerEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cableColor, inputPorts, outputPorts, bidirectionalPorts, deviceTitle } from "../schema";
import type { DeviceNodeType } from "./types";
import { BulkPatchContext } from "./bulkPatch";
import "./DeviceNode.css";

/**
 * A device rendered as a card with labeled input ports on the left and output
 * ports on the right. Each port is a React Flow handle, so connections attach to
 * specific ports rather than the whole node. Sides and colors come straight from
 * the schema (port direction + signal kind).
 *
 * In bulk-patch mode, ports become click targets (connect/drag/select is disabled
 * on the canvas) and picked sources show a 1,2,3… ordinal badge — see flow/bulkPatch.ts.
 */
export function DeviceNode({ id, data }: NodeProps<DeviceNodeType>) {
  const { model, label } = data;
  const inputs = inputPorts(model);
  const outputs = outputPorts(model);
  const bidi = bidirectionalPorts(model);
  const bulk = useContext(BulkPatchContext);

  // Event handlers for a port while bulk-patching ({} when off, so normal
  // drag-to-connect is untouched). onClick picks/pairs the port; stopping click +
  // pointerdown keeps React Flow from selecting or dragging the node underneath.
  const bulkPort = (portId: string) =>
    bulk.active
      ? {
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            bulk.onPortClick({ nodeId: id, portId });
          },
          onPointerDown: (e: PointerEvent) => e.stopPropagation(),
        }
      : {};
  const ordinal = (portId: string) => (bulk.active ? bulk.ordinalFor({ nodeId: id, portId }) : null);

  return (
    <div className="device-node">
      <header className="device-node__header">
        <span className="device-node__name">{deviceTitle(model, label)}</span>
        <span className="device-node__category">{model.type ?? model.category}</span>
      </header>

      {(inputs.length > 0 || outputs.length > 0) && (
        <div className="device-node__body">
          <ul className="device-node__col device-node__col--in">
            {inputs.map((port) => {
              const ord = ordinal(port.id);
              return (
                <li
                  className={bulk.active ? "port port--in port--bulk" : "port port--in"}
                  key={port.id}
                  {...bulkPort(port.id)}
                >
                  <Handle
                    id={port.id}
                    type="target"
                    position={Position.Left}
                    className="port__handle"
                    style={{ background: cableColor(port.connector) }}
                  />
                  {ord != null && <span className="port__ordinal port__ordinal--in">{ord}</span>}
                  <span className="port__label">{port.name}</span>
                </li>
              );
            })}
          </ul>

          <ul className="device-node__col device-node__col--out">
            {outputs.map((port) => {
              const ord = ordinal(port.id);
              return (
                <li
                  className={bulk.active ? "port port--out port--bulk" : "port port--out"}
                  key={port.id}
                  {...bulkPort(port.id)}
                >
                  <span className="port__label">{port.name}</span>
                  {ord != null && <span className="port__ordinal port__ordinal--out">{ord}</span>}
                  <Handle
                    id={port.id}
                    type="source"
                    position={Position.Right}
                    className="port__handle"
                    style={{ background: cableColor(port.connector) }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {bidi.length > 0 && (
        <div className="device-node__io">
          {bidi.map((port) => {
            const ord = ordinal(port.id);
            return (
              <div
                className={bulk.active ? "port port--io port--bulk" : "port port--io"}
                key={port.id}
                {...bulkPort(port.id)}
              >
                <span className="port__label">{port.name}</span>
                {ord != null && <span className="port__ordinal port__ordinal--io">{ord}</span>}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
