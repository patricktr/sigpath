// Verify the vertical bottom-port bank: long "Device · Port" boundary names rotate the io
// labels vertical (narrow node), while ordinary short-named banks stay horizontal.
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = join(ROOT, "scratch-io-vertical.sigpath");
const OUT = process.env.SHOT_DIR ?? ROOT;
const PORT = 5192;

const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
};

// Build the fixture through the real serializer (like make-routing-fixtures).
const ssr = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { toDocument } = await ssr.ssrLoadModule("/src/io/serialize.ts");
const P = (id, direction, connector, name) => ({ id, name, direction, connector });
const LONG = "Blackmagic Design ATEM 4 M/E Constellation HD";
const nodes = [
  {
    id: "blocky",
    type: "device",
    position: { x: 0, y: 0 },
    data: {
      model: {
        id: "m-blocky",
        model: "Room A",
        category: "other",
        source: "custom",
        ports: [
          P("i1", "input", "sdi", `${LONG} · SDI In 1`),
          P("o1", "output", "sdi", `${LONG} · Flexible Out 1`),
          P("b1", "bidirectional", "rj45", `${LONG} · Ethernet`),
          P("b2", "bidirectional", "usb-c", `${LONG} · USB-C`),
          P("b3", "bidirectional", "rs422", `${LONG} · Talkback Expansion`),
        ],
      },
      label: "Room A",
    },
  },
];
writeFileSync(SCRATCH, JSON.stringify(toDocument([{ id: "d1", name: "Diagram 1", nodes, edges: [] }], { projectId: "p", projectName: "io-vertical" }), null, 2));
await ssr.close();

const stubFor = (fixture) => `
  (() => {
    let n = 0; const cbs = {}; const listeners = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {}, convertFileSrc(p) { return p; },
      invoke(cmd, a) {
        if (cmd === "plugin:event|listen") { listeners[a.event] = a.handler; return Promise.resolve(n); }
        if (cmd === "take_pending_open") return Promise.resolve({ kind: "file", path: ${JSON.stringify(fixture)} });
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

// 1. Long boundary-style names → vertical bank, narrow node.
let page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stubFor(`/@fs${SCRATCH}`) });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".device-node__io", { timeout: 15000 });
await page.waitForTimeout(600);
check("long names flip the bank vertical", (await page.locator(".device-node__io--vertical").count()) === 1);
const io = await page.evaluate(() => {
  const label = document.querySelector(".device-node__io--vertical .port__label");
  const node = document.querySelector(".react-flow__node-device");
  const cols = [...document.querySelectorAll(".device-node__io--vertical .port--io")];
  const handles = [...document.querySelectorAll(".device-node__io--vertical .port__io-anchor")];
  const nodeBox = node.getBoundingClientRect();
  return {
    writingMode: getComputedStyle(label).writingMode,
    maxColWidth: Math.max(...cols.map((c) => c.offsetWidth)),
    handlesAtBottom: handles.every((h) => nodeBox.bottom - h.getBoundingClientRect().bottom < 24),
  };
});
check(`labels are vertical (writing-mode ${io.writingMode})`, io.writingMode === "vertical-rl");
check(`each io port is a narrow column (widest ${io.maxColWidth}px)`, io.maxColWidth < 40);
check("jacks stay anchored at the bottom edge", io.handlesAtBottom);
const nodeEl = await page.locator(".react-flow__node-device").boundingBox();
await page.screenshot({
  path: join(OUT, "shot-io-vertical.png"),
  clip: { x: Math.max(0, nodeEl.x - 30), y: Math.max(0, nodeEl.y - 30), width: nodeEl.width + 60, height: nodeEl.height + 60 },
});
await page.close();

// 2. Ordinary devices (dense-real) keep horizontal banks.
page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stubFor(`/@fs${join(ROOT, "fixtures", "routing", "dense-real.sigpath")}`) });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".device-node__io", { timeout: 15000 });
await page.waitForTimeout(600);
check(
  "short-named banks stay horizontal on the real diagram",
  (await page.locator(".device-node__io--vertical").count()) === 0 && (await page.locator(".device-node__io").count()) > 0,
);

await browser.close();
await server.close();
rmSync(SCRATCH, { force: true });
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ vertical io bank verified");
process.exit(process.exitCode ?? 0);
