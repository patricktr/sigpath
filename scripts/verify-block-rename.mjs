// Verify renaming a tab renames its embedded blocks: build a project where "Main" embeds
// "Room B" as a block, rename the Room B tab through the tab-strip UI, and assert the
// block's header on the Main canvas follows the new name.
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = join(ROOT, "scratch-block-rename.sigpath");
const PORT = 5191;

const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
};

// Build the fixture through the real serializer + nesting helpers.
const ssr = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { toDocument } = await ssr.ssrLoadModule("/src/io/serialize.ts");
const { deriveBoundary, makeBlockNode } = await ssr.ssrLoadModule("/src/flow/nesting.ts");
const P = (id, direction, connector, name) => ({ id, name, direction, connector });
const roomB = {
  id: "room-b",
  name: "Room B",
  nodes: [
    {
      id: "dev1",
      type: "device",
      position: { x: 0, y: 0 },
      data: {
        model: {
          id: "m-dev1",
          model: "Some Switcher",
          category: "other",
          source: "custom",
          ports: [P("in1", "input", "sdi", "SDI In 1"), P("out1", "output", "sdi", "SDI Out 1")],
        },
      },
    },
  ],
  edges: [],
};
const boundary = deriveBoundary(roomB);
const main = {
  id: "main",
  name: "Main",
  nodes: [makeBlockNode("room-b", "Room B", boundary, { x: 100, y: 100 })],
  edges: [],
};
writeFileSync(
  SCRATCH,
  JSON.stringify(toDocument([main, { ...roomB, boundary }], { projectId: "p", projectName: "block-rename" }), null, 2),
);
await ssr.close();

const stub = `
  (() => {
    let n = 0; const cbs = {}; const listeners = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {}, convertFileSrc(p) { return p; },
      invoke(cmd, a) {
        if (cmd === "plugin:event|listen") { listeners[a.event] = a.handler; return Promise.resolve(n); }
        if (cmd === "take_pending_open") return Promise.resolve({ kind: "file", path: "/@fs${SCRATCH}" });
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stub });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".react-flow__node-block", { timeout: 15000 });
await page.waitForTimeout(500);

const headerText = () =>
  page.evaluate(() => document.querySelector(".react-flow__node-block .device-node__name")?.textContent ?? "");
check(`block initially titled "Room B" (got "${await headerText()}")`, (await headerText()) === "Room B");

// Rename the Room B tab through the tab strip (double-click → inline input → Enter).
await page.locator(".tab__name", { hasText: "Room B" }).dblclick();
await page.waitForSelector(".tab__edit", { timeout: 5000 });
await page.locator(".tab__edit").fill("Stage Left");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);

check("tab renamed", (await page.locator(".tab__name", { hasText: "Stage Left" }).count()) === 1);
// dblclick also switched the active tab to Room B — go back to Main where the block lives.
await page.locator(".tab__name", { hasText: "Main" }).click();
await page.waitForTimeout(400);
check(`embedded block follows the rename (got "${await headerText()}")`, (await headerText()) === "Stage Left");

// Custom instance naming: select the block, rename it in the Inspector, and confirm the
// custom label wins in the header — including over a subsequent tab rename — until cleared.
await page.evaluate(() => {
  const el = document.querySelector(".react-flow__node-block");
  const o = { bubbles: true, view: window, button: 0 };
  for (const t of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, o));
});
await page.waitForSelector(".inspector__name--edit", { timeout: 5000 });
check(
  "inspector rename input shows the tab name as placeholder",
  (await page.locator(".inspector__name--edit").getAttribute("placeholder")) === "Stage Left",
);
await page.locator(".inspector__name--edit").fill("FOH copy");
await page.waitForTimeout(300);
check(`custom label shows in the header (got "${await headerText()}")`, (await headerText()) === "FOH copy");
if (process.env.SHOT_DIR) {
  await page.screenshot({ path: join(process.env.SHOT_DIR, "shot-block-rename.png") });
}

await page.locator(".tab__name", { hasText: "Stage Left" }).dblclick();
await page.waitForSelector(".tab__edit", { timeout: 5000 });
await page.locator(".tab__edit").fill("Stage Right");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await page.locator(".tab__name", { hasText: "Main" }).click();
await page.waitForTimeout(400);
check(`custom label survives a tab rename (got "${await headerText()}")`, (await headerText()) === "FOH copy");

await page.evaluate(() => {
  const el = document.querySelector(".react-flow__node-block");
  const o = { bubbles: true, view: window, button: 0 };
  for (const t of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, o));
});
await page.waitForSelector(".inspector__name--edit", { timeout: 5000 });
await page.locator(".inspector__name--edit").fill("");
await page.waitForTimeout(300);
check(`clearing the label reverts to mirroring the tab (got "${await headerText()}")`, (await headerText()) === "Stage Right");

await browser.close();
await server.close();
rmSync(SCRATCH, { force: true });
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ tab rename + custom instance naming verified");
process.exit(process.exitCode ?? 0);
