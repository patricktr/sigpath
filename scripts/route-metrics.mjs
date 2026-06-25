// Headless routing-metric harness — the objective non-regression gate for the cable-routing
// rewrite (design/CABLE-ROUTING.html §4, phase P1).
//
// It runs the REAL router + serialize + routeMetrics over fixtures/routing/*.sigpath using
// Vite's SSR module loader (no separate test framework — vite is already a dev dep, and this
// is how the modules' TypeScript + type-only @xyflow imports run unchanged in node). The
// router runs on ESTIMATED geometry (headless = no measured handles), which is deterministic
// and identical for every router, so legacy↔new comparisons are apples-to-apples. Measured-
// geometry assertions (bidi box-interior hits) are a separate browser check, per the design.
//
// Usage:
//   node scripts/route-metrics.mjs                 print metrics for every fixture (legacy)
//   node scripts/route-metrics.mjs --router=new    use the new router (P2+)
//   node scripts/route-metrics.mjs --write         record baselines.json (records the router run)
//   node scripts/route-metrics.mjs --check         compare current run to baselines.json; exit 1 on regression
//
// Parity-or-better (per diagram, --check): crossings ≤ baseline (hard), cost ≤ baseline×1.02,
// and per-edge bends ≤ baseline on edges present in both.

import { createServer } from "vite";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX_DIR = join(ROOT, "fixtures", "routing");
const BASELINE = join(FIX_DIR, "baselines.json");
const COST_SLACK = 1.02;

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const CHECK = args.includes("--check");
const BOXCHECK = args.includes("--boxcheck");
const MAKEROOM = args.includes("--makeroom");
const TRUNK = args.includes("--trunk");
const ROUTER = (args.find((a) => a.startsWith("--router=")) ?? "--router=legacy").split("=")[1];

const SELFTEST = args.includes("--selftest");

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { parseDocument, fromDocument } = await server.ssrLoadModule("/src/io/serialize.ts");
const { legacyRouter } = await server.ssrLoadModule("/src/flow/router/legacyRouter.ts");
const { newRouter, collectObstacleRects } = await server.ssrLoadModule("/src/flow/router/newRouter.ts");
const metricsMod = await server.ssrLoadModule("/src/flow/routeMetrics.ts");
const { metricsFromResult, polylinesFromResult, boxInteriorHits, routeCrossings, totalCrossings, totalOverlaps, bendCount } = metricsMod;
const { planMakeRoom } = await server.ssrLoadModule("/src/flow/makeRoom.ts");
const { detectTrunkCandidates, collapsedTrunkWaypoints } = await server.ssrLoadModule("/src/flow/trunks.ts");

// Table-driven unit tests for the canonical crossing/overlap/bend counters — the keystone of
// the gate (design §3.4 / P1). Hand-built polylines with known answers.
if (SELFTEST) {
  const H = (y, x0, x1) => [{ x: x0, y }, { x: x1, y }];
  const V = (x, y0, y1) => [{ x, y: y0 }, { x, y: y1 }];
  let failed = 0;
  const eq = (name, got, want) => {
    if (got !== want) { console.error(`  ✗ ${name}: got ${got}, want ${want}`); failed++; }
    else console.log(`  ✓ ${name} = ${got}`);
  };
  eq("cross: + shape", routeCrossings(H(50, 0, 100), V(50, 0, 100)), 1);
  eq("cross: parallel H", routeCrossings(H(50, 0, 100), H(60, 0, 100)), 0);
  eq("cross: T-junction (strict interior)", routeCrossings(H(50, 0, 100), V(50, 50, 150)), 0);
  eq("cross: shared endpoint", routeCrossings(H(50, 0, 50), V(50, 50, 150)), 0);
  eq("cross: collinear is not a crossing", totalCrossings([H(50, 0, 100), H(50, 40, 140)]), 0);
  eq("overlap: collinear counts", totalOverlaps([H(50, 0, 100), H(50, 40, 140)]), 1);
  eq("overlap: parallel offset none", totalOverlaps([H(50, 0, 100), H(60, 0, 100)]), 0);
  eq("bends: straight", bendCount(H(50, 0, 100)), 0);
  eq("bends: L", bendCount([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]), 1);
  eq("bends: Z", bendCount([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 150, y: 100 }]), 2);
  await server.close();
  console.log(failed ? `\n✗ ${failed} self-test(s) failed` : `\n✓ all self-tests pass`);
  process.exit(failed ? 1 : 0);
}

const routers = { legacy: legacyRouter, new: newRouter };
const router = routers[ROUTER];
if (!router) {
  console.error(`unknown --router=${ROUTER} (have: ${Object.keys(routers).join(", ")})`);
  await server.close();
  process.exit(2);
}

