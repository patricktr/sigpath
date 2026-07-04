// Screenshot fixtures through the same stubbed-Tauri flow as browser-route-check —
// a quick visual spot-check of routing changes without launching the Tauri app.
// Usage: node scripts/shot-fixture.mjs <fixture-basename...>   (SHOT_DIR overrides output dir)
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX_DIR = join(ROOT, "fixtures", "routing");
const OUT = process.env.SHOT_DIR ?? ROOT;
const PORT = 5198;
const names = process.argv.slice(2);

const stubFor = (fixtureUrl) => `
  (() => {
    let n = 0; const cbs = {}; const listeners = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {}, convertFileSrc(p) { return p; },
      invoke(cmd, a) {
        if (cmd === "plugin:event|listen") { listeners[a.event] = a.handler; return Promise.resolve(n); }
        if (cmd === "take_pending_open") return Promise.resolve({ kind: "file", path: ${JSON.stringify(fixtureUrl)} });
        if (cmd === "read_file") return fetch(a.path).then((r) => r.text());
        if (cmd === "plugin:dialog|message") { const b = a.buttons; return Promise.resolve(b && b.OkCancelCustom ? b.OkCancelCustom[0] : "Ok"); }
        return Promise.resolve(null);
      },
    };
    try { localStorage.removeItem("sigpath.router"); localStorage.setItem("sigpath.hops", "1"); } catch {}
  })();
`;

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
for (const name of names) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
  await page.addInitScript({ content: stubFor(`/@fs${FIX_DIR}/${name}.sigpath`) });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector(".react-flow__edge-path", { timeout: 15000 });
  await page.waitForTimeout(1200);
  const fit = page.locator(".react-flow__controls-fitview");
  if (await fit.count()) await fit.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `shot-${name}.png`) });
  console.log(`shot-${name}.png`);
  await page.close();
}
await browser.close();
await server.close();
process.exit(0);
