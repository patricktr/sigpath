// Verify duplicate/copy/paste carry the cables wired BETWEEN the selected devices:
// select two connected devices in dense-real, Duplicate (contextbar) and then ⌘C/⌘V
// (DOM clipboard events) — each must add the devices AND their interconnecting cables,
// re-pointed at the clones and renumbered to the next free id.
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "routing", "dense-real.sigpath");
const PORT = 5189;

const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
};

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
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stub });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".react-flow__node-device", { timeout: 15000 });
await page.waitForTimeout(900);

// Pick a numbered cable and its two endpoint devices; count all cables between the pair.
const pick = await page.evaluate(() => {
  const dbg = window.__routeDebug;
  const e = dbg.edges.find((x) => x.data?.number);
  const pair = new Set([e.source, e.target]);
  const between = dbg.edges.filter((x) => pair.has(x.source) && pair.has(x.target));
  return {
    a: e.source,
    b: e.target,
    between: between.length,
    numbers: between.map((x) => x.data?.number),
    devices: dbg.nodes.filter((n) => n.type === "device").length,
    edges: dbg.edges.length,
    numbered: dbg.edges.filter((x) => x.data?.number).length,
  };
});
check(`picked a connected pair (${pick.between} cable(s) between: ${pick.numbers.join(", ")})`, pick.between >= 1);

const clickNode = (id, meta) =>
  page.evaluate(
    ([nodeId, withMeta]) => {
      const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const o = { bubbles: true, view: window, button: 0, metaKey: !!withMeta, ctrlKey: !!withMeta };
      for (const t of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, o));
      return "ok";
    },
    [id, meta],
  );
const counts = () =>
  page.evaluate(() => ({
    devices: window.__routeDebug.nodes.filter((n) => n.type === "device").length,
    edges: window.__routeDebug.edges.length,
    numbers: window.__routeDebug.edges.map((e) => e.data?.number).filter(Boolean),
  }));

const selectPair = async () => {
  await clickNode(pick.a, false);
  await page.waitForTimeout(150);
  await page.keyboard.down("Meta");
  await clickNode(pick.b, true);
  await page.keyboard.up("Meta");
  await page.waitForTimeout(250);
};

// --- Duplicate (contextbar) ---
await selectPair();
await page.locator(".contextbar").getByRole("button", { name: "Duplicate" }).click();
await page.waitForTimeout(500);
let c = await counts();
check(`Duplicate added the 2 devices (${pick.devices} → ${c.devices})`, c.devices === pick.devices + 2);
check(`Duplicate carried the ${pick.between} contained cable(s)`, c.edges === pick.edges + pick.between);
check(
  `duplicated cable got a fresh unique number (${pick.numbered} → ${c.numbers.length} numbered, all unique)`,
  new Set(c.numbers).size === c.numbers.length && c.numbers.length === pick.numbered + pick.between,
);

// --- Copy / paste (DOM clipboard events with a shared DataTransfer) ---
await selectPair();
const pasted = await page.evaluate(() => {
  const dt = new DataTransfer();
  document.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
  const payload = dt.getData("text/plain");
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  let parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    /* empty */
  }
  return { edgesInPayload: parsed?.edges?.length ?? 0 };
});
await page.waitForTimeout(500);
check(`copy payload includes the contained cable(s) (${pasted.edgesInPayload})`, pasted.edgesInPayload === pick.between);
const c2 = await counts();
check(`paste added 2 more devices (${c.devices} → ${c2.devices})`, c2.devices === c.devices + 2);
check(`paste carried the cable(s) (${c.edges} → ${c2.edges})`, c2.edges === c.edges + pick.between);
check("pasted cables renumbered uniquely", new Set(c2.numbers).size === c2.numbers.length);

await browser.close();
await server.close();
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ duplicate/copy/paste carry contained cables");
process.exit(process.exitCode ?? 0);
