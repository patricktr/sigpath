// Headless MEASURED-geometry routing gate.
//
// The node harness (route-metrics.mjs) runs the router on ESTIMATED geometry, which provably
// cannot see measured-only failures (the P2 own-device clip, hop misalignment on real jack
// positions). This gate drives the REAL app in headless Chromium: it stubs the Tauri layer
// (same technique as the manual preview recipe), auto-opens each routing fixture through the
// app's own pending-open path, waits for routing to settle on measured handles, then asserts
// on the DRAWN SVG paths:
//
//   1. box gate — no cable segment passes through any device/block core (rect inset 14,
//      the same bar as route-metrics --boxcheck, but on what's actually on screen)
//   2. hop gate — every crossing bump (arc) sits ON a vertical segment of another cable,
//      so bumps mark real crossings instead of the estimate's ghost
//   3. no [router] give-up warnings (fixtures must route everything cleanly)
//
// Usage:
//   node scripts/browser-route-check.mjs             all fixtures
//   node scripts/browser-route-check.mjs big-grid    just one (basename, no extension)
//   node scripts/browser-route-check.mjs --headed    watch it run
//
// Requires: pnpm add -D playwright && npx playwright install chromium (one-time).

import { createServer } from "vite";
import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX_DIR = join(ROOT, "fixtures", "routing");
const PORT = 5199;
const CORE_INSET = 14; // matches route-metrics BOXCHECK_INSET
const HOP_X_TOL = 2; // px a bump center may sit off the vertical it crosses

const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const only = args.filter((a) => !a.startsWith("--"));
const fixtures = readdirSync(FIX_DIR)
  .filter((f) => f.endsWith(".sigpath"))
  .filter((f) => !only.length || only.includes(f.replace(/\.sigpath$/, "")))
  .sort();
if (!fixtures.length) {
  console.error(`no matching fixtures in ${FIX_DIR}`);
  process.exit(2);
}

// ---- Tauri stub, injected before any app code runs (fixture-specific) ----------------------
const stubFor = (fixtureUrl) => `
  (() => {
    let n = 0;
    const cbs = {};
    const listeners = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {},
      convertFileSrc(p) { return p; },
      invoke(cmd, invokeArgs) {
        if (cmd === "plugin:event|listen") { listeners[invokeArgs.event] = invokeArgs.handler; return Promise.resolve(n); }
        if (cmd === "take_pending_open") return Promise.resolve({ kind: "file", path: ${JSON.stringify(fixtureUrl)} });
        if (cmd === "read_file") return fetch(invokeArgs.path).then((r) => { if (!r.ok) throw new Error("fetch " + r.status); return r.text(); });
        if (cmd === "plugin:dialog|open") return Promise.resolve(${JSON.stringify(fixtureUrl)});
        if (cmd === "plugin:dialog|message") { const b = invokeArgs.buttons; return Promise.resolve(b && b.OkCancelCustom ? b.OkCancelCustom[0] : "Ok"); }
        return Promise.resolve(null);
      },
    };
    window.__emit = (ev) => { const cb = cbs[listeners[ev]]; if (cb) cb({ event: ev, id: listeners[ev] }); };
    try { localStorage.removeItem("sigpath.router"); localStorage.setItem("sigpath.hops", "1"); } catch {}
  })();
`;

// ---- SVG path parsing (cablePath / getSmoothStepPath output only: M L Q A, absolute) --------
function parsePath(d) {
  const pts = [];
  const hops = [];
  const re = /([MLQA])([^MLQA]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    const cmd = m[1];
    if (cmd === "M" && nums.length >= 2) pts.push({ x: nums[0], y: nums[1] });
    else if (cmd === "L" && nums.length >= 2) pts.push({ x: nums[0], y: nums[1] });
    else if (cmd === "Q" && nums.length >= 4) {
      // Rounded corner: the control point IS the sharp corner — include it so the parsed
      // polyline matches the sharp geometry hops were detected on (a crossing within the
      // corner radius still counts as covered by this segment).
      pts.push({ x: nums[0], y: nums[1] }, { x: nums[2], y: nums[3] });
    }
    else if (cmd === "A" && nums.length >= 7) {
      const end = { x: nums[5], y: nums[6] };
      const prev = pts[pts.length - 1];
      if (prev) hops.push({ x: (prev.x + end.x) / 2, y: (prev.y + end.y) / 2 });
      pts.push(end); // chord — fine for the box test (bump bulge is 6px, inset is 14)
    }
  }
  return { pts, hops };
}

const segHitsCore = (a, b, r) => {
  const xlo = Math.min(a.x, b.x);
  const xhi = Math.max(a.x, b.x);
  const ylo = Math.min(a.y, b.y);
  const yhi = Math.max(a.y, b.y);
  return xlo < r.x + r.w && r.x < xhi && ylo < r.y + r.h && r.y < yhi;
};

