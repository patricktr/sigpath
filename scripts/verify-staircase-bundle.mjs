// Recreate the user's staircase scenario: bundle VID-004/005/006 (dense-real) amid the
// VID-001..010 fan and count REAL drawn crossings between the bundle and the other cables.
// A zero-crossing slot exists between the VID-001..003 and VID-007..010 staircases; before
// the context grid lines the A* couldn't reach it (3 crossings), now it should.
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "routing", "dense-real.sigpath");
const OUT = process.env.SHOT_DIR ?? ROOT;
const PORT = 5194;

const stub = `
  (() => {
    let n = 0; const cbs = {}; const listeners = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {}, convertFileSrc(p) { return p; },
      invoke(cmd, a) {
        if (cmd === "plugin:event|listen") { listeners[a.event] = a.handler; return Promise.resolve(n); }
        if (cmd === "take_pending_open") return Promise.resolve({ kind: "file", path: "/@fs${FIX}" });
        if (cmd === "read_file") return fetch(a.path).then((r) => r.text());
        return Promise.resolve(null);
      },
    };
    try { localStorage.removeItem("sigpath.router"); } catch {}
  })();
`;

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stub });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".react-flow__edge-path", { timeout: 15000 });
await page.waitForTimeout(1000);

const idOf = await page.evaluate(() => {
  const m = {};
  for (const e of window.__routeDebug.edges) if (e.data?.number) m[e.data.number] = e.id;
  return m;
});
const clickEdge = (id, meta) =>
  page.evaluate(
    ([edgeId, withMeta]) => {
      const g = document.querySelector(`.react-flow__edge[data-id="${edgeId}"]`);
      const p = g?.querySelector(".react-flow__edge-interaction") ?? g?.querySelector(".react-flow__edge-path");
      if (!p) return "missing " + edgeId;
      const o = { bubbles: true, view: window, button: 0, metaKey: !!withMeta, ctrlKey: !!withMeta };
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) p.dispatchEvent(new MouseEvent(t, o));
      return "ok";
    },
    [id, meta],
  );

// Bundle VID-004/005/006
for (const [i, num] of ["VID-004", "VID-005", "VID-006"].entries()) {
  if (i > 0) await page.keyboard.down("Meta");
  await clickEdge(idOf[num], i > 0);
  if (i > 0) await page.keyboard.up("Meta");
  await page.waitForTimeout(120);
}
await page.locator(".contextbar").getByRole("button", { name: "⧉ Bundle" }).click();
await page.waitForTimeout(600);
await page.mouse.click(300, 950);
await page.waitForTimeout(400);

