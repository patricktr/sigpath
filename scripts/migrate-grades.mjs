// One-time migration: lift explicit bandwidth grades out of free-text port notes
// into the structured `port.grade` field, and rehash every entry (deviceContentHash
// now folds in grade — see src/schema/device.ts). Phase C of signal-grade
// (design/SIGNAL-GRADE.html §7).
//
// Principle: EXPLICIT grades only. We never guess a grade from the connector alone —
// a low default on an un-noted port would manufacture false "under-rated" errors in
// a high-grade show, the very thing the feature exists to avoid. Un-noted ports stay
// unrated (undefined) ⇒ never grade-checked. Coverage grows later via the wizard and
// community corrections.
//
// Usage:  node scripts/migrate-grades.mjs [--write]
//   without --write: dry run, prints the per-scale note→grade report only.
//
// NOTE: the canonical catalog lives in the separate sigpath-catalog repo; the same
// transform should be applied there on its next publish. This migrates the bundled
// snapshot so the app has real grade data today.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "src/library/communityCatalog.json");

// Connector → grade scale. Mirrors CONNECTOR_GRADE_SCALE in src/schema/connectors.ts.
const SCALE = {
  sdi: "sdi", bnc: "sdi",
  hdmi: "hdmi", "mini-hdmi": "hdmi", "micro-hdmi": "hdmi",
  dp: "displayport", "mini-dp": "displayport",
  "usb-c": "usb", "usb-a": "usb", "usb-b": "usb", "usb-micro": "usb", thunderbolt: "usb",
  rj45: "ethernet", ethercon: "ethernet",
};

// Grade id → rank. Mirrors GRADE_SCALES in src/schema/grades.ts (rank = ladder index).
const RANK = {
  "sdi-sd": 0, "sdi-hd": 1, "sdi-3g": 2, "sdi-6g": 3, "sdi-12g": 4, "sdi-24g": 5,
  "hdmi-1.4": 0, "hdmi-2.0": 1, "hdmi-2.1": 2,
  "dp-1.2": 0, "dp-1.4": 1, "dp-2.0": 2,
  "usb-2.0": 0, "usb-5g": 1, "usb-10g": 2, "usb-20g": 3, "usb-40g": 4, "usb-80g": 5,
  "eth-100m": 0, "eth-1g": 1, "eth-2.5g": 2, "eth-5g": 3, "eth-10g": 4, "eth-25g": 5,
};

// Per-scale token tests. We take the HIGHEST-ranked grade any token matches, so
// "supports 270Mb, 1.5G, 3G, 6G" → 6G and "3G-SDI / HD-SDI" → 3G.
const TOKENS = {
  sdi: [
    [/\b24G\b/i, "sdi-24g"],
    [/\b12G\b|2082/i, "sdi-12g"],
    [/\b6G\b|2081/i, "sdi-6g"],
    [/\b3G\b|424M|425M/i, "sdi-3g"],
    [/HD-?SDI|\b1\.5G\b|\b292M?\b/i, "sdi-hd"],
    [/SD-?SDI|259M|270\s?Mb/i, "sdi-sd"],
  ],
  hdmi: [
    [/\b2\.1\b/i, "hdmi-2.1"],
    [/\b2\.0\b/i, "hdmi-2.0"],
    [/\b1\.[34]\b|1\.4b/i, "hdmi-1.4"],
  ],
  displayport: [
    [/\b2\.0\b|UHBR/i, "dp-2.0"],
    [/\b1\.4\b|HBR3/i, "dp-1.4"],
    [/\b1\.2\b|1\.2a|HBR2/i, "dp-1.2"],
  ],
  usb: [
    [/USB\s?4|Thunderbolt|\bTB[34]\b|\b40\s?Gb/i, "usb-40g"],
    [/Gen\s?2x2|\b20\s?Gb/i, "usb-20g"],
    [/3\.[12]\s?Gen\s?2\b|\b10\s?Gb/i, "usb-10g"],
    // bare "3.0/3.1/3.2" too — catches "USB Type-B 3.0" where the version is split
    // off "USB"; in these notes a 3.x token reliably means USB 3 (5 Gbps).
    [/USB\s?3(\.[012])?\b|\b3\.[012]\b|Gen\s?1\b|SuperSpeed|\b5\s?Gb/i, "usb-5g"],
    [/USB\s?2(\.0)?\b|Hi-?Speed|\b480\s?Mb/i, "usb-2.0"],
  ],
  ethernet: [
    [/\b25G\b|25\s?Gb/i, "eth-25g"],
    [/\b10G\b|10\s?Gb|10GBASE/i, "eth-10g"],
    [/\b5G\b|\b5\s?Gb/i, "eth-5g"],
    [/2\.5G|2\.5\s?Gb/i, "eth-2.5g"],
    [/1000\s?(BASE|Base|Mbps|Mb)|\b1\s?Gb|Gigabit|802\.3ab/i, "eth-1g"],
    [/\b100\s?(BASE|Base|Mbps|Mb)|802\.3u/i, "eth-100m"],
  ],
};

