// Generate the synthetic routing fixtures (fixtures/routing/*.sigpath) the metric harness
// gates on (design/CABLE-ROUTING.html §4). Deterministic — built from inline minimal device
// models (the router only needs port.direction + positions; connector is cosmetic) and
// serialized through the REAL toDocument via Vite SSR, so the files are valid .sigpath and
// load unchanged. Re-run after changing a scenario; commit the emitted files.
//
//   node scripts/make-routing-fixtures.mjs
//
// Scenarios: horizontal-tuned (the must-not-regress common case: parallel bundles + one
// box detour), bidi-bottom (the dropped-at-the-gate ethernet bug + a box between the jacks),
// stacked (the vertically-stacked topology that regressed 1→3 last time), matrix (a dense
// cross-bar), pinned (a jogOffset override that must survive the new router). dense-real is
// the user's real test3.sigpath, copied separately by the harness setup — not generated here.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "routing");

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { toDocument } = await server.ssrLoadModule("/src/io/serialize.ts");

const P = (id, direction, connector, name) => ({ id, name: name ?? id, direction, connector });
/** A device node with inline model. `ports` is an array of P(...). */
const dev = (id, x, y, ports, label) => ({
  id,
  type: "device",
  position: { x, y },
  data: { model: { id: `m-${id}`, model: label ?? id, category: "other", source: "builtin", ports }, label: label ?? id },
});
const edge = (id, source, sourceHandle, target, targetHandle, data = {}) => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  type: "cable",
  data: { cableTypeId: "sdi", number: id, ...data },
});

// out/in port helpers
const outs = (n, connector = "sdi") => Array.from({ length: n }, (_, i) => P(`o${i + 1}`, "output", connector, `O${i + 1}`));
const ins = (n, connector = "sdi") => Array.from({ length: n }, (_, i) => P(`i${i + 1}`, "input", connector, `I${i + 1}`));

const scenarios = {
  // Two source/dest columns: a parallel bundle (A→B), a second bundle (A2→B2), and one run
  // (o1→i1 at y≈48) whose straight path is blocked by an obstacle device M, forcing a detour.
  "horizontal-tuned": [
    dev("A", 0, 0, outs(3), "Source A"),
    dev("B", 520, 0, ins(3), "Dest B"),
    dev("M", 240, 0, [P("i1", "input", "sdi")], "Obstacle"),
    dev("A2", 0, 240, outs(2), "Source A2"),
    dev("B2", 520, 240, ins(2), "Dest B2"),
  ].map((n) => n),
  // Ethernet between two switches via bidirectional (bottom) jacks, with a box between them.
  // Legacy drops these at the gate (unrouted → smooth-step through the box); P2 must route them.
  "bidi-bottom": [
    dev("N1", 0, 0, [P("net", "bidirectional", "rj45", "Net")], "Switch 1"),
    dev("N2", 460, 0, [P("net", "bidirectional", "rj45", "Net")], "Switch 2"),
    dev("M", 220, 0, [P("i1", "input", "sdi")], "Obstacle"),
  ],
  // One source feeding two vertically-stacked targets past an obstacle — the topology where a
  // naive down-across-up fallback cut through boxes (the reverted 1→3 regression).
  stacked: [
    dev("S", 0, 120, outs(2), "Source"),
    dev("T1", 460, 0, ins(1), "Target Top"),
    dev("T2", 460, 260, ins(1), "Target Bottom"),
    dev("M", 220, 100, [P("i1", "input", "sdi")], "Obstacle"),
  ],
  // Dense cross-bar: o_k → i_(n-k+1), maximizing crossings the router must minimize/accept.
  matrix: [
    dev("L", 0, 0, outs(4), "Matrix Out"),
    dev("R", 460, 0, ins(4), "Matrix In"),
  ],
  // A manual jogOffset override that must survive the new router (pinned, others route around).
  pinned: [
    dev("A", 0, 0, outs(2), "Source"),
    dev("B", 460, 0, ins(2), "Dest"),
  ],
  // BACKWARDS output→input runs (the Furman case): a power conditioner whose right-edge
  // outlets feed devices up-left and down-left of it. The default Z doubles straight back
  // over the conditioner's own box — the router must route AROUND it, not through it.
  "backwards-power": [
    dev("PC", 240, 240, outs(8, "power"), "Power Conditioner"),
    dev("T1", 0, 0, [P("pwr", "input", "power", "Power")], "Load Above"),
    dev("T2", 0, 620, [P("pwr", "input", "power", "Power")], "Load Below"),
  ],
  // Two bidi (bottom-jack) ethernet runs sharing one corridor — the NET-002/NET-003 case:
  // both A* routes pick the same grid lines and lie perfectly collinear unless the detour
  // spread pass fans bidi runs apart too (it once covered horizontal detours only).
  "bidi-pair": [
    dev("SW1", 0, 0, [P("net1", "bidirectional", "rj45", "Net 1"), P("net2", "bidirectional", "rj45", "Net 2")], "Switch A"),
    dev("SW2", 560, 0, [P("net1", "bidirectional", "rj45", "Net 1"), P("net2", "bidirectional", "rj45", "Net 2")], "Switch B"),
    dev("M", 260, 40, [P("i1", "input", "sdi")], "Obstacle"),
  ],
  // 64 devices — well past the old MAX_OBSTACLES=40 bail, where every detour/bidi run used
  // to give up at once and draw straight through the field. Long runs must route via the
  // pruned obstacle set; the bidi pair must cross the whole grid cleanly.
  "big-grid": [
    ...Array.from({ length: 64 }, (_, k) => {
      const r = Math.floor(k / 8);
      const c = k % 8;
      return dev(`g${r}c${c}`, c * 260, r * 160, [P("in", "input", "sdi", "In"), P("out", "output", "sdi", "Out")], `G${r}${c}`);
    }),
    dev("N1", -300, 560, [P("net", "bidirectional", "rj45", "Net")], "Switch W"),
    dev("N2", 2200, 560, [P("net", "bidirectional", "rj45", "Net")], "Switch E"),
  ],
};

