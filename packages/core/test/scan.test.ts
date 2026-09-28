import { describe, it, expect } from "vitest";
import { demoState, matchScan, parseScan, barcodesOf } from "../src";
const now = "2026-09-23T09:00:00.000Z",
  today = "2026-09-23";
const GS = "\u001d";
function shop() {
  const s = demoState(undefined, undefined, undefined, now);
  s.products.dolo.barcode = "8901234567890, 8909999999994";
  s.products.cetirizine.barcode = "8905555555557";
  return s;
}
describe("barcode scanning", () => {
  it("reads several pack barcodes from one product field", () => {
    expect(
      barcodesOf({ barcode: "8901234567890,  08909999999994 x1" }),
    ).toEqual(["8901234567890", "8909999999994", "X1"]);
  });
  it("matches a plain EAN-13 against any of a product's barcodes", () => {
    const m = matchScan(shop(), "8909999999994", today);
    expect(m.products.map((p) => p.id)).toEqual(["dolo"]);
    expect(m.batch).toBeUndefined();
  });
  it("reads GTIN, batch and expiry from a pack DataMatrix and finds the batch", () => {
    const raw = `]d20108901234567890172704301${"0"}DOL2401${GS}21SN123`;
    expect(parseScan(raw)).toMatchObject({
      gtin: "08901234567890",
      expiry: "2027-04-30",
      batch: "DOL2401",
    });
    const m = matchScan(shop(), raw, today);
    expect(m.products.map((p) => p.id)).toEqual(["dolo"]);
    expect(m.batch?.id).toBe("dolo-b1");
    expect(m.batchIssue).toBeUndefined();
  });
  it("reads the printed (AI) form, with day 00 meaning month end", () => {
    expect(parseScan("(01)08901234567890(17)270200(10)dol2401")).toMatchObject({
      gtin: "08901234567890",
      expiry: "2027-02-28",
      batch: "dol2401",
    });
    expect(
      matchScan(shop(), "(01)08901234567890(10)dol2401", today).batch?.id,
    ).toBe("dolo-b1");
  });
  it("flags a scanned batch that is unrecorded, expired or out of stock", () => {
    const s = shop();
    const scan = (batch: string) => `0108901234567890${"10"}${batch}`;
    expect(matchScan(s, scan("DOL9999"), today).batchIssue).toBe("unrecorded");
    s.batches["dolo-b1"].expiry = "2026-09-01";
    expect(matchScan(s, scan("DOL2401"), today).batchIssue).toBe("expired");
    s.batches["dolo-b1"].expiry = "2027-04-30";
    s.batches["dolo-b1"].quantity = "0";
    expect(matchScan(s, scan("DOL2401"), today).batchIssue).toBe("no_stock");
  });
  it("reports shared, unknown and inactive barcodes without guessing", () => {
    const s = shop();
    s.products.ors.barcode = "8901234567890";
    expect(
      matchScan(s, "8901234567890", today)
        .products.map((p) => p.id)
        .sort(),
    ).toEqual(["dolo", "ors"]);
    expect(matchScan(s, "8900000000000", today).products).toEqual([]);
    s.products.cetirizine.active = false;
    expect(matchScan(s, "8905555555557", today).products).toEqual([]);
  });
  it("treats short numeric and text codes as plain barcodes", () => {
    expect(parseScan("12345670")).toEqual({ code: "12345670" });
    expect(parseScan("https://example.test/p/1")).toEqual({
      code: "https://example.test/p/1",
    });
  });
});
