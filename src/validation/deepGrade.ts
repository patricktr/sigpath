import { flatten } from "../flow/nesting";
import { propagateDemand } from "./gradeFlow";
import { deviceTitle, gradeLabel, gradeRank, meetsDemand } from "../schema";
import type { SignalProfile } from "../schema";
import { isPortBearing } from "../flow/types";
import type { EditorDiagram, PortBearingNode } from "../flow/types";
import type { ValidationIssue } from "./validate";

/**
 * Deep cross-boundary grade validation (p2-deepgrade Phase B). The active-diagram validator
 * only grades cables on the active canvas. This runs the worst-case demand propagation
 * (gradeFlow) over the FLATTENED project, so a host source's demand crosses block boundaries
 * into a room's inner cables — and an under-rated cable deep inside a control room flags against
 * the show format. Only INNER cables are reported here (the active diagram's own cables are
 * already covered by validate); each is attributed to its source room, deduped to one row at the
 * worst case it sees across embeds, with a badge on every host block whose room actually fails.
 */

export type DeepGradeGroup = { roomId: string; roomName: string; issues: ValidationIssue[] };
export type DeepGradeResult = {
  groups: DeepGradeGroup[];
  /** Active-canvas block-instance ids to badge — a room they embed has a failing inner cable. */
  errorBlockNodes: Set<string>;
};

const EMPTY: DeepGradeResult = { groups: [], errorBlockNodes: new Set() };

export function deepGrade(
  diagrams: EditorDiagram[],
  rootId: string,
  profile: SignalProfile | undefined,
): DeepGradeResult {
  const { nodes, edges, provenance } = flatten(diagrams, rootId);
  // No embedded room reachable ⇒ nothing crosses a boundary ⇒ active validate already covers it.
  if (![...provenance.values()].some((p) => p.ownerDiagramId !== rootId)) return EMPTY;
  const { demandByEdge } = propagateDemand(nodes, edges, profile);
  const byId = new Map<string, PortBearingNode>();
  for (const n of nodes) if (isPortBearing(n)) byId.set(n.id, n);

  // Dedupe per (room, local edge, kind), keeping the worst-case (highest-rank) demand.
  const seen = new Map<string, { roomId: string; roomName: string; issue: ValidationIssue; rank: number }>();
  const errorBlockNodes = new Set<string>();

  for (const e of edges) {
    const prov = provenance.get(e.id);
    if (!prov || prov.ownerDiagramId === rootId) continue; // active diagram → validate() owns it
    const demand = demandByEdge.get(e.id);
    if (!demand) continue;

    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    const outp = src?.data.model.ports.find((p) => p.id === e.sourceHandle);
    const sink = tgt?.data.model.ports.find((p) => p.id === e.targetHandle);
    const sinkFail = sink ? meetsDemand(sink.grade, demand) === false : false;
    const cableFail = meetsDemand(e.data?.cableGrade, demand) === false;
    if (!sinkFail && !cableFail) continue;

    if (prov.blockPath[0]) errorBlockNodes.add(prov.blockPath[0]); // badge this embed's host block
    const path = `${src ? deviceTitle(src.data.model, src.data.label) : "?"} · ${outp?.name ?? "?"} → ${tgt ? deviceTitle(tgt.data.model, tgt.data.label) : "?"} · ${sink?.name ?? "?"}`;
    const via = prov.pathLabel ? ` (via ${prov.pathLabel})` : "";
    const rank = gradeRank(demand) ?? 0;

    const upsert = (kind: "sink" | "cable", issue: ValidationIssue) => {
      const key = `${prov.ownerDiagramId}::${prov.localEdgeId}::${kind}`;
      const prior = seen.get(key);
      if (!prior || rank > prior.rank) {
        seen.set(key, { roomId: prov.ownerDiagramId, roomName: prov.ownerName, issue, rank });
      }
    };

    if (sinkFail && sink) {
      upsert("sink", {
        id: `deep-grade-sink:${prov.ownerDiagramId}:${prov.localEdgeId}`,
        severity: "error",
        title: "Signal grade exceeds input",
        detail: `${path}${via}: the run carries ${gradeLabel(demand)}, but ${sink.name} only supports ${gradeLabel(sink.grade)}.`,
        edgeId: prov.localEdgeId,
        focusNodeIds: prov.localFocus,
      });
    }
    if (cableFail) {
      upsert("cable", {
        id: `deep-grade-cable:${prov.ownerDiagramId}:${prov.localEdgeId}`,
        severity: "error",
        title: "Cable under-rated",
        detail: `${path}${via}: the run carries ${gradeLabel(demand)}, but the cable is rated ${gradeLabel(e.data?.cableGrade)} — use a ${gradeLabel(demand)} cable.`,
        edgeId: prov.localEdgeId,
        focusNodeIds: prov.localFocus,
      });
    }
  }

  const groups = new Map<string, DeepGradeGroup>();
  for (const { roomId, roomName, issue } of seen.values()) {
    let g = groups.get(roomId);
    if (!g) groups.set(roomId, (g = { roomId, roomName, issues: [] }));
    g.issues.push(issue);
  }
  return { groups: [...groups.values()], errorBlockNodes };
}