/** Highest-ranked explicit grade in a note for its scale, or null. */
function parseGrade(scale, rawNote) {
  if (!rawNote) return null;
  // Strip "HDCP 2.2/1.4"-style noise so an HDCP revision isn't read as an HDMI/DP version.
  const note = rawNote.replace(/HDCP\s*[\d.]+(\s*\/\s*[\d.]+)?/gi, " ");
  let best = null;
  let bestRank = -1;
  for (const [re, gid] of TOKENS[scale]) {
    if (re.test(note) && RANK[gid] > bestRank) {
      best = gid;
      bestRank = RANK[gid];
    }
  }
  return best;
}

// deviceContentHash — MUST mirror src/schema/device.ts exactly (incl. the grade field),
// so recomputed hashes match what the app computes at runtime.
function deviceContentHash(model) {
  const canonical = JSON.stringify({
    manufacturer: model.manufacturer ?? "",
    model: model.model,
    category: model.category,
    type: model.type ?? "",
    rackUnits: model.rackUnits ?? null,
    ports: (model.ports ?? []).map((p) => [
      p.direction,
      p.connector,
      p.grade ?? "",
      p.name,
      p.note ?? "",
    ]),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const write = process.argv.includes("--write");
const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));

const seen = {}; // scale → Map(note → {grade, n})
let graded = 0;
let rehashed = 0;
for (const model of catalog) {
  for (const p of model.ports ?? []) {
    const scale = SCALE[p.connector];
    if (!scale) continue;
    const grade = parseGrade(scale, p.note);
    if (grade) {
      p.grade = grade;
      graded++;
      (seen[scale] ??= new Map());
      const k = (p.note || "").trim();
      const cur = seen[scale].get(k);
      if (cur) cur.n++;
      else seen[scale].set(k, { grade, n: 1 });
    }
  }
  const fresh = deviceContentHash(model);
  if (model.contentHash !== fresh) {
    model.contentHash = fresh;
    rehashed++;
  }
}

// Report: per scale, what each note resolved to (so the parse can be eyeballed).
for (const scale of Object.keys(seen)) {
  const rows = [...seen[scale].entries()].sort((a, b) => b[1].n - a[1].n);
  const total = rows.reduce((s, [, v]) => s + v.n, 0);
  console.log(`\n=== ${scale} === (${total} ports graded)`);
  for (const [note, { grade, n }] of rows) {
    console.log(`  ${String(n).padStart(3)}  ${grade.padEnd(9)} ← ${note}`);
  }
}
console.log(`\nTotal ports graded: ${graded}.  Entries rehashed: ${rehashed}/${catalog.length}.`);

if (write) {
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`\nWrote ${CATALOG}`);
} else {
  console.log(`\n(dry run — re-run with --write to apply)`);
}
