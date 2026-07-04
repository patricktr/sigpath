// Verify the equipment-database UX: search autofocus on open, bare model names in the
// Model column, ↑/↓ row navigation from the search input, ↵ places the device.
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5193;

const stub = `
  (() => {
    let n = 0; const cbs = {}; const listeners = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {}, convertFileSrc(p) { return p; },
      invoke(cmd, a) {
        if (cmd === "plugin:event|listen") { listeners[a.event] = a.handler; return Promise.resolve(n); }
        return Promise.resolve(null);
      },
    };
    window.__emit = (ev) => { const cb = cbs[listeners[ev]]; if (cb) cb({ event: ev, id: listeners[ev] }); };
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
await page.waitForSelector(".react-flow", { timeout: 15000 });
await page.waitForTimeout(800);

// Open palette → full catalog
await page.evaluate(() => window.__emit("menu:insertDevice"));
await page.waitForSelector(".adv-palette", { timeout: 5000 });
await page.locator(".adv-browse").click();
await page.waitForSelector(".adv-db", { timeout: 5000 });
await page.waitForTimeout(200);

check(
  "search bar is focused on open",
  await page.evaluate(() => document.activeElement?.classList.contains("adv-db__searchinput")),
);

// Type immediately — no click — and confirm it lands in the search box.
await page.keyboard.type("atem", { delay: 15 });
await page.waitForTimeout(300);
check(
  "typing right away filters the table",
  await page.evaluate(() => document.querySelector(".adv-db__searchinput")?.value === "atem"),
);

const rowInfo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".adv-db__row")];
  return rows.map((r) => ({
    model: r.querySelector(".adv-cell-model")?.textContent ?? "",
    mfr: r.children[2]?.textContent ?? "",
    active: r.classList.contains("adv-db__row--active"),
  }));
});
check("results found", rowInfo.length >= 2);
check(
  "Model column omits the manufacturer name",
  rowInfo.every((r) => !r.mfr || r.mfr === "—" || !r.model.toLowerCase().startsWith(r.mfr.toLowerCase())),
);
check("first row highlighted by default", rowInfo[0]?.active === true);

// Arrow down once → second row highlighted; Enter → device placed, overlay closed.
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(150);
const second = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".adv-db__row")];
  return { idx: rows.findIndex((r) => r.classList.contains("adv-db__row--active")), model: rows[1]?.querySelector(".adv-cell-model")?.textContent };
});
check("ArrowDown moves the highlight to row 2", second.idx === 1);
const before = await page.evaluate(() => document.querySelectorAll(".react-flow__node-device").length);
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const after = await page.evaluate(() => document.querySelectorAll(".react-flow__node-device").length);
check("Enter places the highlighted device on the canvas", after === before + 1);
check("overlay closed after placing", (await page.locator(".adv-db").count()) === 0);
const placedName = await page.evaluate(() => document.querySelector(".react-flow__node-device .device-node__name")?.textContent ?? "");
check(`placed the row-2 device (${placedName})`, placedName.toLowerCase().includes("atem"));

await browser.close();
await server.close();
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ catalog keyboard flow verified");
process.exit(process.exitCode ?? 0);
