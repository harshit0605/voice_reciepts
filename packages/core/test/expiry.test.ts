import { describe, it, expect } from "vitest";
import { demoState, expiryRows, sumCostValue } from "../src";

const now = "2026-09-23T09:00:00.000Z";
function shop() {
  const s = demoState(undefined, undefined, undefined, now);
  const base = s.batches["dolo-b1"];
  const add = (id: string, expiry: string, quantity: string, extra = {}) => {
    s.batches[id] = {
      ...base,
      id,
      code: id.toUpperCase(),
      expiry,
      quantity,
      ...extra,
    };
  };
  s.batches["dolo-b1"].expiry = "2027-12-31";
  add("past", "2026-09-22", "4", { costPaise: 100, mrpPaise: 300 });
  add("today", "2026-09-23", "2");
  add("d30", "2026-10-23", "1");
  add("d31", "2026-10-24", "1");
  add("d90", "2026-12-22", "1");
  add("d91", "2026-12-23", "1");
  add("empty", "2026-09-01", "0");
  add("negative", "2026-09-01", "-2");
  return s;
}
describe("expiry list", () => {
  it("groups by the shop's date, soonest first, skipping empty and far batches", () => {
    const rows = expiryRows(shop(), "2026-09-23");
    expect(rows.map((r) => [r.batch.id, r.group, r.daysLeft])).toEqual([
      ["past", "expired", -1],
      ["today", "within30", 0],
      ["d30", "within30", 30],
      ["d31", "within90", 31],
      ["d90", "within90", 90],
    ]);
  });
  it("values quantity at cost and MRP", () => {
    const [past] = expiryRows(shop(), "2026-09-23");
    expect(past.costValuePaise).toBe(400);
    expect(past.mrpValuePaise).toBe(1200);
    expect(past.quantity).toBe("4");
  });
  it("leaves cost out when a batch has none", () => {
    const s = shop();
    delete s.batches["past"].costPaise;
    const rows = expiryRows(s, "2026-09-23");
    expect(rows[0].costValuePaise).toBeUndefined();
    expect(sumCostValue(rows)).toBe(
      rows.slice(1).reduce((n, r) => n + (r.costValuePaise ?? 0), 0),
    );
  });
  it("drops quarantined-only batches because they are no longer sellable", () => {
    const s = shop();
    s.batches["past"].quantity = "0";
    s.batches["past"].quarantined = "4";
    expect(expiryRows(s, "2026-09-23").map((r) => r.batch.id)).not.toContain(
      "past",
    );
  });
});
