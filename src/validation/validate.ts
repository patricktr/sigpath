import { checkPortCompatibility, deviceTitle, groupForConnector, gradeLabel, meetsDemand } from "../schema";
import type { SignalKind, SignalProfile } from "../schema";
import { propagateDemand } from "./gradeFlow";
import { isPortBearing } from "../flow/types";
import type { CableEdgeType, PortBearingNode, SigNode } from "../flow/types";

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
  /** A one-click fix the UI can offer for this issue. */
  action?: { type: "add-converter"; edgeId: string };
};

export type ValidationResult = {
  issues: ValidationIssue[];
  /** Edge ids to render as errors / warnings. */
  errorEdges: Set<string>;
  warnEdges: Set<string>;
  errorCount: number;
  warningCount: number;
  /**
   * True when graded gear is on the canvas but no show format is set, so grade
   * checks can't run. Drives the "pick a show format" prompt + status-bar state —
   * the validator asks rather than guesses a demand. See design/SIGNAL-GRADE.html §6.
   */
  needsShowFormat: boolean;
};

/**
 * Live signal validation over the current diagram. Pure and cheap so it can run
 * on every nodes/edges change. Connection-level rules are grounded in the
 * schema's `checkPortCompatibility`; the rest are structural sanity checks.
 */
export function validate(
  nodes: SigNode[],
  edges: CableEdgeType[],
  signalProfile?: SignalProfile,
): ValidationResult {
  // Endpoint index: devices AND nested-diagram blocks (both port-bearing), so a cable
  // into a block resolves its boundary port instead of false-flagging "Broken".
  const devices = new Map<string, PortBearingNode>();
  for (const n of nodes) {
    if (isPortBearing(n)) devices.set(n.id, n);
  }

  const issues: ValidationIssue[] = [];
  const errorEdges = new Set<string>();
  const warnEdges = new Set<string>();
  // Gate 2 demand is computed by a forward propagation over the whole graph (a router's outputs
  // carry the worst-case grade reaching it), not per-cable-local — see gradeFlow. needsShowFormat
  // (a graded image run with no format) falls out of the same pass.
  const { demandByEdge, needsShowFormat } = propagateDemand(nodes, edges, signalProfile);
  // `${nodeId}:${portId}` -> edge ids touching that physical port (each jack = one cable).
  const portUsage = new Map<string, string[]>();
  const addUse = (key: string, id: string) => {
    const list = portUsage.get(key) ?? [];
    list.push(id);
    portUsage.set(key, list);
  };

  const name = (n?: PortBearingNode) => (n ? deviceTitle(n.data.model, n.data.label) : "?");

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
      // ok covers straight cables, passive adapter/transition cables, and device PSUs
      // (AC↔DC power) — all valid, so no issue is raised; the cable is named in the
      // Cables & adapters list. Only true mismatches flag here.
      if (compat.status === "error") {
        errorEdges.add(e.id);
        issues.push({
          id: `${compat.kind === "converter" ? "converter" : "signal"}:${e.id}`,
          severity: "error",
          title: compat.kind === "converter" ? "Converter needed" : "Signal mismatch",
          detail: `${path}: ${compat.reason}`,
          edgeId: e.id,
          focusNodeIds: [e.source, e.target],
          // A converter mismatch (same signal domain, no passive cable) can be
          // auto-fixed by splicing in a converter device; a true incompatibility
          // (different domains) can't, so no action there.
          ...(compat.kind === "converter"
            ? { action: { type: "add-converter" as const, edgeId: e.id } }
            : {}),
        });
      } else if (compat.status === "warn") {
        warnEdges.add(e.id);
        issues.push({
          id: `compat:${e.id}`,
          severity: "warning",
          title: "Check connector",
          detail: `${path}: ${compat.reason}`,
          edgeId: e.id,
          focusNodeIds: [e.source, e.target],
        });
      }

      // Gate 2 — bandwidth grade. Only when the connectors aren't already a hard mismatch
      // (no point grading a broken pairing). The demand is the worst-case grade propagated to
      // this cable (gradeFlow); absent ⇒ ungraded family or no ceiling ⇒ no flag. Capability
      // unknown ⇒ meetsDemand returns undefined ⇒ no flag. Both checks are hard errors.
      if (compat.status !== "error") {
        const demand = demandByEdge.get(e.id);
        if (demand) {
          if (meetsDemand(inp.grade, demand) === false) {
            errorEdges.add(e.id);
            issues.push({
              id: `grade-sink:${e.id}`,
              severity: "error",
              title: "Signal grade exceeds input",
              detail: `${path}: the run carries ${gradeLabel(demand)}, but ${inp.name} only supports ${gradeLabel(inp.grade)}.`,
              edgeId: e.id,
              focusNodeIds: [e.source, e.target],
            });
          }
          if (meetsDemand(e.data?.cableGrade, demand) === false) {
            errorEdges.add(e.id);
            issues.push({
              id: `grade-cable:${e.id}`,
              severity: "error",
              title: "Cable under-rated",
              detail: `${path}: the run carries ${gradeLabel(demand)}, but the cable is rated ${gradeLabel(e.data?.cableGrade)} — use a ${gradeLabel(demand)} cable.`,
              edgeId: e.id,
              focusNodeIds: [e.source, e.target],
            });
          }
        }
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

  // Cable IDs must be unique — you can't pull two different "VID-001"s. Two cables
  // sharing an ID (case-insensitively) is an error; blank IDs are never flagged.
  // This is the duplicate-ID half of validation, which needs IDs to exist first.
  const byCableId = new Map<string, { ids: string[]; label: string; nodeIds: Set<string> }>();
  for (const e of edges) {
    const raw = e.data?.number?.trim();
    if (!raw) continue;
    const k = raw.toUpperCase();
    const cur = byCableId.get(k);
    if (cur) {
      cur.ids.push(e.id);
      cur.nodeIds.add(e.source).add(e.target);
    } else {
      byCableId.set(k, { ids: [e.id], label: raw, nodeIds: new Set([e.source, e.target]) });
    }
  }
  for (const { ids, label, nodeIds } of byCableId.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) errorEdges.add(id);
    issues.push({
      id: `dupid:${label.toUpperCase()}`,
      severity: "error",
      title: "Duplicate cable ID",
      detail: `${ids.length} cables share the ID “${label}” — each cable needs a unique ID.`,
      focusNodeIds: [...nodeIds].filter((id) => devices.has(id)),
    });
  }

  // An edge that is an error shouldn't also be styled as a warning.
  for (const id of errorEdges) warnEdges.delete(id);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  return { issues, errorEdges, warnEdges, errorCount, warningCount, needsShowFormat };
}
