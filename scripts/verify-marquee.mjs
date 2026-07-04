// Verify marquee edge selection hits exactly the cables it visually covers (dense-real):
// a shift-drag box over the VID-001..010 bundle must select those 10 runs and must NOT
// phantom-select bidi NET runs (whose old standard-Z hit approximation landed at port
// row 0, right across the bundle). Uses the same stubbed-Tauri flow as the other gates.
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "routing", "dense-real.sigpath");
const PORT = 5196;

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

const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stub });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".react-flow__edge-path", { timeout: 15000 });
await page.waitForTimeout(1000);
const fit = page.locator(".react-flow__controls-fitview");
if (await fit.count()) await fit.click();
await page.waitForTimeout(500);

// Marquee rect (screen coords) covering the middle of the VID-001..010 corridor, derived
// from the routed geometry so the test doesn't depend on the saved viewport.
const box = await page.evaluate(() => {
  const dbg = window.__routeDebug;
  const vids = dbg.edges.filter((e) => /^VID-0(0[1-9]|10)$/.test(e.data?.number ?? ""));
  const ends = new Map(dbg.ends);
  const es = vids.map((e) => ends.get(e.id)).filter(Boolean);
  const midX = (Math.min(...es.map((e) => e.sx)) + Math.max(...es.map((e) => e.tx))) / 2;
  const rect = {
    x: midX - 40,
    y: Math.min(...es.map((e) => Math.min(e.sy, e.ty))) - 8,
    x2: midX + 40,
    y2: Math.max(...es.map((e) => Math.max(e.sy, e.ty))) + 8,
  };
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(
    document.querySelector(".react-flow__viewport").style.transform,
  );
  const [tx, ty, zoom] = [+m[1], +m[2], +m[3]];
  const flowEl = document.querySelector(".react-flow").getBoundingClientRect();
  const toScreen = (x, y) => ({ x: flowEl.x + x * zoom + tx, y: flowEl.y + y * zoom + ty });
  return { from: toScreen(rect.x, rect.y), to: toScreen(rect.x2, rect.y2), count: vids.length };
});
check("found the 10 VID-001..010 runs", box.count === 10);

await page.keyboard.down("Shift");
await page.mouse.move(box.from.x, box.from.y);
await page.mouse.down();
await page.mouse.move((box.from.x + box.to.x) / 2, (box.from.y + box.to.y) / 2, { steps: 4 });
await page.mouse.move(box.to.x, box.to.y, { steps: 4 });
await page.mouse.up();
await page.keyboard.up("Shift");
await page.waitForTimeout(400);

const sel = await page.evaluate(() => {
  const dbg = window.__routeDebug;
  const numbers = new Map(dbg.edges.map((e) => [e.id, e.data?.number ?? e.id]));
  return [...document.querySelectorAll(".react-flow__edge.selected")].map((g) =>
    numbers.get(g.getAttribute("data-id")),
  );
});
const vidSel = sel.filter((n) => /^VID-0(0[1-9]|10)$/.test(n ?? ""));
const phantom = sel.filter((n) => !/^VID-0(0[1-9]|10)$/.test(n ?? ""));
console.log(`selected: ${sel.length} → [${sel.join(", ")}]`);
check("all 10 VID runs selected", vidSel.length === 10);
check("no phantom selections (NET-* etc.)", phantom.length === 0);
const barTitle = await page.evaluate(() => document.querySelector(".contextbar__title")?.textContent ?? "");
check("bar reads '10 cables selected'", barTitle.includes("10 cables selected"));
check("grade controls present (all-SDI selection)", await page.evaluate(() => document.querySelector(".contextbar")?.textContent.includes("Cable grade") ?? false));
check("Bundle button present", (await page.locator(".contextbar").getByRole("button", { name: "⧉ Bundle" }).count()) === 1);

await browser.close();
await server.close();
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ marquee selects exactly what it covers");
process.exit(process.exitCode ?? 0);