const edges = {
  "horizontal-tuned": [
    edge("h1", "A", "o1", "B", "i1"),
    edge("h2", "A", "o2", "B", "i2"),
    edge("h3", "A", "o3", "B", "i3"),
    edge("h4", "A2", "o1", "B2", "i1"),
    edge("h5", "A2", "o2", "B2", "i2"),
  ],
  "bidi-bottom": [edge("net1", "N1", "net", "N2", "net", { cableTypeId: "ethernet" })],
  stacked: [edge("s1", "S", "o1", "T1", "i1"), edge("s2", "S", "o2", "T2", "i1")],
  matrix: [
    edge("m1", "L", "o1", "R", "i4"),
    edge("m2", "L", "o2", "R", "i3"),
    edge("m3", "L", "o3", "R", "i2"),
    edge("m4", "L", "o4", "R", "i1"),
  ],
  pinned: [
    edge("p1", "A", "o1", "B", "i1"),
    edge("p2", "A", "o2", "B", "i2", { jogOffset: 80 }),
  ],
  "backwards-power": [
    edge("pw1", "PC", "o1", "T1", "pwr", { cableTypeId: "power" }),
    edge("pw2", "PC", "o2", "T2", "pwr", { cableTypeId: "power" }),
  ],
  "bidi-pair": [
    edge("np1", "SW1", "net1", "SW2", "net1", { cableTypeId: "ethernet" }),
    edge("np2", "SW1", "net2", "SW2", "net2", { cableTypeId: "ethernet" }),
  ],
  "big-grid": [
    edge("bg1", "g0c0", "out", "g7c7", "in"), // long diagonal across the field
    edge("bg2", "g3c0", "out", "g3c7", "in"), // straight through a full row of boxes
    edge("bg3", "g7c0", "out", "g0c7", "in"), // rising diagonal
    edge("bg4", "g5c2", "out", "g2c5", "in"), // interior run
    edge("bgnet", "N1", "net", "N2", "net", { cableTypeId: "ethernet" }), // bidi across everything
  ],
};

for (const [name, nodes] of Object.entries(scenarios)) {
  const diagram = { id: `fix-${name}`, name: "Diagram 1", nodes, edges: edges[name] };
  const doc = toDocument([diagram], { projectId: `proj-${name}`, projectName: name });
  writeFileSync(join(FIX, `${name}.sigpath`), JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote ${name}.sigpath (${nodes.length} devices, ${edges[name].length} cables)`);
}

await server.close();
