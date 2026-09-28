import { describe, it, expect } from "vitest";
import {
  demoState,
  catalogueSignature,
  blankReceivingLine,
  receivingLine,
  buildPurchase,
  importInvoiceDraft,
  productSuggestions,
  execute,
  type ReceivingDraft,
  type InvoiceDraft,
  type Actor,
} from "../src";
const now = new Date().toISOString();
const owner: Actor = {
  id: "demo-owner",
  businessId: "pilot-pharmacy",
  role: "owner",
  canCollect: true,
};
function fixture() {
  const state = demoState();
  const line = {
    ...blankReceivingLine("line-1", "new-lot"),
    productId: "dolo",
    code: "LOT-A",
    expiry: "2030-12-31",
    quantity: "10",
    bonus: "1",
    unit: "strip",
    priceUnit: "strip",
    price: "28",
    mrp: "35",
    cost: "20",
    total: "200",
    confirmed: true,
    catalogueSignature: catalogueSignature(state.products.dolo),
  };
  const draft: ReceivingDraft = {
    id: "purchase-1",
    supplierId: "supplier-1",
    supplierName: "",
    supplierGstin: "",
    number: "SUP-1",
    date: now.slice(0, 10),
    total: "200",
    lines: [line],
    warnings: [],
  };
  return { state, line, draft };
}
let n = 0;
const post = (
  state: ReturnType<typeof demoState>,
  op: ReturnType<typeof buildPurchase>,
) =>
  execute(
    state,
    { id: `purchase-cmd-${++n}`, occurredAt: now, operation: op },
    owner,
    now,
  ).state;
