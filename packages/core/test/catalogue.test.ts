import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  decodeText,
  parseDelimited,
  readTable,
  findHeader,
  guessMapping,
  packUnits,
  planImport,
  productKey,
  productFromInvoiceLine,
  chunks,
  commandFingerprint,
  sameFingerprint,
  demoState,
} from "../src";
const now = "2026-09-23T09:00:00.000Z";
function xlsx(rows: (string | number | null)[][]) {
  const shared: string[] = [];
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map((v, ci) => {
            if (v === null) return "";
            const ref = `${col(ci)}${ri + 1}`;
            if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
            if (ci === 0 && ri > 1)
              return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
            shared.push(v);
            return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return zipSync({
    "xl/workbook.xml": strToU8(
      `<workbook xmlns:r="r"><sheets><sheet name="Items" sheetId="1" r:id="rId7"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId7" Type="ws" Target="worksheets/items.xml"/></Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`,
    ),
    "xl/worksheets/items.xml": strToU8(
      `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
    ),
  });
}
describe("reading catalogue files", () => {
  it("decodes UTF-8 with BOM, UTF-16 text and Windows-1252", () => {
    expect(
      decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x44, 0xc3, 0xa9])),
    ).toBe("Dé");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x44, 0, 0x6f, 0]))).toBe(
      "Do",
    );
    expect(decodeText(new Uint8Array([0x35, 0xb5, 0x67, 0x80]))).toBe("5µg€");
  });
  it("parses quoted CSV, pasted tab rows and a separator hint", () => {
    expect(
      parseDelimited('Name,Pack\r\n"Dolo, 650",10\'s\n"Say ""hi""\nthere",1\n'),
    ).toEqual([
      ["Name", "Pack"],
      ["Dolo, 650", "10's"],
      ['Say "hi"\nthere', "1"],
    ]);
    expect(parseDelimited("Item\tGST\nDolo\t12\n")).toEqual([
      ["Item", "GST"],
      ["Dolo", "12"],
    ]);
    expect(parseDelimited("sep=;\nA;B\n1;2")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });
  it("keeps blank rows so row numbers match the spreadsheet", () => {
    expect(parseDelimited("A\n\nB\n\n\n")).toEqual([["A"], [""], ["B"]]);
  });
  it("reads the first sheet of an xlsx with shared, inline and numeric cells", () => {
    const table = readTable(
      xlsx([
        ["Stock report", null, null],
        ["Item Name", "GST %", "Barcode"],
        ["DOLO 650 TAB", 12.000000000000002, 8901234567890],
        ["ENO & Co", null, 12],
      ]),
    );
    expect(table).toEqual([
      ["Stock report"],
      ["Item Name", "GST %", "Barcode"],
      ["DOLO 650 TAB", "12", "8901234567890"],
      ["ENO & Co", "", "12"],
    ]);
  });
  it("refuses old binary .xls files with a clear message", () => {
    expect(() => readTable(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(
      "xlsx or CSV",
    );
  });
});
describe("columns and units", () => {
  const table = [
    ["ABC Medicos", "", ""],
    ["Item List as on 23-09-2026"],
    ["Sr", "Item Name", "Pack", "Company", "GST%", "HSN Code", "Salt", "Sch"],
  ];
  it("finds the header below report titles and maps common export names", () => {
    expect(findHeader(table)).toBe(2);
    expect(guessMapping(table[2])).toEqual({
      name: 1,
      pack: 2,
      company: 3,
      gst: 4,
      hsn: 5,
      generic: 6,
      schedule: 7,
    });
  });
  it("works out strips, boxes, bottles and unknown units", () => {
    expect(packUnits("", "10's", "DOLO 650 TAB")).toMatchObject({
      baseUnit: "tablet",
      units: { tablet: "1", strip: "10" },
    });
    expect(packUnits("CAPSULE", "10x10", "X")).toMatchObject({
      baseUnit: "capsule",
      units: { capsule: "1", strip: "10", box: "100" },
    });
    expect(packUnits("", "100ML", "BENADRYL SYRUP")).toMatchObject({
      baseUnit: "bottle",
      units: { bottle: "1" },
      size: "100 ml",
    });
    expect(packUnits("", "", "PAN 40").note).toMatch(/Unit could not/);
    expect(packUnits("tablet", "", "PAN 40").note).toMatch(
      /Strip size unknown/,
    );
    expect(packUnits("", "21g", "ORAL REHYDRATION SALTS SACHET").baseUnit).toBe(
      "sachet",
    );
  });
  it("treats the same brand and strength typed differently as one product", () => {
    expect(productKey("DOLO 650 TAB", "650mg")).toBe(
      productKey("Dolo", "650 mg"),
    );
    expect(productKey("Dolo 500", "")).not.toBe(productKey("Dolo 650", ""));
  });
});
describe("planning an import", () => {
  const header = ["Item Name", "Pack", "GST", "Barcode", "Schedule", "Company"];
  const plan = (rows: string[][], defaultGst?: string) =>
    planImport(
      [header, ...rows],
      0,
      guessMapping(header),
      demoState(undefined, undefined, undefined, now),
      {
        defaultGst,
        idFor: (line) => `imp-${line}`,
      },
    );
  it("separates new, existing, repeated and invalid rows", () => {
    const p = plan([
      ["CROCIN ADVANCE 500 TAB", "15's", "12", "8901234567890", "", "GSK"],
      ["Dolo 650 mg", "15 tab", "12", "", "", ""],
      ["CROCIN ADVANCE 500 TAB", "15's", "12", "", "", ""],
      ["", "10's", "12", "", "", ""],
      ["AZEE 500 TAB", "3's", "abc", "", "H", ""],
      ["", "", "", "", "", ""],
    ]);
    expect(p.rows.map((r) => [r.line, r.status])).toEqual([
      [2, "new"],
      [3, "existing"],
      [4, "repeat"],
      [5, "error"],
      [6, "error"],
    ]);
    expect(p.rows[1].existingId).toBe("dolo");
    expect(p.rows[2].repeatOf).toBe(2);
    expect(p.create).toHaveLength(1);
    expect(p.create[0]).toMatchObject({
      id: "imp-2",
      baseUnit: "tablet",
      units: { tablet: "1", strip: "15" },
      taxBps: 1200,
      barcode: "8901234567890",
      aliases: ["gsk"],
      schedule: "OTC",
    });
    expect(p.counts).toMatchObject({
      new: 1,
      existing: 1,
      repeat: 1,
      error: 2,
    });
  });
  it("uses a default GST only when a row has none, and flags it", () => {
    const p = plan([["NEW SYRUP 100ML", "100ML", "", "", "", ""]], "5");
    expect(p.create[0].taxBps).toBe(500);
    expect(p.rows[0].warnings).toContain("GST from the default rate: check it");
    expect(plan([["NEW SYRUP", "", "", "", "", ""]]).rows[0].errors).toContain(
      "GST rate is missing",
    );
  });
  it("drops barcodes Excel turned into scientific notation instead of guessing", () => {
    const p = plan([["X TAB", "10's", "12", "8.90123E+12", "H1", ""]]);
    expect(p.create[0].barcode).toBe("");
    expect(p.create[0].schedule).toBe("H1");
    expect(p.rows[0].warnings[0]).toMatch(/scientific notation/);
  });
  it("matches catalogue products by barcode as well as name", () => {
    const s = demoState(undefined, undefined, undefined, now);
    s.products.cetirizine.barcode = "8905555555557";
    const p = planImport(
      [header, ["CETZINE 10", "10's", "12", "8905555555557", "", ""]],
      0,
      guessMapping(header),
      s,
      { idFor: () => "x" },
    );
    expect(p.rows[0]).toMatchObject({
      status: "existing",
      existingId: "cetirizine",
    });
  });
  it("splits large imports into bounded chunks", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("starts a new product from an unmatched invoice line", () => {
    expect(
      productFromInvoiceLine(
        {
          name: "MONTAIR LC TAB",
          strength: null,
          packSize: "1x10",
          unit: "strip",
          taxBps: 1200,
        },
        "p1",
      ),
    ).toMatchObject({
      id: "p1",
      baseUnit: "tablet",
      units: { tablet: "1", strip: "10" },
      taxBps: 1200,
    });
  });
});
describe("command fingerprints", () => {
  it("hashes large commands but still recognises receipts stored in full", () => {
    const small = JSON.stringify({ id: "a" });
    const large = JSON.stringify({ id: "b", data: "x".repeat(5000) });
    expect(commandFingerprint(small)).toBe(small);
    expect(commandFingerprint(large)).toMatch(/^h:\d+:/);
    expect(commandFingerprint(large).length).toBeLessThan(60);
    expect(sameFingerprint(commandFingerprint(large), large)).toBe(true);
    expect(sameFingerprint(large, large)).toBe(true);
    expect(
      sameFingerprint(commandFingerprint(large), large.replace("x", "y")),
    ).toBe(false);
  });
});
