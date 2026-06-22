import { checkPortCompatibility } from "../schema";
import type { DeviceModel, Port } from "../schema";

/**
 * A converter device that can bridge a source port to a target port, naming the
 * specific input/output ports each leg cables into.
 */
export type ConverterCandidate = {
  model: DeviceModel;
  /** The source cables into this input. */
  inPort: Port;
  /** This output cables into the target. */
  outPort: Port;
  /** Lower is better: 0 = both legs straight, +1 per passive-adapter leg. */
  score: number;
};

const CONVERTER_TYPES = new Set(["Converter", "Scaler", "Extender", "Encoder/Decoder"]);

function isConverter(m: DeviceModel): boolean {
  return m.category === "converter" || CONVERTER_TYPES.has(m.type ?? "");
}

/**
 * Find catalog converter devices that bridge `source → target`: a device the
 * source can cable into (some input/bidi port) AND that can cable into the target
 * (some output/bidi port), both decided by {@link checkPortCompatibility} — the
 * same primitive validation runs. Ranked straight-before-adapter, then simpler box
 * (fewer ports), then name. Direction matters, so an SDI→HDMI converter is *not*
 * offered for an HDMI→SDI mismatch.
 */
export function findConverters(
  source: Port,
  target: Port,
  catalog: DeviceModel[],
): ConverterCandidate[] {
  const out: ConverterCandidate[] = [];
  for (const model of catalog) {
    if (!isConverter(model)) continue;
    let best: { inPort: Port; outPort: Port; score: number } | undefined;
    for (const inPort of model.ports) {
      if (inPort.direction !== "input" && inPort.direction !== "bidirectional") continue;
      const inC = checkPortCompatibility(source, inPort);
      if (inC.status !== "ok") continue;
      for (const outPort of model.ports) {
        if (outPort.id === inPort.id) continue;
        if (outPort.direction !== "output" && outPort.direction !== "bidirectional") continue;
        const outC = checkPortCompatibility(outPort, target);
        if (outC.status !== "ok") continue;
        const score = (inC.kind === "straight" ? 0 : 1) + (outC.kind === "straight" ? 0 : 1);
        if (!best || score < best.score) best = { inPort, outPort, score };
      }
    }
    if (best) out.push({ model, ...best });
  }
  out.sort(
    (a, b) =>
      a.score - b.score ||
      a.model.ports.length - b.model.ports.length ||
      a.model.model.localeCompare(b.model.model),
  );
  return out;
}
