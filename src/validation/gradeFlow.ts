import { gradeScaleForConnector, maxGrade, minGrade, scaleOfGrade, videoFormatToGrade } from "../schema";
import type { GradeId, GradeScaleId, Port, SignalProfile } from "../schema";
import { isPortBearing } from "../flow/types";
import type { CableEdgeData, CableEdgeType, PortBearingNode, SigNode } from "../flow/types";

/**
 * Conservative worst-case signal-demand propagation (p2-deepgrade). The old grade gate graded
 * each cable against `min(its own source-port capability, show format)`. That's wrong for a
 * router: the diagram doesn't trace which input routes to which output, so any output could
 * carry the highest-grade input. This computes, per grade family, the worst-case grade that can
 * REACH each cable's source device and propagates it forward — so all-3G into a switcher leaves
 * 3G downstream (a 3G cable passes), but one 12G input flags the 3G cables below it.
 *
 * Pure and cheap (a monotone fixpoint bounded by ladder height), so it runs on every change.
 * Cross-boundary propagation (over flatten()) is a later phase; this engine already serves flat
 * diagrams, which is most of the value.
 */

/** Image-domain scales the show format speaks to — drive the "set a format" prompt. */
const IMAGE_SCALES = new Set<GradeScaleId>(["sdi", "hdmi", "displayport"]);

type EdgeInfo = {
  id: string;
  src: PortBearingNode;
  tgt: PortBearingNode;
  outPort: Port;
  data: CableEdgeData | undefined;
  scale: GradeScaleId;
};

export type DemandFlow = {
  /** The worst-case grade each cable carries — absent ⇒ no demand to check (ungraded / no ceiling). */
  demandByEdge: Map<string, GradeId>;
  /** A graded image-domain run exists but no show format is set ⇒ prompt for one. */
  needsShowFormat: boolean;
};

export function propagateDemand(
  nodes: SigNode[],
  edges: CableEdgeType[],
  profile: SignalProfile | undefined,
): DemandFlow {
  const byId = new Map<string, PortBearingNode>();
  for (const n of nodes) if (isPortBearing(n)) byId.set(n.id, n);

  // Resolve every cable to its port-bearing endpoints + the source-port's grade family.
  const infos: EdgeInfo[] = [];
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) continue;
    const outPort = src.data.model.ports.find((p) => p.id === e.sourceHandle);
    if (!outPort) continue;
    const scale = gradeScaleForConnector(outPort.connector);
    if (!scale) continue;
    infos.push({ id: e.id, src, tgt, outPort, data: e.data, scale });
  }

  const demandByEdge = new Map<string, GradeId>();
  let needsShowFormat = false;

  const families = new Set(infos.map((i) => i.scale));
  for (const family of families) {
    const fEdges = infos.filter((i) => i.scale === family);
    const ceiling = profile?.targets?.[family] ?? videoFormatToGrade(profile?.videoFormat, family);
    if (!ceiling) {
      // Can't grade without a ceiling. Image runs prompt for a format; network/USB just skip.
      if (IMAGE_SCALES.has(family)) needsShowFormat = true;
      continue;
    }

    // out[nodeId] = worst-case grade emitted on this node's outputs in `family`.
    const out = new Map<string, GradeId | undefined>();
    const fedNodes = new Set(fEdges.map((e) => e.tgt.id));

    // Seed pure origins (a source with family outputs but no family input): emit min(own
    // output capability, format); unknown capability ⇒ the format (conservative, unchanged).
    for (const e of fEdges) {
      const id = e.src.id;
      if (fedNodes.has(id) || out.has(id)) continue;
      let cap: GradeId | undefined;
      for (const p of e.src.data.model.ports) {
        if (p.direction === "input") continue;
        if (gradeScaleForConnector(p.connector) !== family) continue;
        cap = maxGrade(cap, p.grade);
      }
      out.set(id, minGrade(cap, ceiling) ?? ceiling);
    }

    // What a cable carries: a per-cable signalGrade override pins it (and propagates); else the
    // source device's emitted grade, capped by any per-output-port pin ("emits at most X").
    const carriedOf = (e: EdgeInfo): GradeId | undefined => {
      const override = e.data?.signalGrade;
      if (override && scaleOfGrade(override) === family) return override;
      const base = out.get(e.src.id);
      const pin = e.src.type === "device" ? e.src.data.signalPins?.[e.outPort.id] : undefined;
      if (pin && scaleOfGrade(pin) === family) return minGrade(base, pin) ?? pin;
      return base;
    };

    // Relax to fixpoint: each fed node's emitted grade = max of what arrives. Monotone (grades
    // only rise) and bounded, so it converges; the guard only backstops a logic bug / cycle.
    const cap = fEdges.length * 8 + 8;
    let changed = true;
    for (let pass = 0; changed && pass < cap; pass++) {
      changed = false;
      for (const e of fEdges) {
        const carried = carriedOf(e);
        if (carried === undefined) continue;
        const merged = maxGrade(out.get(e.tgt.id), carried);
        if (merged !== out.get(e.tgt.id)) {
          out.set(e.tgt.id, merged);
          changed = true;
        }
      }
    }

    for (const e of fEdges) {
      const carried = carriedOf(e);
      if (carried) demandByEdge.set(e.id, carried);
    }
  }

  return { demandByEdge, needsShowFormat };
}
