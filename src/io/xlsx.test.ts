import { describe, it, expect } from "vitest";
import { buildXlsx, xlsxBase64, type XlsxSheet } from "./xlsx";

/** Minimal STORED-zip reader — proves the writer's output is a readable archive. */
function unzipStored(bytes: Uint8Array): Record<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    const size = dv.getUint32(cd + 24, true);
    const nameLen = dv.getUint16(cd + 28, true);
    const extraLen = dv.getUint16(cd + 30, true);
    const commentLen = dv.getUint16(cd + 32, true);
    const localOff = dv.getUint32(cd + 42, true);
    const name = dec.decode(bytes.subarray(cd + 46, cd + 46 + nameLen));
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    out[name] = dec.decode(bytes.subarray(dataStart, dataStart + size));
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const sheets: XlsxSheet[] = [
  { name: "Equipment", rows: [["Qty", "Model"], [2, "Apple TV 4K"], [1, 'LG "C3" & <co>']] },
  { name: "Bad:Name*/[here]", rows: [["A"], ["b"]] },
];

describe("xlsx writer (dependency-free)", () => {
  it("packs a valid STORED zip with all OOXML parts", () => {
    const files = unzipStored(buildXlsx(sheets));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ]),
    );
  });

  it("writes numeric cells as numbers and escapes string content", () => {
    const s1 = unzipStored(buildXlsx(sheets))["xl/worksheets/sheet1.xml"];
    expect(s1).toContain('<c r="A2" t="n"><v>2</v></c>');
    expect(s1).toContain("Apple TV 4K");
    expect(s1).toContain("&quot;C3&quot; &amp; &lt;co&gt;");
  });

  it("sanitizes illegal characters out of sheet names", () => {
    const wb = unzipStored(buildXlsx(sheets))["xl/workbook.xml"];
    expect(wb).not.toMatch(/name="[^"]*[[\]:*?/\\][^"]*"/); // no []:*?/\ in any sheet name
  });

  it("base64 output starts with the zip signature", () => {
    expect(xlsxBase64(sheets).startsWith("UEsD")).toBe(true);
  });
});