describe("Supplier invoice receiving", () => {
  it("converts purchased and free strips to base stock and per-tablet prices exactly", () => {
    const { state, draft } = fixture();
    const next = post(state, buildPurchase(draft, state));
    expect(next.batches["new-lot"]).toMatchObject({
      quantity: "110",
      pricePaise: 280,
      mrpPaise: 350,
      costPaise: 200,
    });
    expect(next.purchases["purchase-1"].lines[0].receiving).toMatchObject({
      quantity: "10",
      bonusQuantity: "1",
      unit: "strip",
      baseUnitsPerUnit: "10",
    });
  });
  it("requires explicit units rather than treating extracted strips as tablets", () => {
    const { state, line } = fixture();
    expect(() =>
      receivingLine({ ...line, unit: "" }, state.products.dolo),
    ).toThrow("unit");
    expect(() =>
      receivingLine({ ...line, priceUnit: "" }, state.products.dolo),
    ).toThrow("unit");
  });
  it("preserves all source fields without guessing a catalogue product or price unit", () => {
    const raw: InvoiceDraft = {
      supplierName: "Supplier",
      supplierGstin: "09ABC",
      invoiceNumber: "1",
      invoiceDate: null,
      totalPaise: null,
      warnings: ["Month-only expiry"],
      lines: [
        {
          name: "Dolo",
          strength: "650 mg",
          batchCode: "LOT",
          expiry: null,
          quantity: "10",
          bonusQuantity: "1",
          unit: "strip",
          packSize: "10 tablets",
          mrpPaise: 3500,
          lineTotalPaise: 20000,
          taxBps: 1200,
        },
      ],
    };
    let seq = 0;
    const imported = importInvoiceDraft(raw, () => `id-${++seq}`);
    expect(imported.lines[0].source).toEqual(raw.lines[0]);
    expect(imported.lines[0]).toMatchObject({
      productId: "",
      unit: "",
      priceUnit: "",
      expiry: "",
      confirmed: false,
      mrp: "35",
    });
    expect(imported.supplierGstin).toBe("09ABC");
  });
  it("starts printed quantities and batches in a form the checks accept, keeping what was read", () => {
    const raw: InvoiceDraft = {
      supplierName: "Test",
      supplierGstin: null,
      invoiceNumber: "1",
      invoiceDate: null,
      totalPaise: null,
      lines: [
        {
          name: "Face Mask (pack of\n10)",
          strength: null,
          batchCode: " M90\n87 ",
          expiry: "2027-11-30",
          quantity: "1.",
          bonusQuantity: "1,200",
          unit: null,
          packSize: null,
          mrpPaise: null,
          lineTotalPaise: 10500,
          taxBps: 500,
        },
      ],
      warnings: [],
    };
    const imported = importInvoiceDraft(raw, () => "id");
    expect(imported.lines[0]).toMatchObject({
      quantity: "1",
      bonus: "1200",
      code: "M90 87",
    });
    expect(imported.lines[0].source).toEqual(raw.lines[0]);
    expect(
      importInvoiceDraft(
        { ...raw, lines: [{ ...raw.lines[0], bonusQuantity: null }] },
        () => "id",
      ).lines[0].bonus,
    ).toBe("0");
  });
  it("rejects fractional-paise conversion and incomplete expiry", () => {
    const { state, line } = fixture();
    expect(() =>
      receivingLine({ ...line, mrp: "35.01" }, state.products.dolo),
    ).toThrow("fractions");
    expect(() =>
      receivingLine({ ...line, expiry: "2030-12" }, state.products.dolo),
    ).toThrow("expiry");
  });
  it("does not invent verified cost or accept incomplete line review", () => {
    const { state, line, draft } = fixture();
    expect(
      receivingLine({ ...line, cost: "" }, state.products.dolo).batch
        .verifiedCost,
    ).toBe(false);
    expect(() =>
      buildPurchase(
        { ...draft, lines: [{ ...line, confirmed: false }] },
        state,
      ),
    ).toThrow("confirm every");
    expect(() => buildPurchase({ ...draft, total: "201" }, state)).toThrow(
      "totals",
    );
  });
  it("rejects manipulated and stale pack conversion at the domain boundary", () => {
    const { state, draft } = fixture();
    const op = buildPurchase(draft, state);
    op.lines[0].quantity = "999";
    expect(() => post(state, op)).toThrow("conversion");
    const original = buildPurchase(draft, state);
    state.products.dolo.units.strip = "15";
    expect(() => post(state, original)).toThrow("changed");
  });
  it("blocks reused purchase IDs even with a different invoice number", () => {
    const { state, draft } = fixture();
    const op = buildPurchase(draft, state),
      next = post(state, op);
    expect(() => post(next, { ...op, invoiceNumber: "another" })).toThrow(
      "Purchase ID already posted",
    );
  });
  it("blocks expired, inactive and fractional discrete stock on the server", () => {
    const { state, draft } = fixture();
    const op = buildPurchase(draft, state);
    const expired = structuredClone(op);
    expired.lines[0].batch.expiry = "2020-01-01";
    expect(() => post(state, expired)).toThrow("Expired");
    const fractional = structuredClone(op);
    fractional.lines[0].quantity = "0.5";
    expect(() => post(state, fractional)).toThrow("whole");
    state.products.dolo.active = false;
    expect(() => post(state, op)).toThrow("inactive");
  });
  it("rolls back all lines when any line has an invalid price", () => {
    const { state, draft } = fixture();
    const op = buildPurchase(draft, state);
    const bad = structuredClone(op.lines[0]);
    bad.batch.id = "bad-lot";
    bad.batch.pricePaise = 99999;
    op.lines.push(bad);
    op.totalPaise *= 2;
    expect(() => post(state, op)).toThrow("MRP");
    expect(state.batches["new-lot"]).toBeUndefined();
    expect(state.purchases["purchase-1"]).toBeUndefined();
  });
  it("bounds product suggestions and retains exact strength variants for human selection", () => {
    const { state } = fixture();
    const products = [
      state.products.dolo,
      { ...state.products.dolo, id: "dolo-500", strength: "500 mg" },
    ];
    expect(productSuggestions(products, "Dolo 500 mg")[0].id).toBe("dolo-500");
    expect(productSuggestions(products, "Dolo")).toHaveLength(2);
  });
});
it("requires renewed review when the cached catalogue changes after confirmation", () => {
  const { state, draft } = fixture();
  state.products.dolo.units.strip = "15";
  expect(() => buildPurchase(draft, state)).toThrow("confirm the items again");
});
it("records an explicit invoice adjustment without inventing stock or per-unit costs", () => {
  const { state, draft } = fixture();
  draft.total = "199.50";
  draft.adjustment = "-0.50";
  draft.adjustmentReason = "Invoice round-off";
  const next = post(state, buildPurchase(draft, state));
  expect(next.purchases[draft.id].adjustmentPaise).toBe(-50);
  expect(next.batches["new-lot"].quantity).toBe("110");
  draft.adjustmentReason = "";
  expect(() => buildPurchase(draft, state)).toThrow("reason");
});
