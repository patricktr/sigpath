// Save integrity gates (the test4.sigpath incident):
//  A. Save As from a loaded project writes the FULL content (devices + carried revisions,
//     no warning dialog) — the healthy path stays silent and lossless.
//  B. Opening a corrupt "empty project with rich history" file and hitting Save trips the
//     data-loss confirm; answering Cancel writes NOTHING.
// The Tauri stub records every dialog + write_file so assertions read them directly.
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORRUPT = join(ROOT, "scratch-corrupt.sigpath");
const PORT = 5190;

const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
};

// Build a test4-style corrupt fixture: empty live project carrying a revision whose
// snapshot contains devices — through the real serializer.
const ssr = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { toDocument } = await ssr.ssrLoadModule("/src/io/serialize.ts");
const P = (id, direction, connector, name) => ({ id, name, direction, connector });
const dev = (id, x) => ({
  id,
  type: "device",
  position: { x, y: 0 },
  data: {
    model: { id: `m-${id}`, model: id, category: "other", source: "custom", ports: [P("o1", "output", "sdi", "Out")] },
  },
});
const richDoc = toDocument([{ id: "ghost-d", name: "Diagram 1", nodes: [dev("A", 0), dev("B", 300)], edges: [] }], {
  projectId: "ghost-project",
  projectName: "ghost",
});
const corrupt = toDocument([{ id: "empty-d", name: "Diagram 1", nodes: [], edges: [] }], {
  projectId: "ghost-project",
  projectName: "Untitled",
  revisions: [
    { id: "rev-1", at: 1783179329623, hash: "abc", snapshot: { name: "ghost", diagrams: richDoc.project.diagrams } },
  ],
});
writeFileSync(CORRUPT, JSON.stringify(corrupt, null, 2));
await ssr.close();

const stubFor = (fixture, cancelSuspicious) => `
  (() => {
    let n = 0; const cbs = {}; const listeners = {};
    window.__writes = []; window.__dialogs = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { const id = ++n; cbs[id] = cb; return id; },
      unregisterListener() {}, convertFileSrc(p) { return p; },
      invoke(cmd, a) {
        if (cmd === "plugin:event|listen") { listeners[a.event] = a.handler; return Promise.resolve(n); }
        if (cmd === "take_pending_open") return Promise.resolve(${fixture ? `{ kind: "file", path: "/@fs${fixture}" }` : "null"});
        if (cmd === "read_file") return fetch(a.path).then((r) => r.text());
        if (cmd === "write_file") { window.__writes.push({ path: a.path, contents: a.contents }); return Promise.resolve(null); }
        if (cmd === "plugin:dialog|save") return Promise.resolve("/tmp/saved-copy.sigpath");
        if (cmd === "plugin:dialog|message") {
          const b = a.buttons;
          const ok = b && b.OkCancelCustom ? b.OkCancelCustom[0] : "Ok";
          const cancel = b && b.OkCancelCustom ? b.OkCancelCustom[1] : "Cancel";
          window.__dialogs.push(a.message ?? "");
          return Promise.resolve(${cancelSuspicious ? "cancel" : "ok"});
        }
        return Promise.resolve(null);
      },
    };
    window.__emit = (ev) => { const cb = cbs[listeners[ev]]; if (cb) cb({ event: ev, id: listeners[ev] }); };
    try { localStorage.removeItem("sigpath.router"); } catch {}
  })();
`;

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();

// --- A. Healthy Save As from dense-real -----------------------------------------------------
let page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stubFor(join(ROOT, "fixtures", "routing", "dense-real.sigpath"), false) });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".react-flow__node-device", { timeout: 15000 });
await page.waitForTimeout(800);
await page.evaluate(() => window.__emit("menu:saveAs"));
await page.waitForTimeout(800);
const a = await page.evaluate(() => ({
  writes: window.__writes.length,
  dialogs: window.__dialogs,
  doc: window.__writes[0] ? JSON.parse(window.__writes[0].contents) : null,
}));
check("Save As wrote exactly one file", a.writes === 1);
const devices = a.doc ? a.doc.project.diagrams.reduce((s, d) => s + d.devices.length, 0) : 0;
const srcDevices = JSON.parse(
  (await import("node:fs")).readFileSync(join(ROOT, "fixtures", "routing", "dense-real.sigpath"), "utf8"),
).project.diagrams.reduce((s, d) => s + d.devices.length, 0);
check(`Save As copied the full content (${devices}/${srcDevices} devices)`, devices === srcDevices && devices > 0);
check("Save As carried the revision history + new save point", (a.doc?.project.revisions?.length ?? 0) >= 1);
check("no warning dialog on a healthy save", a.dialogs.length === 0);
await page.close();

// --- B. Corrupt empty-with-history file: Save trips the guard; Cancel writes nothing --------
page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort()));
await page.addInitScript({ content: stubFor(CORRUPT, true) });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector(".react-flow", { timeout: 15000 });
await page.waitForTimeout(900);
await page.evaluate(() => window.__emit("menu:save"));
await page.waitForTimeout(600);
const b = await page.evaluate(() => ({ writes: window.__writes.length, dialogs: window.__dialogs }));
check("saving the corrupt file trips the data-loss confirm", b.dialogs.some((m) => m.includes("saved history contains")));
check("cancelling the confirm writes NOTHING", b.writes === 0);

await browser.close();
await server.close();
rmSync(CORRUPT, { force: true });
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ save-integrity gates pass");
process.exit(process.exitCode ?? 0);
