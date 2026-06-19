import { checkPortCompatibility, deviceTitle, groupForConnector } from "../schema";
import type { SignalKind } from "../schema";
import type { CableEdgeType, DeviceNodeType, SigNode } from "../flow/types";

export type Severity = "error" | "warning";

export type ValidationIssue = {
  /** Stable id (for React keys and de-duplication). */
  id: string;
  severity: Severity;
  /** Short headline, e.g. "Signal mismatch". */
  title: string;
  /** Full human-readable explanation. */
  detail: string;
  /** The offending cable, if any (used to select it on the canvas). */
  edgeId?: string;
  /** Node(s) to frame when the user jumps to this issue. */
  focusNodeIds: string[];
};

export type ValidationResult = {
  issues: ValidationIssue[];
  /** Edge ids to render as errors / warnings. */
  errorEdges: Set<string>;
  warnEdges: Set<string>;
  errorCount: number;
  warningCount: number;
};

/**
 * Live signal validation over the current diagram. Pure and cheap so it can run
 * on every nodes/edges change. Connection-level rules are grounded in the
 * schema's `checkPortCompatibility`; the rest are structural sanity checks.
 */
export function validate(nodes: SigNode[], edges: CableEdgeType[]): ValidationResult {
  const devices = new Map<string, DeviceNodeType>();
  for (const n of nodes) {
    if (n.type === "device") devices.set(n.id, n);
  }

  const issues: ValidationIssue[] = [];
  const errorEdges = new Set<string>();
  const warnEdges = new Set<string>();
  // `${nodeId}:${portId}` -> edge ids touching that physical port (each jack = one cable).
  const portUsage = new Map<string, string[]>();
  const addUse = (key: string, id: string) => {
    const list = portUsage.get(key) ?? [];
    list.push(id);
    portUsage.set(key, list);
  };

  const name = (n?: DeviceNodeType) => (n ? deviceTitle(n.data.model, n.data.label) : "?");

  for (const e of edges) {
    const src = devices.get(e.source);
    const tgt = devices.get(e.target);
    const out = src?.data.model.ports.find((p) => p.id === e.sourceHandle);
    const inp = tgt?.data.model.ports.find((p) => p.id === e.targetHandle);

    if (!src || !tgt || !out || !inp) {
      errorEdges.add(e.id);
      issues.push({
        id: `broken:${e.id}`,
        severity: "error",
        title: "Broken connection",
        detail: "This cable points to a device or port that no longer exists.",
        edgeId: e.id,
        focusNodeIds: [e.source, e.target].filter((id) => devices.has(id)),
      });
      continue;
    }

    const path = `${name(src)} · ${out.name} → ${name(tgt)} · ${inp.name}`;

    const outOk = out.direction === "output" || out.direction === "bidirectional";
    const inOk = inp.direction === "input" || inp.direction === "bidirectional";
    if (!outOk || !inOk) {
      errorEdges.add(e.id);
      issues.push({
        id: `direction:${e.id}`,
        severity: "error",
        title: "Wrong direction",
        detail: `${path}: a cable must run from an output to an input.`,
        edgeId: e.id,
        focusNodeIds: [e.source, e.target],
      });
    } else {
      const compat = checkPortCompatibility(out, inp);
      if (compat.status === "error") {
        errorEdges.add(e.id);
        issues.push({
          id: `signal:${e.id}`,
          severity: "error",
          title: "Signal mismatch",
          detail: `${path}: ${compat.reason}`,
          edgeId: e.id,
          focusNodeIds: [e.source, e.target],
        });
      } else if (compat.status === "warn") {
        warnEdges.add(e.id);
        issues.push({
          id: `adapter:${e.id}`,
          severity: "warning",
          title: "Adapter needed",
          detail: `${path}: ${compat.reason}`,
          edgeId: e.id,
          focusNodeIds: [e.source, e.target],
        });
      }
    }

    // Every physical jack carries one cable — track both ends of the run.
    if (e.sourceHandle) addUse(`${e.source}:${e.sourceHandle}`, e.id);
    if (e.targetHandle) addUse(`${e.target}:${e.targetHandle}`, e.id);
  }

  // A single physical port carries one cable. Two sources into one input is always
  // an error; two cables out of one output is an error for point-to-point signals
  // (HDMI/SDI/network) but only a warning for ones that fan out in the field
  // (audio speaker taps, control daisy-chains, parallel power).
  const POINT_TO_POINT = new Set<SignalKind>(["av", "video", "data", "network"]);
  for (const [key, edgeIds] of portUsage) {
    if (edgeIds.length < 2) continue;
    const sep = key.lastIndexOf(":");
    const nodeId = key.slice(0, sep);
    const portId = key.slice(sep + 1);
    const dev = devices.get(nodeId);
    const port = dev?.data.model.ports.find((p) => p.id === portId);
    if (!port) continue;

    const isInput = port.direction === "input";
    const severity: Severity =
      isInput || POINT_TO_POINT.has(groupForConnector(port.connector)) ? "error" : "warning";
    for (const id of edgeIds) {
      if (severity === "error") errorEdges.add(id);
      else if (!errorEdges.has(id)) warnEdges.add(id);
    }
    const where = `${name(dev)} · ${port.name}`;
    issues.push({
      id: `oversub:${key}`,
      severity,
      title: isInput ? "Input over-subscribed" : "Output over-subscribed",
      detail: isInput
        ? `${where} has ${edgeIds.length} cables into one input — an input takes a single source.`
        : `${where} drives ${edgeIds.length} cables from one port — a physical port carries one cable; use a splitter / distribution amp.`,
      focusNodeIds: [nodeId],
    });
  }

  // An edge that is an error shouldn't also be styled as a warning.
  for (const id of errorEdges) warnEdges.delete(id);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  return { issues, errorEdges, warnEdges, errorCount, warningCount };
}