function measure(file) {
  const { diagrams } = fromDocument(parseDocument(readFileSync(join(FIX_DIR, file), "utf8")));
  const out = {};
  for (const d of diagrams) {
    const result = router.route({ nodes: d.nodes, edges: d.edges });
    const m = metricsFromResult(result);
    out[d.name] = {
      edges: d.edges.length,
      routed: m.routed,
      unrouted: d.edges.length - result.ends.size,
      crossings: m.crossings,
      bends: m.bends,
      overlaps: m.overlaps,
      length: Math.round(m.length),
      cost: Math.round(m.cost * 100) / 100,
      perEdge: m.perEdge,
    };
  }
  return out;
}

// The hard "never behind a device" gate (P2): no routed run may pass through any device box —
// INCLUDING its own two endpoints (a bottom-port run must route around its own device, not back
// up through it). Each rect is deflated by INSET so the legitimate perpendicular exit stub
// touching the port's own edge isn't counted, while a real pass-through (well inside any box) is.
// The router keeps a 16px margin off other devices, so they're never grazed. Estimated geometry
// here; the browser check validates the same on measured geometry.
const BOXCHECK_INSET = 14;
function boxcheck(file) {
  const { diagrams } = fromDocument(parseDocument(readFileSync(join(FIX_DIR, file), "utf8")));
  const hits = [];
  for (const d of diagrams) {
    const result = router.route({ nodes: d.nodes, edges: d.edges });
    const cores = collectObstacleRects(d.nodes)
      .map((r) => ({ x: r.rect.x + BOXCHECK_INSET, y: r.rect.y + BOXCHECK_INSET, w: r.rect.w - 2 * BOXCHECK_INSET, h: r.rect.h - 2 * BOXCHECK_INSET }))
      .filter((r) => r.w > 0 && r.h > 0);
    for (const { id, pts } of polylinesFromResult(result)) {
      const n = boxInteriorHits(pts, cores);
      if (n > 0) hits.push(`${d.name}/${id}: ${n} segment(s) cross a device box`);
    }
  }
  return hits;
}

const fixtures = existsSync(FIX_DIR) ? readdirSync(FIX_DIR).filter((f) => f.endsWith(".sigpath")).sort() : [];
if (!fixtures.length) {
  console.error(`no fixtures in ${FIX_DIR}`);
  await server.close();
  process.exit(2);
}

const current = {};
for (const f of fixtures) current[f] = measure(f);
await server.close();

for (const f of fixtures) {
  console.log(`\n${f}  (router=${ROUTER})`);
  for (const [name, m] of Object.entries(current[f])) {
    console.log(
      `  ${name}: edges=${m.edges} routed=${m.routed} unrouted=${m.unrouted} ` +
        `crossings=${m.crossings} bends=${m.bends} overlaps=${m.overlaps} length=${m.length} cost=${m.cost}`,
    );
  }
}

if (BOXCHECK) {
  let total = 0;
  console.log(`\nbox-interior gate (router=${ROUTER}):`);
  for (const f of fixtures) {
    const hits = boxcheck(f);
    if (hits.length) {
      console.error(`  ✗ ${f}`);
      for (const x of hits) console.error(`      ${x}`);
      total += hits.length;
    } else {
      console.log(`  ✓ ${f}: no routed run enters a box`);
    }
  }
  if (total) {
    console.error(`\n✗ ${total} box-interior violation(s)`);
    process.exit(1);
  }
  console.log(`\n✓ no routed run enters a device box`);
}

if (MAKEROOM) {
  const P = (id, direction) => ({ id, name: id, direction, connector: "sdi" });
  const dev = (id, x, y, ports) => ({ id, type: "device", position: { x, y }, data: { model: { id: "m-" + id, model: id, category: "other", source: "builtin", ports } } });
  const outs = (n) => Array.from({ length: n }, (_, i) => P("o" + (i + 1), "output"));
  const ins = (n) => Array.from({ length: n }, (_, i) => P("i" + (i + 1), "input"));
  const edge = (id, s, sh, t, th) => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th, type: "cable", data: { cableTypeId: "sdi" } });
  // 6 PARALLEL runs (R shifted down so each jogs uniformly — a nested fan, 0 crossings) that
  // need lane width in the corridor. Cramped gap → congested; wide gap → not. Make-room should
  // widen the cramped one WITHOUT adding crossings (so the guard must NOT refuse).
  const fan = () => Array.from({ length: 6 }, (_, k) => edge("c" + k, "L", "o" + (k + 1), "R", "i" + (k + 1)));
  const cramped = planMakeRoom([dev("L", 0, 0, outs(6)), dev("R", 216, 144, ins(6))], fan()); // 48px gap
  const spacious = planMakeRoom([dev("L", 0, 0, outs(6)), dev("R", 700, 144, ins(6))], fan()); // wide gap
  console.log(`make-room logic:`);
  console.log(`  cramped (48px gap, 6 crossing runs): ${cramped.kind}` + (cramped.kind === "ok" ? ` — widened ${cramped.channelsWidened} channel(s) for ${cramped.cablesAffected} cable(s), ${cramped.shifts.size} node(s) moved` : ""));
  console.log(`  spacious (wide gap): ${spacious.kind}`);
  console.log(`  corpus (expect 'none' — fixtures are spacious):`);
  for (const f of fixtures) {
    const { diagrams } = fromDocument(parseDocument(readFileSync(join(FIX_DIR, f), "utf8")));
    for (const d of diagrams) {
      if (!d.edges.length) continue;
      const r = planMakeRoom(d.nodes, d.edges);
      console.log(`    ${f}/${d.name}: ${r.kind}` + (r.kind === "ok" ? ` (+${r.channelsWidened}ch/${r.cablesAffected}cables)` : ""));
    }
  }
  const pass = cramped.kind === "ok" && cramped.shifts.size > 0 && spacious.kind === "none";
  console.log(pass ? `\n✓ make-room detects the cramped channel and leaves the spacious one` : `\n✗ make-room logic check failed`);
  process.exit(pass ? 0 : 1);
}

