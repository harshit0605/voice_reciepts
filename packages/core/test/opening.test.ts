import { describe, it, expect } from "vitest";
import {
  demoState,
  execute,
  parseExpiry,
  openingCount,
  packUnit,
  quote,
  type Actor,
  type CountInput,
} from "../src";
const now = "2026-09-28T09:00:00.000Z",
  today = "2026-09-28";
const owner: Actor = {
  id: "demo-owner",
  role: "owner",
  businessId: "pilot-pharmacy",
  canCollect: true,
};
const shop = () => demoState(undefined, undefined, undefined, now);
const input = (over: Partial<CountInput> = {}): CountInput => ({
  code: "DL2609",
  expiry: "04/28",
  quantity: "15",
  unit: "strip",
  mrp: "30",
  priceUnit: "strip",
  price: "",
  cost: "",
  ...over,
});
describe("expiry as printed on packs", () => {
  it("reads month-year forms as the last day of the month", () => {
    expect(parseExpiry("04/27")).toBe("2027-04-30");
    expect(parseExpiry("EXP. 02/2028")).toBe("2028-02-29");
    expect(parseExpiry("Apr-27")).toBe("2027-04-30");
    expect(parseExpiry("SEPT 2027")).toBe("2027-09-30");
    expect(parseExpiry("12.2026")).toBe("2026-12-31");
  });
  it("reads full dates and rejects impossible ones", () => {
    expect(parseExpiry("2027-04-15")).toBe("2027-04-15");
    expect(parseExpiry("15/04/2027")).toBe("2027-04-15");
    expect(parseExpiry("31/02/2027")).toBeNull();
    expect(parseExpiry("13/27")).toBeNull();
    expect(parseExpiry("soon")).toBeNull();
  });
});
describe("opening count", () => {
  const s = shop();
  const dolo = s.products.dolo;
  const batches = Object.values(s.batches);
  it("converts strips and a per-strip MRP to base units and paise", () => {
    const { batch, notes } = openingCount(input(), dolo, batches, today, "b1");
    expect(batch).toMatchObject({
      productId: "dolo",
      code: "DL2609",
      expiry: "2028-04-30",
      quantity: "150",
      mrpPaise: 300,
      pricePaise: 300,
      verifiedCost: false,
    });
    expect(notes).toEqual([]);
  });
  it("rounds an uneven per-tablet price down so a strip never exceeds MRP", () => {
    const fifteen = { ...dolo, units: { tablet: "1", strip: "15" } };
    const { batch, notes } = openingCount(
      input({ mrp: "32.50", price: "32.50", cost: "20" }),
      fifteen,
      batches,
      today,
      "b2",
    );
    expect(batch.mrpPaise).toBe(216);
    expect(batch.pricePaise).toBe(216);
    expect(batch.costPaise).toBe(133);
    expect(batch.pricePaise * 15).toBeLessThanOrEqual(3250);
    expect(notes[0]).toMatch(/rounded down.*₹32\.40/);
  });
  it("refuses repeated, expired, fractional and over-MRP counts", () => {
    const count = (over: Partial<CountInput>) => () =>
      openingCount(input(over), dolo, batches, today, "x");
    expect(count({ code: " dol2401 " })).toThrow("already in stock");
    expect(count({ expiry: "08/26" })).toThrow("expired");
    expect(count({ expiry: "someday" })).toThrow("as printed");
    expect(count({ quantity: "1.5", unit: "tablet" })).toThrow("whole tablets");
    expect(count({ quantity: "0" })).toThrow("more than zero");
    expect(count({ price: "31" })).toThrow("more than MRP");
    expect(count({ mrp: "" })).toThrow("MRP");
  });
  it("flags stock that expires within three months", () => {
    const { notes } = openingCount(
      input({ expiry: "11/26" }),
      dolo,
      batches,
      today,
      "b3",
    );
    expect(notes).toContain("Expires within 3 months");
  });
  it("prices by the strip when there is one", () => {
    expect(packUnit(dolo)).toBe("strip");
    expect(packUnit(s.products.betadine)).toBe("bottle");
  });
  it("posts through the engine, is sellable at once, and cannot be counted twice", () => {
    const { batch } = openingCount(input(), dolo, batches, today, "b4");
    const op = {
      type: "stock.opening" as const,
      batch,
      reason: "Owner verified physical opening count",
    };
    const out = execute(
      s,
      { id: "count-1", occurredAt: now, operation: op },
      owner,
      now,
    ).state;
    expect(out.batches.b4.quantity).toBe("150");
    expect(
      quote(
        out,
        [{ batchId: "b4", quantity: "1", unit: "strip", confirmed: true }],
        now,
      )[0].netPaise,
    ).toBe(3000);
    expect(() =>
      execute(
        out,
        {
          id: "count-2",
          occurredAt: now,
          operation: { ...op, batch: { ...batch, id: "b5", code: "dl2609" } },
        },
        owner,
        now,
      ),
    ).toThrow("already in stock");
  });
});