// Count proper crossings between the bundle members' drawn paths and the other VID cables.
const result = await page.evaluate((ids) => {
  const parse = (d) => {
    const pts = [];
    for (const m of d.matchAll(/([MLQA])([^MLQA]*)/g)) {
      const nums = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
      if ((m[1] === "M" || m[1] === "L") && nums.length >= 2) pts.push({ x: nums[0], y: nums[1] });
      else if (m[1] === "Q" && nums.length >= 4) pts.push({ x: nums[0], y: nums[1] }, { x: nums[2], y: nums[3] });
      else if (m[1] === "A" && nums.length >= 7) pts.push({ x: nums[5], y: nums[6] });
    }
    return pts;
  };
  const poly = (num) => {
    const d = document.querySelector(`.react-flow__edge[data-id="${ids[num]}"] .react-flow__edge-path`)?.getAttribute("d");
    return d ? parse(d) : null;
  };
  const crossings = (a, b) => {
    let n = 0;
    for (let i = 1; i < a.length; i++) {
      for (let j = 1; j < b.length; j++) {
        const a1 = a[i - 1], a2 = a[i], b1 = b[j - 1], b2 = b[j];
        const aH = Math.abs(a1.y - a2.y) <= 0.75, bH = Math.abs(b1.y - b2.y) <= 0.75;
        const aV = Math.abs(a1.x - a2.x) <= 0.75, bV = Math.abs(b1.x - b2.x) <= 0.75;
        if (!((aH && bV) || (aV && bH))) continue;
        const h1 = aH ? a1 : b1, h2 = aH ? a2 : b2, v1 = aH ? b1 : a1, v2 = aH ? b2 : a2;
        if (
          v1.x > Math.min(h1.x, h2.x) + 0.75 && v1.x < Math.max(h1.x, h2.x) - 0.75 &&
          h1.y > Math.min(v1.y, v2.y) + 0.75 && h1.y < Math.max(v1.y, v2.y) - 0.75
        ) n++;
      }
    }
    return n;
  };
  const bundle = ["VID-004", "VID-005", "VID-006"].map(poly).filter(Boolean);
  const others = ["VID-001", "VID-002", "VID-003", "VID-007", "VID-008", "VID-009", "VID-010"].map(poly).filter(Boolean);
  // Bundle members overlap on the spine — count each unique crossing point once.
  const pointsSeen = new Set();
  let total = 0;
  for (const bp of bundle) {
    for (const op of others) {
      for (let i = 1; i < bp.length; i++) {
        for (let j = 1; j < op.length; j++) {
          const a1 = bp[i - 1], a2 = bp[i], b1 = op[j - 1], b2 = op[j];
          const aH = Math.abs(a1.y - a2.y) <= 0.75, bV = Math.abs(b1.x - b2.x) <= 0.75;
          const aV = Math.abs(a1.x - a2.x) <= 0.75, bH = Math.abs(b1.y - b2.y) <= 0.75;
          let pt = null;
          if (aH && bV &&
            b1.x > Math.min(a1.x, a2.x) + 0.75 && b1.x < Math.max(a1.x, a2.x) - 0.75 &&
            a1.y > Math.min(b1.y, b2.y) + 0.75 && a1.y < Math.max(b1.y, b2.y) - 0.75) pt = `${Math.round(b1.x)},${Math.round(a1.y)}`;
          if (aV && bH &&
            a1.x > Math.min(b1.x, b2.x) + 0.75 && a1.x < Math.max(b1.x, b2.x) - 0.75 &&
            b1.y > Math.min(a1.y, a2.y) + 0.75 && b1.y < Math.max(a1.y, a2.y) - 0.75) pt = `${Math.round(a1.x)},${Math.round(b1.y)}`;
          if (pt && !pointsSeen.has(pt)) { pointsSeen.add(pt); total++; }
        }
      }
    }
  }
  return { total, points: [...pointsSeen] };
}, idOf);
if (result.total > 0) process.exitCode = 1;
console.log(`${result.total === 0 ? "✓" : "✗"} bundle↔other crossings: ${result.total}`, result.points.length ? `at ${result.points.join(" ")}` : "");

// Screenshot the corridor
const focus = await page.evaluate((ids) => {
  const dbg = window.__routeDebug;
  const ends = new Map(dbg.ends);
  const es = ["VID-004", "VID-005", "VID-006"].map((n) => ends.get(ids[n])).filter(Boolean);
  const fx = (Math.max(...es.map((e) => e.sx)) + Math.min(...es.map((e) => e.tx))) / 2;
  const fy = (Math.min(...es.map((e) => Math.min(e.sy, e.ty))) + Math.max(...es.map((e) => Math.max(e.sy, e.ty)))) / 2;
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(
    document.querySelector(".react-flow__viewport").style.transform,
  );
  const [tx, ty, zoom] = [+m[1], +m[2], +m[3]];
  const el = document.querySelector(".react-flow").getBoundingClientRect();
  return { x: el.x + fx * zoom + tx, y: el.y + fy * zoom + ty };
}, idOf);
await page.mouse.move(focus.x, focus.y);
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
await page.screenshot({
  path: join(OUT, "shot-staircase-bundle.png"),
  clip: { x: Math.max(0, focus.x - 550), y: Math.max(0, focus.y - 380), width: 1000, height: 760 },
});
console.log("shot-staircase-bundle.png");
await browser.close();
await server.close();
process.exit(0);
