// Drive the real app headlessly and verify the bundle-aware cable context bar:
//  1. multi-select two cables -> bulk fields + "Bundle" button appear
//  2. bulk-set cable grade -> both edges update
//  3. Bundle -> bar flips to Bundle context (Unbundle/Expand present)
//  4. re-click a member of the collapsed bundle -> still Bundle context
//  5. Unbundle -> bar back to plain cable selection
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "routing", "matrix.sigpath");
const PORT = 5197;
const SHOT = process.env.SHOT_DIR ?? ROOT;

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

const clickEdge = (page, id, meta) =>
  page.evaluate(
    ([edgeId, withMeta]) => {
      const g = document.querySelector(`.react-flow__edge[data-id="${edgeId}"]`);
      const path = g?.querySelector(".react-flow__edge-interaction") ?? g?.querySelector(".react-flow__edge-path");
      if (!path) return `no edge ${edgeId}`;
      const opts = { bubbles: true, view: window, button: 0, metaKey: !!withMeta, ctrlKey: !!withMeta };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        path.dispatchEvent(new MouseEvent(type, opts));
      }
      return "ok";
    },
    [id, meta],
  );

const barText = (page) => page.evaluate(() => document.querySelector(".contextbar")?.textContent ?? "(no bar)");
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
await page.waitForTimeout(800);

// 1. multi-select m1 + m2 (React Flow reads the multi-select key from real keyboard state)
console.log(await clickEdge(page, "m1", false));
await page.waitForTimeout(150);
await page.keyboard.down("Meta");
console.log(await clickEdge(page, "m2", true));
await page.keyboard.up("Meta");
await page.waitForTimeout(250);
let t = await barText(page);
check("multi-select shows '2 cables selected'", t.includes("2 cables selected"));
check("bulk Length field present", t.includes("Length"));
check("bulk Cable grade select present", t.includes("Cable grade"));
check("Bundle button present in the bar", await page.locator(".contextbar").getByRole("button", { name: "⧉ Bundle" }).count() === 1);

// 2. bulk-set cable grade via the bulk select (labelled '— any —' default)
const gradeSet = await page.evaluate(() => {
  const bar = document.querySelector(".contextbar");
  const selects = [...bar.querySelectorAll("select")];
  const grade = selects[0]; // Cable grade first
  const opt = [...grade.options].find((o) => o.value && !o.disabled);
  if (!opt) return "no grade option";
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(grade, opt.value);
  grade.dispatchEvent(new Event("change", { bubbles: true }));
  return opt.value;
});
await page.waitForTimeout(250);
const grades = await page.evaluate(() => window.__routeDebug?.edges.map((e) => [e.id, e.data?.cableGrade]));
const gm = new Map(grades ?? []);
check(`bulk grade '${gradeSet}' applied to BOTH m1+m2`, gm.get("m1") === gradeSet && gm.get("m2") === gradeSet);
check("bulk grade did NOT touch m3", gm.get("m3") == null);

// 3. Bundle (the context-bar button, NOT the ≥4 offer chip)
await page.locator(".contextbar").getByRole("button", { name: "⧉ Bundle" }).click();
await page.waitForTimeout(400);
t = await barText(page);
check("bar flips to Bundle context", t.includes("Bundle ·"));
check("Unbundle available", t.includes("Unbundle"));
check("Expand toggle available (created collapsed)", t.includes("Expand"));
check(
  "the bundle draws ONE zebra spine (thick backbone + stripe)",
  (await page.locator(".cable-bundle-spine").count()) === 1 && (await page.locator(".cable-bundle-stripe").count()) === 1,
);
// Member ID badges must sit fully clear of the device boxes (they used to render
// half-under the node when the fan point sat exactly at the device edge).
check(
  "member ID badges clear the device boxes",
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".react-flow__node-device")].map((el) => el.getBoundingClientRect());
    return [...document.querySelectorAll(".cable-id-label")].every((el) => {
      const b = el.getBoundingClientRect();
      return !boxes.some(
        (r) => b.left < r.right - 1 && r.left < b.right - 1 && b.top < r.bottom - 1 && r.top < b.bottom - 1,
      );
    });
  }),
);
await page.screenshot({ path: join(SHOT, "shot-bundle-bar.png") });

// 4. click empty pane to clear, then re-click a member of the collapsed bundle
await page.mouse.click(400, 900);
await page.waitForTimeout(250);
console.log(await clickEdge(page, "m1", false));
await page.waitForTimeout(250);
t = await barText(page);
check("re-selecting a collapsed member reads as the bundle", t.includes("Bundle ·") && t.includes("Unbundle"));

// 5. Unbundle
await page.getByRole("button", { name: /Unbundle/ }).click();
await page.waitForTimeout(400);
t = await barText(page);
check("after Unbundle the bar is plain cable context", !t.includes("Bundle ·") && t.includes("cable"));

// 6. TWO co-located bundles must not overlap: their fan verticals stagger apart and each
// spine routes with the crossing context (bundle A = m1+m2, bundle B = m3+m4).
const makeBundle = async (a, b) => {
  await page.mouse.click(400, 900);
  await page.waitForTimeout(200);
  await clickEdge(page, a, false);
  await page.waitForTimeout(150);
  await page.keyboard.down("Meta");
  await clickEdge(page, b, true);
  await page.keyboard.up("Meta");
  await page.waitForTimeout(250);
  await page.locator(".contextbar").getByRole("button", { name: "⧉ Bundle" }).click();
  await page.waitForTimeout(400);
};
await makeBundle("m1", "m2");
await makeBundle("m3", "m4");
const fanX = await page.evaluate(() => {
  // First vertical segment x of each member's drawn path = its bundle's fan-in line.
  const firstVerticalX = (id) => {
    const d = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`)?.getAttribute("d") ?? "";
    const pts = [];
    for (const m of d.matchAll(/([MLQA])([^MLQA]*)/g)) {
      const nums = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
      if ((m[1] === "M" || m[1] === "L") && nums.length >= 2) pts.push({ x: nums[0], y: nums[1] });
      else if (m[1] === "Q" && nums.length >= 4) pts.push({ x: nums[0], y: nums[1] }, { x: nums[2], y: nums[3] });
      else if (m[1] === "A" && nums.length >= 7) pts.push({ x: nums[5], y: nums[6] });
    }
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].x - pts[i - 1].x) < 0.75 && Math.abs(pts[i].y - pts[i - 1].y) > 4) return pts[i].x;
    }
    return null;
  };
  return { a: firstVerticalX("m1"), b: firstVerticalX("m3") };
});
check(
  `co-located bundles stagger their fan lines (A@${Math.round(fanX.a ?? -1)} vs B@${Math.round(fanX.b ?? -1)})`,
  fanX.a != null && fanX.b != null && Math.abs(fanX.a - fanX.b) >= 8,
);
check("each of the two bundles draws exactly one striped spine", (await page.locator(".cable-bundle-stripe").count()) === 2);
await page.screenshot({ path: join(SHOT, "shot-two-bundles.png") });

await browser.close();
await server.close();
console.log(process.exitCode ? "\n✗ FAILURES" : "\n✓ bundle context bar verified end-to-end");
process.exit(process.exitCode ?? 0);
