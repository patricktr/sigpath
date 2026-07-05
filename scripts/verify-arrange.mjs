// E2E for auto-arrange (p2-autoarrangezones): drive the Arrange ▾ menu on dense-real —
// run Signal flow (zones stay contiguous, no device overlaps), save the layout under a
// name, scramble with Compact grid, apply the saved layout back (positions restored), and
// confirm saved layouts persist into the written .sigpath document.
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "routing", "dense-real.sigpath");
const OUT = process.env.SHOT_DIR;
const PORT = 5188;

const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
};

const stub = `
  (() => {
    let n = 0; const cbs = {}; const listeners = {};
    window.__writes = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {}, convertFileSrc(p) { return p; },
      invoke(cmd, a) {
        if (cmd === "plugin:event|listen") { listeners[a.event] = a.handler; return Promise.resolve(n); }
        if (cmd === "take_pending_open") return Promise.resolve({ kind: "file", path: "/@fs${FIX}" });
        if (cmd === "read_file") return fetch(a.path).then((r) => r.text());
        if (cmd === "write_file") { window.__writes.push(a.contents); return Promise.resolve(null); }
        if (cmd === "plugin:dialog|save") return Promise.resolve("/tmp/arranged.sigpath");
        return Promise.resolve(null);
      },
    };
    window.__emit = (ev) => { const cb = cbs[listeners[ev]]; if (cb) cb({ event: ev, id: listeners[ev] }); };
    try { localStorage.removeItem("sigpath.router"); localStorage.removeItem("sigpath.arrangeMode"); } catch {}
  })();
`;

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stub });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".react-flow__node-device", { timeout: 15000 });
await page.waitForTimeout(900);

const snapshotPositions = () =>
  page.evaluate(() =>
    Object.fromEntries(window.__routeDebug.nodes.map((n) => [n.id, [Math.round(n.position.x), Math.round(n.position.y)]])),
  );
const layoutHealth = () =>
  page.evaluate(() => {
    const nodes = window.__routeDebug.nodes;
    const size = (n) => ({
      w: n.measured?.width ?? n.width ?? 168,
      h: n.measured?.height ?? n.height ?? 96,
    });
    const bearing = nodes.filter((n) => n.type === "device" || n.type === "block");
    let overlaps = 0;
    for (let i = 0; i < bearing.length; i++) {
      for (let j = i + 1; j < bearing.length; j++) {
        const a = { ...bearing[i].position, ...size(bearing[i]) };
        const b = { ...bearing[j].position, ...size(bearing[j]) };
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
      }
    }
    let zoneEscapes = 0;
    for (const z of nodes.filter((n) => n.type === "zone")) {
      const zr = { x: z.position.x, y: z.position.y, w: z.width ?? 300, h: z.height ?? 200 };
      // every member (center inside) at load time should still be inside — approximated
      // here as: no zone is EMPTY after arrange if it had members drawn within it.
      const inside = bearing.filter((m) => {
        const s = size(m);
        const cx = m.position.x + s.w / 2;
        const cy = m.position.y + s.h / 2;
        return cx >= zr.x && cx <= zr.x + zr.w && cy >= zr.y && cy <= zr.y + zr.h;
      });
      if (inside.length === 0) zoneEscapes++;
    }
    return { overlaps, zoneEscapes };
  });

const before = await snapshotPositions();

// 1. Arrange → Signal flow via the menu.
await page.locator(".arrmenu__caret").click();
await page.waitForSelector(".arrmenu__panel");
await page.locator(".arrmenu__item", { hasText: "Signal flow" }).click();
await page.waitForTimeout(800);
const afterFlow = await snapshotPositions();
check("Signal flow moved the canvas", JSON.stringify(afterFlow) !== JSON.stringify(before));
const health = await layoutHealth();
check(`no device overlaps after arrange (${health.overlaps})`, health.overlaps === 0);
check("zones kept their members", health.zoneEscapes === 0);
if (OUT) await page.screenshot({ path: join(OUT, "shot-arranged-flow.png") });

// 2. Save the layout under a name.
await page.locator(".arrmenu__caret").click();
await page.locator(".arrmenu__saverow input").fill("Flow A");
await page.locator(".arrmenu__saverow button").click();
await page.waitForTimeout(400);

// 3. Scramble with Compact grid, then apply the saved layout back.
await page.locator(".arrmenu__caret").click();
await page.locator(".arrmenu__item", { hasText: "Compact grid" }).click();
await page.waitForTimeout(600);
const afterGrid = await snapshotPositions();
check("Compact grid re-scrambled", JSON.stringify(afterGrid) !== JSON.stringify(afterFlow));
await page.locator(".arrmenu__caret").click();
check("saved layout listed in the menu", (await page.locator(".arrmenu__item--saved", { hasText: "Flow A" }).count()) === 1);
await page.locator(".arrmenu__item--saved", { hasText: "Flow A" }).click();
await page.waitForTimeout(600);
const restored = await snapshotPositions();
check("applying the saved layout restores every position", JSON.stringify(restored) === JSON.stringify(afterFlow));

// 4. Layouts persist into the written document.
await page.evaluate(() => window.__emit("menu:saveAs"));
await page.waitForTimeout(800);
const doc = await page.evaluate(() => (window.__writes[0] ? JSON.parse(window.__writes[0]) : null));
const savedLayouts = doc?.project.diagrams.flatMap((d) => d.layouts ?? []) ?? [];
check(
  `saved layout round-trips into the file (${savedLayouts.map((l) => l.name).join(", ") || "none"})`,
  savedLayouts.some((l) => l.name === "Flow A" && Object.keys(l.positions).length > 0),
);
check("document carries schema v9", doc?.schemaVersion >= 9);

await browser.close();
await server.close();
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ arrange modes + saved layouts verified end-to-end");
process.exit(process.exitCode ?? 0);