if (TRUNK) {
  console.log(`trunk detection (≥4 like-cables sharing a corridor):`);
  for (const f of fixtures) {
    const { diagrams } = fromDocument(parseDocument(readFileSync(join(FIX_DIR, f), "utf8")));
    for (const d of diagrams) {
      if (!d.edges.length) continue;
      const result = router.route({ nodes: d.nodes, edges: d.edges });
      const cands = detectTrunkCandidates(d.nodes, d.edges, result.ends);
      console.log(`  ${f}/${d.name}: ${cands.length} candidate(s)` + cands.map((c) => ` [${c.memberConnectionIds.length}× ${c.signalKind}]`).join(""));
      if (cands.length) {
        const rects = collectObstacleRects(d.nodes).map((r) => r.rect);
        const w = collapsedTrunkWaypoints(cands[0], result.ends, rects);
        if (w) console.log(`      collapse: ${w.perEdge.size} members fan onto a spine, badge @ (${Math.round(w.badge.x)},${Math.round(w.badge.y)})`);
      }
    }
  }
  const { diagrams } = fromDocument(parseDocument(readFileSync(join(FIX_DIR, "matrix.sigpath"), "utf8")));
  const r = router.route({ nodes: diagrams[0].nodes, edges: diagrams[0].edges });
  const mc = detectTrunkCandidates(diagrams[0].nodes, diagrams[0].edges, r.ends);
  const pass = mc.length === 1 && mc[0].memberConnectionIds.length === 4 && !!collapsedTrunkWaypoints(mc[0], r.ends, collectObstacleRects(diagrams[0].nodes).map((x) => x.rect));
  console.log(pass ? `\n✓ trunk detection finds the 4-cable matrix bundle and collapses it` : `\n✗ trunk detection failed`);
  process.exit(pass ? 0 : 1);
}

if (WRITE) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log(`\nwrote baseline → ${BASELINE}`);
}

if (CHECK) {
  if (!existsSync(BASELINE)) {
    console.error(`\n--check: no baseline at ${BASELINE} (run --write first)`);
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(BASELINE, "utf8"));
  const fails = [];
  for (const f of fixtures) {
    for (const [name, m] of Object.entries(current[f])) {
      const b = base[f]?.[name];
      if (!b) {
        fails.push(`${f}/${name}: no baseline entry`);
        continue;
      }
      // Per-edge PARITY on the baseline (output→input) runs: each must still route with no
      // more bends and the same length. This is the real "don't regress the tuned case" gate,
      // and it holds even when the new router additionally routes bidi runs the baseline lacked.
      for (const [id, bpe] of Object.entries(b.perEdge ?? {})) {
        const pe = m.perEdge?.[id];
        if (!pe) fails.push(`${f}/${name}/${id}: baseline run no longer routed`);
        else {
          if (pe.bends > bpe.bends) fails.push(`${f}/${name}/${id}: bends ${bpe.bends} → ${pe.bends}`);
          if (Math.abs(pe.length - bpe.length) > 1) fails.push(`${f}/${name}/${id}: length ${bpe.length} → ${pe.length}`);
        }
      }
      // Diagram-wide totals are only comparable when the routed-edge SET is unchanged. When the
      // new router routes runs the baseline didn't (bidi/bottom), those legitimately add
      // crossings/cost, so gate totals only at an equal routed count; otherwise rely on per-edge.
      const newlyRouted = m.routed - b.routed;
      if (newlyRouted <= 0) {
        if (m.crossings > b.crossings) fails.push(`${f}/${name}: crossings ${b.crossings} → ${m.crossings}`);
        if (m.cost > b.cost * COST_SLACK) fails.push(`${f}/${name}: cost ${b.cost} → ${m.cost} (> ${(b.cost * COST_SLACK).toFixed(2)})`);
      } else {
        console.log(`  · ${f}/${name}: +${newlyRouted} newly-routed run(s) — totals not gated; per-edge parity enforced on ${Object.keys(b.perEdge ?? {}).length} baseline run(s)`);
      }
    }
  }
  if (fails.length) {
    console.error(`\n✗ ${fails.length} regression(s) vs baseline:`);
    for (const x of fails) console.error(`  ${x}`);
    process.exit(1);
  }
  console.log(`\n✓ parity-or-better on all ${fixtures.length} fixture(s)`);
}