// ---- Drive ---------------------------------------------------------------------------------
const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: !HEADED });

let totalViolations = 0;
for (const f of fixtures) {
  const page = await browser.newPage();
  const routerWarnings = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning" && msg.text().includes("[router]")) routerWarnings.push(msg.text());
  });
  // Determinism: nothing leaves localhost (catalog sync etc. just fails quietly, as designed).
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`http://localhost:${PORT}`)) return route.continue();
    return route.abort();
  });
  await page.addInitScript({ content: stubFor(`/@fs${FIX_DIR}/${f}`) });
  await page.goto(`http://localhost:${PORT}/`);

  // Wait for the fixture to load + routing to settle on measured geometry: the drawn path
  // signature must be non-empty and stable across two samples.
  const signature = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".react-flow__edge-path")].map((p) => p.getAttribute("d")).join("|"),
    );
  let sig = "";
  let ok = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(350);
    const next = await signature();
    if (next && next === sig) {
      ok = true;
      break;
    }
    sig = next;
  }
  if (!ok) {
    console.error(`✗ ${f}: fixture never rendered/settled (no stable edge paths)`);
    totalViolations++;
    await page.close();
    continue;
  }

  const { rects, edges } = await page.evaluate(() => {
    const rects = [...document.querySelectorAll(".react-flow__node-device, .react-flow__node-block")].map((el) => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform) ?? [0, "0", "0"];
      return { x: +m[1], y: +m[2], w: el.offsetWidth, h: el.offsetHeight };
    });
    const edges = [...document.querySelectorAll(".react-flow__edge")].map((g) => ({
      id: g.getAttribute("data-id"),
      d: g.querySelector(".react-flow__edge-path")?.getAttribute("d") ?? "",
    }));
    return { rects, edges };
  });

  const cores = rects
    .map((r) => ({ x: r.x + CORE_INSET, y: r.y + CORE_INSET, w: r.w - 2 * CORE_INSET, h: r.h - 2 * CORE_INSET }))
    .filter((r) => r.w > 0 && r.h > 0);
  const parsed = edges.map((e) => ({ id: e.id, ...parsePath(e.d) }));

  const problems = [];

  // 1. box gate on drawn geometry
  for (const e of parsed) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const hit = cores.find((c) => segHitsCore(e.pts[i], e.pts[i + 1], c));
      if (hit) {
        problems.push(`${e.id}: drawn segment (${Math.round(e.pts[i].x)},${Math.round(e.pts[i].y)})→(${Math.round(e.pts[i + 1].x)},${Math.round(e.pts[i + 1].y)}) crosses a device core`);
      }
    }
  }

  // 2. hop-alignment gate: each bump must sit on a vertical segment of ANOTHER edge
  for (const e of parsed) {
    for (const hop of e.hops) {
      const aligned = parsed.some(
        (o) =>
          o.id !== e.id &&
          o.pts.some((p, i) => {
            if (i === 0) return false;
            const q = o.pts[i - 1];
            if (Math.abs(p.x - q.x) > 0.75) return false; // not vertical
            const lo = Math.min(p.y, q.y);
            const hi = Math.max(p.y, q.y);
            return Math.abs(p.x - hop.x) <= HOP_X_TOL && hop.y > lo && hop.y < hi;
          }),
      );
      if (!aligned) problems.push(`${e.id}: bump at (${Math.round(hop.x)},${Math.round(hop.y)}) sits on no crossing vertical`);
    }
  }

  // 3. router give-ups
  for (const w of routerWarnings) problems.push(`give-up: ${w}`);

  if (args.includes("--dump")) {
    const dump = await page.evaluate(() => JSON.stringify(window.__routeDebug));
    const { writeFileSync } = await import("node:fs");
    const out = join(FIX_DIR, "..", "..", "route-debug-" + f.replace(/\.sigpath$/, "") + ".json");
    writeFileSync(out, dump ?? "null");
    console.log(`  dumped __routeDebug → ${out}`);
  }

  const nEdges = parsed.length;
  const nHops = parsed.reduce((s, e) => s + e.hops.length, 0);
  if (problems.length) {
    console.error(`✗ ${f} (${rects.length} boxes, ${nEdges} cables, ${nHops} bumps)`);
    for (const p of problems) console.error(`    ${p}`);
    totalViolations += problems.length;
  } else {
    console.log(`✓ ${f}: ${rects.length} boxes, ${nEdges} cables, ${nHops} bumps — clean on measured geometry`);
  }
  await page.close();
}

await browser.close();
await server.close();
if (totalViolations) {
  console.error(`\n✗ ${totalViolations} measured-geometry violation(s)`);
  process.exit(1);
}
console.log(`\n✓ measured-geometry gate: all ${fixtures.length} fixture(s) clean`);
