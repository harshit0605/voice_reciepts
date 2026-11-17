/**
 * QA edge-case tests for the core engine: money, stock, expiry, approvals, drawer,
 * idempotency, offline sales and role permissions. Pure functions only; no database.
 * Tests that fail here are believed to be real bugs (see the QA report).
 */
import { describe, expect, it } from "vitest";
import {
  DomainError,
  demoState,
  employeeView,
  execute,
  expectedCash,
  balance,
  indiaDate,
  parseExpiry,
  quote,
  refundQuote,
  openRefundRequest,
  round,
  totals,
  type Actor,
  type Operation,
  type State,
} from "../src";

const NOW = "2026-09-23T09:00:00.000Z";
const owner: Actor = {
  id: "demo-owner",
  role: "owner",
  businessId: "pilot-pharmacy",
  canCollect: true,
};
const staff: Actor = {
  id: "demo-employee",
  role: "employee",
  businessId: "pilot-pharmacy",
  canCollect: true,
};
const staffNoCash: Actor = { ...staff, canCollect: false };
const offlineOwner: Actor = { ...owner, offlineAuthorized: true };

let counter = 0;
const nextId = () => `qa-${++counter}`;
const plus = (at: string, ms: number) =>
  new Date(Date.parse(at) + ms).toISOString();

type RunOpts = { actor?: Actor; at?: string; now?: string; id?: string };
function run(s: State, operation: Operation, o: RunOpts = {}) {
  const at = o.at ?? NOW;
  return execute(
    s,
    { id: o.id ?? nextId(), occurredAt: at, operation },
    o.actor ?? owner,
    o.now ?? at,
  );
}
const step = (s: State, operation: Operation, o: RunOpts = {}) =>
  run(s, operation, o).state;
function fails(fn: () => unknown, code?: string, message?: string | RegExp) {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error, "expected the command to be rejected").toBeDefined();
  if (code) expect((error as DomainError).code).toBe(code);
  if (message) expect((error as Error).message).toMatch(message);
}

function freshState(): State {
  const s = demoState(undefined, undefined, undefined, NOW);
  s.devices["staff-device"] = {
    ...s.devices["demo-device"],
    id: "staff-device",
    userId: "demo-employee",
    series: "E01",
  };
  return s;
}
/** Adds a product with one batch `${id}-b1` and returns the state. */
function addProduct(
  s: State,
  p: {
    id: string;
    baseUnit?: string;
    units?: Record<string, string>;
    price: number;
    mrp?: number;
    tax?: number;
    qty?: string;
    expiry?: string;
    schedule?: "OTC" | "H" | "H1" | "X";
    cost?: number;
  },
) {
  const baseUnit = p.baseUnit ?? "tablet";
  s.products[p.id] = {
    id: p.id,
    name: p.id,
    generic: p.id,
    strength: "",
    form: baseUnit,
    hsn: "3004",
    aliases: [],
    barcode: `QA-${p.id}`,
    units: p.units ?? { [baseUnit]: "1", strip: "10" },
    baseUnit,
    taxBps: p.tax ?? 1200,
    reorderAt: "1",
    schedule: p.schedule ?? "OTC",
    active: true,
  };
  s.batches[`${p.id}-b1`] = {
    id: `${p.id}-b1`,
    productId: p.id,
    code: `${p.id.toUpperCase()}1`,
    expiry: p.expiry ?? "2027-12-31",
    quantity: p.qty ?? "100",
    quarantined: "0",
    pricePaise: p.price,
    mrpPaise: p.mrp ?? p.price,
    costPaise: p.cost,
    verifiedCost: p.cost !== undefined,
  };
  return s;
}
const L = (batchId: string, quantity = "1", unit = "tablet") => ({
  batchId,
  quantity,
  unit,
  confirmed: true,
});
function save(
  s: State,
  lines: ReturnType<typeof L>[],
  o: RunOpts & { orderId?: string; customerId?: string } = {},
) {
  return step(
    s,
    {
      type: "order.save",
      orderId: o.orderId ?? "order-1",
      version: 0,
      lines,
      counterId: "counter-1",
      ...(o.customerId ? { customerId: o.customerId } : {}),
    },
    o,
  );
}
const pay = (cash: number, extra: Record<string, unknown> = {}) =>
  ({
    type: "checkout",
    orderId: "order-1",
    version: 1,
    deviceId: "demo-device",
    sequence: 1,
    cashPaise: cash,
    upiPaise: 0,
    creditPaise: 0,
    discountPaise: 0,
    ...extra,
  }) as Operation;
const invoiceOf = (s: State, n = 0) => Object.values(s.invoices)[n];

/** Requests and decides an approval; the requester defaults to the owner. */
function approved(
  s: State,
  kind: "credit" | "discount" | "refund" | "stock",
  payload: Record<string, unknown>,
  id: string,
  requester: Actor = owner,
) {
  s = step(
    s,
    {
      type: "approval.request",
      approvalId: id,
      kind,
      payload,
      reason: "QA review",
    },
    { actor: requester },
  );
  return step(s, { type: "approval.decide", approvalId: id, approve: true });
}

describe("money: GST-inclusive prices and rounding", () => {
  it("splits an odd tax amount into CGST and SGST without losing a paisa", () => {
    // 7 x 333 = 2331 at 5% inclusive -> 2331 * 500 / 10500 = 111 (odd)
    const s = addProduct(freshState(), { id: "p5", price: 333, tax: 500 });
    const [l] = quote(s, [L("p5-b1", "7")], NOW);
    expect(l.grossPaise).toBe(2331);
    expect(l.taxPaise).toBe(111);
    expect(l.cgstPaise + l.sgstPaise).toBe(111);
    expect(Math.abs(l.cgstPaise - l.sgstPaise)).toBeLessThanOrEqual(1);
  });
  it("rounds tax half-up on an exact .5 paisa", () => {
    // 100% GST inclusive on 3 paise: 3 * 10000 / 20000 = 1.5 -> 2
    const s = addProduct(freshState(), { id: "half", price: 3, tax: 10000 });
    expect(quote(s, [L("half-b1")], NOW)[0].taxPaise).toBe(2);
  });
  it("rounds a fractional gross half-up (0.5 ml at 333 paise = 166.5 -> 167)", () => {
    const s = addProduct(freshState(), {
      id: "syrup",
      baseUnit: "ml",
      units: { ml: "1" },
      price: 333,
    });
    expect(quote(s, [L("syrup-b1", "0.5", "ml")], NOW)[0].grossPaise).toBe(167);
    expect(round("0.5")).toBe(1);
  });
  it("zero-rated goods carry no tax", () => {
    const s = addProduct(freshState(), { id: "zero", price: 1000, tax: 0 });
    const [l] = quote(s, [L("zero-b1", "3")], NOW);
    expect(l.taxPaise).toBe(0);
    expect(l.cgstPaise + l.sgstPaise).toBe(0);
  });
  it("rejects a selling price above MRP", () => {
    const s = addProduct(freshState(), { id: "hi", price: 1000, mrp: 900 });
    expect(() => quote(s, [L("hi-b1")], NOW)).toThrow("exceeds MRP");
  });
  it("splits a discount proportionally and every paisa is allocated", () => {
    const s = addProduct(
      addProduct(freshState(), { id: "a", price: 2800, tax: 1200 }),
      { id: "b", price: 1400, tax: 500 },
    );
    const lines = quote(s, [L("a-b1"), L("b-b1")], NOW, 100);
    expect(lines.map((l) => l.discountPaise)).toEqual([66, 34]);
    expect(lines.reduce((n, l) => n + l.discountPaise, 0)).toBe(100);
    for (const l of lines)
      expect(l.netPaise).toBe(l.grossPaise - l.discountPaise);
  });
  it("never allocates a line more discount than the line is worth", () => {
    // gross 100 / 100 / 1, discount 100: the floor split gives 49 + 49 and dumps 2 on the 1-paisa line
    const s = addProduct(
      addProduct(addProduct(freshState(), { id: "x", price: 100 }), {
        id: "y",
        price: 100,
      }),
      { id: "z", price: 1 },
    );
    const lines = quote(s, [L("x-b1"), L("y-b1"), L("z-b1")], NOW, 100);
    for (const l of lines) {
      expect(l.discountPaise).toBeGreaterThanOrEqual(0);
      expect(l.discountPaise).toBeLessThanOrEqual(l.grossPaise);
      expect(l.netPaise).toBeGreaterThanOrEqual(0);
      expect(l.taxPaise).toBeGreaterThanOrEqual(0);
    }
  });
  it("sweeps many discounts: allocation sums exactly and tax reconciles", () => {
    const s = addProduct(
      addProduct(
        addProduct(freshState(), { id: "m1", price: 1730, tax: 1200 }),
        {
          id: "m2",
          price: 905,
          tax: 500,
        },
      ),
      { id: "m3", price: 4410, tax: 1800 },
    );
    const lines = [L("m1-b1", "3"), L("m2-b1", "7"), L("m3-b1", "2")];
    const gross = quote(s, lines, NOW).reduce((n, l) => n + l.grossPaise, 0);
    for (let d = 0; d <= gross; d += 37) {
      const out = quote(s, lines, NOW, d);
      expect(out.reduce((n, l) => n + l.discountPaise, 0)).toBe(d);
      expect(out.reduce((n, l) => n + l.netPaise, 0)).toBe(gross - d);
      for (const l of out) {
        expect(l.discountPaise).toBeLessThanOrEqual(l.grossPaise);
        expect(l.cgstPaise + l.sgstPaise).toBe(l.taxPaise);
      }
    }
    expect(() => quote(s, lines, NOW, gross + 1)).toThrow("Discount exceeds");
  });
  it("a 100% discount produces a zero bill that needs no payment", () => {
    const s = freshState();
    const total = quote(s, [L("dolo-b1", "1", "strip")], NOW)[0].grossPaise;
    let st = save(s, [L("dolo-b1", "1", "strip")]);
    st = approved(
      st,
      "discount",
      { orderId: "order-1", orderVersion: 1, amountPaise: total },
      "ap-d",
    );
    st = step(st, pay(0, { discountPaise: total, discountApprovalId: "ap-d" }));
    expect(invoiceOf(st).totalPaise).toBe(0);
    expect(invoiceOf(st).taxPaise).toBe(0);
    expect(Object.values(st.payments)).toHaveLength(0);
  });
});

describe("money: split payments and totals", () => {
  const setup = () => save(freshState(), [L("dolo-b1", "1", "strip")]);
  it("accepts cash + UPI that sum exactly to the invoice", () => {
    const st = step(
      setup(),
      pay(1800, { upiPaise: 1000, upiReference: "utr1", upiVerified: true }),
    );
    const methods = Object.values(st.payments).map((p) => [
      p.method,
      p.amountPaise,
    ]);
    expect(methods).toEqual(
      expect.arrayContaining([
        ["cash", 1800],
        ["upi", 1000],
      ]),
    );
    expect(totals(st).cashCollectedPaise).toBe(1800);
    expect(totals(st).upiCollectedPaise).toBe(1000);
    expect(expectedCash(st, "drawer-demo")).toBe(200000 + 1800);
  });
  it("rejects a split that is one paisa short or over (no implicit change)", () => {
    fails(
      () =>
        run(
          setup(),
          pay(1800, { upiPaise: 999, upiReference: "u", upiVerified: true }),
        ),
      undefined,
      "equal the invoice total",
    );
    fails(() => run(setup(), pay(2801)), undefined, "equal the invoice total");
  });
  it("needs a UPI reference and merchant verification", () => {
    fails(
      () => run(setup(), pay(1800, { upiPaise: 1000, upiVerified: true })),
      undefined,
      /reference/i,
    );
    fails(
      () => run(setup(), pay(1800, { upiPaise: 1000, upiReference: "u1" })),
      undefined,
      /Verify payment/,
    );
  });
  it("normalises UPI references and rejects reuse across invoices", () => {
    let st = step(
      setup(),
      pay(0, { upiPaise: 2800, upiReference: " abc123 ", upiVerified: true }),
    );
    expect(Object.values(st.payments)[0].reference).toBe("ABC123");
    st = save(st, [L("dolo-b1", "1", "strip")], { orderId: "order-2" });
    fails(
      () =>
        run(
          st,
          pay(0, {
            orderId: "order-2",
            sequence: 2,
            upiPaise: 2800,
            upiReference: "ABC123",
            upiVerified: true,
          }),
        ),
      "PAYMENT_REFERENCE_REUSED",
    );
  });
  it("rejects a payment total that does not match when credit is part of it", () => {
    let st = save(freshState(), [L("dolo-b1", "1", "strip")], {
      customerId: "customer-1",
    });
    st = approved(
      st,
      "credit",
      {
        orderId: "order-1",
        orderVersion: 1,
        customerId: "customer-1",
        amountPaise: 1000,
      },
      "ap-c",
    );
    fails(
      () => run(st, pay(1700, { creditPaise: 1000, creditApprovalId: "ap-c" })),
      undefined,
      "equal the invoice total",
    );
    const ok = step(
      st,
      pay(1800, { creditPaise: 1000, creditApprovalId: "ap-c" }),
    );
    expect(balance(ok, "customer-1")).toBe(1000);
    // Credit is not cash: the drawer only gets the cash part.
    expect(expectedCash(ok, "drawer-demo")).toBe(201800);
  });
  it("net sales equal invoice totals less refunds, across several days", () => {
    let st = step(setup(), pay(2800));
    st = save(st, [L("dolo-b1", "2", "tablet")], { orderId: "order-2" });
    st = step(st, pay(560, { orderId: "order-2", sequence: 2 }));
    expect(totals(st).netSalesPaise).toBe(3360);
    expect(totals(st, indiaDate(NOW)).invoiceCount).toBe(2);
    expect(totals(st, "2026-09-22").invoiceCount).toBe(0);
  });
});

describe("stock: availability and unit conversion", () => {
  it("sells exactly the remaining stock and then refuses another tablet", () => {
    let s = addProduct(freshState(), { id: "few", price: 100, qty: "10" });
    s = save(s, [L("few-b1", "1", "strip")]);
    s = step(s, pay(1000 + Math.round(0)), {});
    expect(s.batches["few-b1"].quantity).toBe("0");
    s = save(s, [L("few-b1", "1", "tablet")], { orderId: "order-2" });
    fails(
      () => run(s, pay(100, { orderId: "order-2", sequence: 2 })),
      undefined,
      "Insufficient stock",
    );
  });
  it("counts the same batch used on two lines (strip + tablets) together", () => {
    let s = addProduct(freshState(), { id: "few", price: 100, qty: "12" });
    // 1 strip (10) + 3 tablets = 13 > 12, though each line alone fits.
    s = save(s, [L("few-b1", "1", "strip"), L("few-b1", "3", "tablet")]);
    fails(() => run(s, pay(1300)), undefined, "Insufficient stock");
    let ok = save(
      addProduct(freshState(), { id: "few", price: 100, qty: "12" }),
      [L("few-b1", "1", "strip"), L("few-b1", "2", "tablet")],
    );
    ok = step(ok, pay(1200));
    expect(ok.batches["few-b1"].quantity).toBe("0");
  });
  it("sells from the chosen batch only and leaves other batches of the product alone", () => {
    let s = freshState();
    s.batches["dolo-b2"] = {
      ...s.batches["dolo-b1"],
      id: "dolo-b2",
      code: "DOLO-B2",
      quantity: "5",
    };
    s = save(s, [L("dolo-b2", "1", "strip")]);
    fails(() => run(s, pay(2800)), undefined, "Insufficient stock");
    let t = save(freshState(), [L("dolo-b1", "1", "strip")]);
    t.batches["dolo-b2"] = {
      ...t.batches["dolo-b1"],
      id: "dolo-b2",
      code: "DOLO-B2",
      quantity: "5",
    };
    t = step(t, pay(2800));
    expect(t.batches["dolo-b1"].quantity).toBe("22");
    expect(t.batches["dolo-b2"].quantity).toBe("5");
  });
  it("converts a fractional strip when it is whole tablets, rejects half a tablet", () => {
    const s = freshState();
    const half = quote(s, [L("dolo-b1", "0.5", "strip")], NOW)[0];
    expect(half.baseQuantity).toBe("5");
    expect(half.grossPaise).toBe(1400);
    expect(() => quote(s, [L("dolo-b1", "0.25", "strip")], NOW)).toThrow(
      "whole",
    );
    expect(() => quote(s, [L("dolo-b1", "1", "box")], NOW)).toThrow(
      "Unknown selling unit",
    );
  });
  it("uses each product's own pack size (Azithral strip = 3)", () => {
    const s = freshState();
    expect(
      quote(s, [L("azithral-b1", "2", "strip")], NOW)[0].baseQuantity,
    ).toBe("6");
  });
  it("refuses to change the stocked conversion once batches exist", () => {
    const s = freshState();
    const p = { ...s.products.dolo, units: { tablet: "1", strip: "15" } };
    fails(
      () => run(s, { type: "product.save", product: p }),
      undefined,
      "new product",
    );
  });
  it("rejects a product whose base unit conversion is not 1", () => {
    const s = freshState();
    const p = {
      ...s.products.dolo,
      id: "dolo2",
      units: { tablet: "2", strip: "10" },
    };
    fails(
      () => run(s, { type: "product.save", product: p }),
      undefined,
      "Base unit",
    );
  });
  it("rejects zero and negative quantities at the schema level", () => {
    const s = freshState();
    for (const q of ["0", "-1", "1e3", "01", "1.0000"])
      expect(() => save(s, [L("dolo-b1", q, "tablet")])).toThrow();
  });
  it("cannot sell a deactivated product", () => {
    const s = freshState();
    s.products.dolo.active = false;
    expect(() => save(s, [L("dolo-b1")])).toThrow("unavailable");
  });
  it("cannot sell an unconfirmed batch", () => {
    const s = freshState();
    expect(() => save(s, [{ ...L("dolo-b1"), confirmed: false }])).toThrow(
      "Confirm",
    );
  });
});

describe("expiry on the India date boundary", () => {
  const withExpiry = (expiry: string) =>
    addProduct(freshState(), { id: "exp", price: 100, expiry });
  it("indiaDate flips at 18:30 UTC", () => {
    expect(indiaDate("2026-09-23T18:29:59.999Z")).toBe("2026-09-23");
    expect(indiaDate("2026-09-23T18:30:00.000Z")).toBe("2026-09-24");
    expect(indiaDate("2026-12-31T18:30:00.000Z")).toBe("2027-01-01");
  });
  it("sells through the whole of the expiry date in India (23:59:59 IST)", () => {
    const at = "2026-09-23T18:29:59.000Z";
    const s = withExpiry("2026-09-23");
    expect(() => quote(s, [L("exp-b1")], at)).not.toThrow();
    // and the real commands accept it too
    const st = save(s, [L("exp-b1")], { at });
    expect(st.orders["order-1"]).toBeDefined();
  });
  it("is expired from 00:00:00 IST on the day after expiry", () => {
    const at = "2026-09-23T18:30:00.000Z";
    const s = withExpiry("2026-09-23");
    expect(() => quote(s, [L("exp-b1")], at)).toThrow("Expired");
    expect(() => save(s, [L("exp-b1")], { at })).toThrow("Expired");
  });
  it("uses the India date, not the UTC date, just after IST midnight", () => {
    // 19:00 UTC on the 22nd is 00:30 IST on the 23rd: a batch expiring on the 22nd is expired
    const at = "2026-09-22T19:00:00.000Z";
    expect(() => quote(withExpiry("2026-09-22"), [L("exp-b1")], at)).toThrow(
      "Expired",
    );
    expect(() =>
      quote(withExpiry("2026-09-23"), [L("exp-b1")], at),
    ).not.toThrow();
  });
  it("an order saved before midnight cannot be checked out after the batch expires", () => {
    let s = withExpiry("2026-09-23");
    s = save(s, [L("exp-b1")], { at: "2026-09-23T18:00:00.000Z" });
    s.drawers["drawer-demo"].openedAt = "2026-09-23T08:00:00.000Z";
    const late = "2026-09-23T18:31:00.000Z";
    fails(() => run(s, pay(100), { at: late }), undefined, "Expired");
  });
  it("month-only expiry means the last day of that month", () => {
    expect(parseExpiry("09/26")).toBe("2026-09-30");
    expect(parseExpiry("02/28")).toBe("2028-02-29"); // leap year
    expect(parseExpiry("02/27")).toBe("2027-02-28");
    expect(parseExpiry("Dec 2026")).toBe("2026-12-31");
    expect(parseExpiry("EXP 12-26")).toBe("2026-12-31");
    expect(parseExpiry("13/26")).toBeNull();
    expect(parseExpiry("00/26")).toBeNull();
  });
  it("a month-only batch sells until 23:59 IST on the last day and not after", () => {
    const expiry = parseExpiry("09/26")!;
    const s = withExpiry(expiry);
    expect(() =>
      quote(s, [L("exp-b1")], "2026-09-30T18:29:59.000Z"),
    ).not.toThrow();
    expect(() => quote(s, [L("exp-b1")], "2026-09-30T18:30:00.000Z")).toThrow(
      "Expired",
    );
  });
  it("parseExpiry returns null (never throws) for impossible dates", () => {
    for (const bad of ["32/01/2027", "99/99/2027", "31/13/2027", "1/1/27x"])
      expect(() => parseExpiry(bad), bad).not.toThrow();
    expect(parseExpiry("30/02/2027")).toBeNull();
    expect(parseExpiry("29/02/2027")).toBeNull();
  });
  it("purchases cannot receive stock that expired yesterday in India", () => {
    const s = freshState();
    const batch = {
      id: "new-b",
      productId: "dolo",
      code: "NEW1",
      expiry: "2026-09-22",
      quantity: "0",
      quarantined: "0",
      pricePaise: 280,
      mrpPaise: 280,
      verifiedCost: false,
    };
    const op = (expiry: string): Operation => ({
      type: "purchase.post",
      purchaseId: `pur-${expiry}`,
      supplierId: "supplier-1",
      invoiceNumber: `INV-${expiry}`,
      invoiceDate: "2026-09-23",
      totalPaise: 1000,
      reviewed: true,
      lines: [
        {
          batch: { ...batch, id: `b-${expiry}`, code: `C${expiry}`, expiry },
          quantity: "10",
          bonusQuantity: "0",
          lineTotalPaise: 1000,
        },
      ],
    });
    fails(() => run(s, op("2026-09-22")), undefined, "Expired");
    // the 23rd is valid until midnight IST (at 14:30 IST on the 23rd)
    expect(
      run(s, op("2026-09-23")).state.batches["b-2026-09-23"].quantity,
    ).toBe("10");
  });
});

describe("quarantine, disposal and returns", () => {
  const request = (
    s: State,
    id: string,
    payload: Record<string, unknown>,
    requester: Actor = owner,
  ) => approved(s, "stock", payload, id, requester);

  it("quarantine moves sellable stock aside, disposal then clears it", () => {
    let s = freshState();
    s = request(s, "q1", {
      batchId: "dolo-b1",
      quantity: "5",
      kind: "quarantine",
      reason: "Damp pack",
    });
    s = step(s, { type: "stock.execute", approvalId: "q1" });
    expect(s.batches["dolo-b1"].quantity).toBe("27");
    expect(s.batches["dolo-b1"].quarantined).toBe("5");
    s = request(s, "q2", {
      batchId: "dolo-b1",
      quantity: "-5",
      kind: "quarantine_disposal",
      reason: "Destroyed",
    });
    s = step(s, { type: "stock.execute", approvalId: "q2" });
    expect(s.batches["dolo-b1"].quantity).toBe("27");
    expect(s.batches["dolo-b1"].quarantined).toBe("0");
    // total on-hand ledger reconciles with batch quantities
    const moved = Object.values(s.stock)
      .filter((m) => m.batchId === "dolo-b1")
      .reduce((n, m) => n + Number(m.quantity), 0);
    expect(String(moved)).toBe("27");
  });
  it("refuses to quarantine more than is on the shelf or dispose more than is quarantined", () => {
    let s = freshState();
    s = request(s, "q1", {
      batchId: "dolo-b1",
      quantity: "33",
      kind: "quarantine",
      reason: "too many",
    });
    fails(
      () => run(s, { type: "stock.execute", approvalId: "q1" }),
      undefined,
      "recorded sellable",
    );
    s = request(s, "q2", {
      batchId: "dolo-b1",
      quantity: "-1",
      kind: "quarantine_disposal",
      reason: "none there",
    });
    fails(
      () => run(s, { type: "stock.execute", approvalId: "q2" }),
      undefined,
      "Invalid quarantine disposal",
    );
  });
  it("quarantined stock cannot be sold", () => {
    let s = freshState();
    s = request(s, "q1", {
      batchId: "dolo-b1",
      quantity: "30",
      kind: "quarantine",
      reason: "Recall",
    });
    s = step(s, { type: "stock.execute", approvalId: "q1" });
    s = save(s, [L("dolo-b1", "1", "strip")]);
    fails(() => run(s, pay(2800)), undefined, "Insufficient stock");
  });
  it("an expired batch can be taken off the shelf and disposed of although it cannot be sold", () => {
    let s = freshState();
    s.batches["dolo-b1"].expiry = "2026-09-01";
    expect(() => quote(s, [L("dolo-b1")], NOW)).toThrow("Expired");
    s = request(s, "q1", {
      batchId: "dolo-b1",
      quantity: "32",
      kind: "quarantine",
      reason: "Expired",
    });
    s = step(s, { type: "stock.execute", approvalId: "q1" });
    expect(s.batches["dolo-b1"].quantity).toBe("0");
    // expired stock can never be released back to the shelf
    s = request(s, "r1", {
      batchId: "dolo-b1",
      quantity: "1",
      kind: "release",
      reason: "oops",
    });
    fails(
      () => run(s, { type: "stock.execute", approvalId: "r1" }),
      undefined,
      "Expired returns cannot be released",
    );
  });
  it("a stock approval is single-use and owner-executed", () => {
    let s = freshState();
    s = request(
      s,
      "q1",
      { batchId: "dolo-b1", quantity: "1", kind: "quarantine", reason: "test" },
      staff,
    );
    fails(
      () =>
        run(s, { type: "stock.execute", approvalId: "q1" }, { actor: staff }),
      "FORBIDDEN",
    );
    s = step(s, { type: "stock.execute", approvalId: "q1" });
    fails(
      () => run(s, { type: "stock.execute", approvalId: "q1" }),
      "FORBIDDEN",
      /unused/,
    );
  });
  it("adjustments that reduce stock must be negative and cannot go below zero", () => {
    let s = freshState();
    s = request(s, "d1", {
      batchId: "dolo-b1",
      quantity: "5",
      kind: "damage",
      reason: "positive damage",
    });
    fails(
      () => run(s, { type: "stock.execute", approvalId: "d1" }),
      undefined,
      "must reduce",
    );
    s = request(s, "d2", {
      batchId: "dolo-b1",
      quantity: "-33",
      kind: "damage",
      reason: "too much",
    });
    fails(
      () => run(s, { type: "stock.execute", approvalId: "d2" }),
      undefined,
      "negative",
    );
  });

  describe("returns", () => {
    const sold = (s = freshState(), extra: Record<string, unknown> = {}) =>
      step(save(s, [L("dolo-b1", "1", "strip")]), pay(2800, extra));
    const refundRequest = (
      s: State,
      id: string,
      lines: { index: number; quantity: string }[],
      who: Actor = staff,
    ) =>
      step(
        s,
        {
          type: "approval.request",
          approvalId: id,
          kind: "refund",
          payload: { invoiceId: invoiceOf(s).id, lines },
          reason: "customer returned",
        },
        { actor: who },
      );
    const decide = (s: State, id: string, approve = true) =>
      step(s, { type: "approval.decide", approvalId: id, approve });

    it("puts returned tablets into quarantine of the original batch; release restores sellable stock", () => {
      let s = sold();
      s.batches["dolo-b2"] = {
        ...s.batches["dolo-b1"],
        id: "dolo-b2",
        code: "OTHER",
        quantity: "50",
      };
      s = decide(refundRequest(s, "rf1", [{ index: 0, quantity: "4" }]), "rf1");
      s = step(
        s,
        {
          type: "refund.execute",
          approvalId: "rf1",
          cashPaise: 1120,
          upiPaise: 0,
        },
        { actor: staff },
      );
      expect(s.batches["dolo-b1"].quantity).toBe("22");
      expect(s.batches["dolo-b1"].quarantined).toBe("4");
      expect(s.batches["dolo-b2"].quarantined).toBe("0");
      s = approved(
        s,
        "stock",
        {
          batchId: "dolo-b1",
          quantity: "4",
          kind: "release",
          reason: "Sealed, resaleable",
        },
        "rel1",
      );
      s = step(s, { type: "stock.execute", approvalId: "rel1" });
      expect(s.batches["dolo-b1"].quantity).toBe("26");
      expect(s.batches["dolo-b1"].quarantined).toBe("0");
      expect(s.batches["dolo-b2"].quantity).toBe("50");
    });
    it("piecewise returns add up to exactly the invoice net, never a paisa more", () => {
      let s = sold(freshState());
      let paid = 0;
      for (let i = 0; i < 10; i++) {
        s = decide(
          refundRequest(s, `rf-${i}`, [{ index: 0, quantity: "1" }]),
          `rf-${i}`,
        );
        const q = refundQuote(s, invoiceOf(s), [{ index: 0, quantity: "1" }]);
        paid += q.payablePaise;
        s = step(
          s,
          {
            type: "refund.execute",
            approvalId: `rf-${i}`,
            cashPaise: q.payablePaise,
            upiPaise: 0,
          },
          { actor: staff },
        );
      }
      expect(paid).toBe(invoiceOf(s).totalPaise);
      fails(
        () => refundQuote(s, invoiceOf(s), [{ index: 0, quantity: "1" }]),
        undefined,
        "exceeds",
      );
    });
    it("a discounted bill refunds proportionally and the odd paisa is never double paid", () => {
      let s = save(freshState(), [L("dolo-b1", "3", "tablet")]);
      s = approved(
        s,
        "discount",
        { orderId: "order-1", orderVersion: 1, amountPaise: 1 },
        "ap-d",
      );
      s = step(s, pay(839, { discountPaise: 1, discountApprovalId: "ap-d" }));
      const inv = invoiceOf(s);
      let total = 0;
      for (const q of ["1", "1", "1"]) {
        total += refundQuote({ ...s, refunds: {} } as State, inv, [
          { index: 0, quantity: q },
        ]).totalPaise;
      }
      expect(total).toBeGreaterThanOrEqual(inv.totalPaise); // each alone: 280-ish
      // cumulative: returning 1+1+1 in sequence never exceeds net
      const all = refundQuote(s, inv, [{ index: 0, quantity: "3" }]);
      expect(all.totalPaise).toBe(inv.totalPaise);
    });
    it("rejects a return larger than what was sold, a duplicate line and a missing line", () => {
      const s = sold();
      const inv = invoiceOf(s);
      fails(
        () => refundQuote(s, inv, [{ index: 0, quantity: "11" }]),
        undefined,
        "exceeds",
      );
      fails(
        () =>
          refundQuote(s, inv, [
            { index: 0, quantity: "1" },
            { index: 0, quantity: "1" },
          ]),
        undefined,
        "Duplicate",
      );
      fails(
        () => refundQuote(s, inv, [{ index: 3, quantity: "1" }]),
        undefined,
        "missing",
      );
      fails(() => refundQuote(s, inv, []), undefined, "Choose");
    });
    it("rejects a fractional tablet return (tablets are only sold whole)", () => {
      const s = sold();
      expect(() =>
        refundRequest(s, "frac", [{ index: 0, quantity: "1.5" }]),
      ).toThrow();
    });
    it("a credit sale return first cancels what the customer still owes", () => {
      let s = save(freshState(), [L("dolo-b1", "1", "strip")], {
        customerId: "customer-1",
      });
      s = approved(
        s,
        "credit",
        {
          orderId: "order-1",
          orderVersion: 1,
          customerId: "customer-1",
          amountPaise: 1000,
        },
        "ap-c",
      );
      s = step(s, pay(1800, { creditPaise: 1000, creditApprovalId: "ap-c" }));
      s = decide(
        refundRequest(s, "rf1", [{ index: 0, quantity: "10" }]),
        "rf1",
      );
      const q = refundQuote(s, invoiceOf(s), [{ index: 0, quantity: "10" }]);
      expect(q.creditReductionPaise).toBe(1000);
      expect(q.payablePaise).toBe(1800);
      fails(
        () =>
          run(
            s,
            {
              type: "refund.execute",
              approvalId: "rf1",
              cashPaise: 2800,
              upiPaise: 0,
            },
            { actor: staff },
          ),
        undefined,
        /Refund/,
      );
      s = step(
        s,
        {
          type: "refund.execute",
          approvalId: "rf1",
          cashPaise: 1800,
          upiPaise: 0,
        },
        { actor: staff },
      );
      expect(balance(s, "customer-1")).toBe(0);
      expect(expectedCash(s, "drawer-demo")).toBe(200000);
    });
    it("only the requesting employee (or the owner) can pay out, and only once", () => {
      let s = decide(
        refundRequest(sold(), "rf1", [{ index: 0, quantity: "1" }]),
        "rf1",
      );
      const other: Actor = { ...staff, id: "someone-else" };
      s.members["someone-else"] = {
        ...s.members["demo-employee"],
        id: "someone-else",
      };
      fails(
        () =>
          run(
            s,
            {
              type: "refund.execute",
              approvalId: "rf1",
              cashPaise: 280,
              upiPaise: 0,
            },
            { actor: other },
          ),
        "FORBIDDEN",
      );
      s = step(
        s,
        {
          type: "refund.execute",
          approvalId: "rf1",
          cashPaise: 280,
          upiPaise: 0,
        },
        { actor: staff },
      );
      fails(
        () =>
          run(
            s,
            {
              type: "refund.execute",
              approvalId: "rf1",
              cashPaise: 280,
              upiPaise: 0,
            },
            { actor: staff },
          ),
        "FORBIDDEN",
      );
    });
    it("cannot be executed before the owner decides, or after rejection", () => {
      let s = refundRequest(sold(), "rf1", [{ index: 0, quantity: "1" }]);
      fails(
        () =>
          run(
            s,
            {
              type: "refund.execute",
              approvalId: "rf1",
              cashPaise: 280,
              upiPaise: 0,
            },
            { actor: staff },
          ),
        "FORBIDDEN",
      );
      s = decide(s, "rf1", false);
      fails(
        () =>
          run(
            s,
            {
              type: "refund.execute",
              approvalId: "rf1",
              cashPaise: 280,
              upiPaise: 0,
            },
            { actor: staff },
          ),
        "FORBIDDEN",
      );
      // after rejection a new request for the same bill is allowed
      expect(() =>
        refundRequest(s, "rf2", [{ index: 0, quantity: "1" }]),
      ).not.toThrow();
    });
    it("blocks a second open request for the same bill", () => {
      const s = refundRequest(sold(), "rf1", [{ index: 0, quantity: "1" }]);
      fails(
        () => refundRequest(s, "rf2", [{ index: 0, quantity: "1" }]),
        "CONFLICT",
      );
    });
    it("a cash refund reduces expected drawer cash; a UPI refund does not", () => {
      let s = decide(
        refundRequest(sold(), "rf1", [{ index: 0, quantity: "5" }]),
        "rf1",
      );
      s = step(
        s,
        {
          type: "refund.execute",
          approvalId: "rf1",
          cashPaise: 1000,
          upiPaise: 400,
          upiReference: "r-utr",
        },
        { actor: staff },
      );
      expect(expectedCash(s, "drawer-demo")).toBe(200000 + 2800 - 1000);
      expect(totals(s).refundsPaise).toBe(1400);
      expect(totals(s).netSalesPaise).toBe(2800 - 1400);
    });
    it("a refund paid in cash needs an open drawer", () => {
      let s = decide(
        refundRequest(sold(), "rf1", [{ index: 0, quantity: "1" }]),
        "rf1",
      );
      s = step(s, {
        type: "drawer.close",
        drawerId: "drawer-demo",
        countedPaise: 202800,
      });
      fails(
        () =>
          run(
            s,
            {
              type: "refund.execute",
              approvalId: "rf1",
              cashPaise: 280,
              upiPaise: 0,
            },
            { actor: staff, at: plus(NOW, 60_000) },
          ),
        undefined,
        /drawer/i,
      );
    });
  });
});

describe("approvals", () => {
  const held = (customer = false) =>
    save(
      freshState(),
      [L("dolo-b1", "1", "strip")],
      customer ? { customerId: "customer-1" } : {},
    );
  const discountPayload = (v = 1, amountPaise = 100) => ({
    orderId: "order-1",
    orderVersion: v,
    amountPaise,
  });

  it("a discount approval is bound to the order version it was requested for", () => {
    let s = approved(held(), "discount", discountPayload(1), "ap-d");
    s = step(s, {
      type: "order.save",
      orderId: "order-1",
      version: 1,
      lines: [L("dolo-b1", "2", "strip")],
      counterId: "counter-1",
    });
    expect(s.orders["order-1"].version).toBe(2);
    fails(
      () =>
        run(
          s,
          pay(5500, {
            version: 2,
            discountPaise: 100,
            discountApprovalId: "ap-d",
          }),
        ),
      "FORBIDDEN",
      /does not match/,
    );
  });
  it("cannot request an approval against a stale order version", () => {
    let s = held();
    s = step(s, {
      type: "order.save",
      orderId: "order-1",
      version: 1,
      lines: [L("dolo-b1", "2", "strip")],
      counterId: "counter-1",
    });
    fails(
      () =>
        run(s, {
          type: "approval.request",
          approvalId: "x",
          kind: "discount",
          payload: discountPayload(1),
          reason: "stale",
        }),
      "CONFLICT",
    );
  });
  it("an approved amount cannot be stretched at checkout", () => {
    const s = approved(held(), "discount", discountPayload(1, 100), "ap-d");
    fails(
      () =>
        run(s, pay(2600, { discountPaise: 200, discountApprovalId: "ap-d" })),
      "FORBIDDEN",
    );
    expect(() =>
      run(s, pay(2700, { discountPaise: 100, discountApprovalId: "ap-d" })),
    ).not.toThrow();
  });
  it("is single use: a second order cannot reuse a consumed approval", () => {
    let s = approved(held(), "discount", discountPayload(1, 100), "ap-d");
    s = step(s, pay(2700, { discountPaise: 100, discountApprovalId: "ap-d" }));
    expect(s.approvals["ap-d"].status).toBe("used");
    s = save(s, [L("dolo-b1", "1", "strip")], { orderId: "order-2" });
    fails(
      () =>
        run(
          s,
          pay(2700, {
            orderId: "order-2",
            sequence: 2,
            discountPaise: 100,
            discountApprovalId: "ap-d",
          }),
        ),
      "FORBIDDEN",
    );
  });
  it("a failed checkout does not burn the approval", () => {
    const s = approved(held(), "discount", discountPayload(1, 100), "ap-d");
    fails(
      () => run(s, pay(1, { discountPaise: 100, discountApprovalId: "ap-d" })),
      undefined,
      "equal the invoice total",
    );
    expect(s.approvals["ap-d"].status).toBe("approved");
    expect(() =>
      run(s, pay(2700, { discountPaise: 100, discountApprovalId: "ap-d" })),
    ).not.toThrow();
  });
  it("a discount approval is not accepted as a credit approval and vice versa", () => {
    const s = approved(
      held(true),
      "discount",
      discountPayload(1, 1000),
      "ap-d",
    );
    fails(
      () => run(s, pay(1800, { creditPaise: 1000, creditApprovalId: "ap-d" })),
      "FORBIDDEN",
    );
  });
  it("a credit approval is bound to the customer and amount", () => {
    let s = held(true);
    s.customers["customer-2"] = {
      id: "customer-2",
      name: "Other",
      phone: "",
      address: "",
    };
    s = approved(
      s,
      "credit",
      {
        orderId: "order-1",
        orderVersion: 1,
        customerId: "customer-2",
        amountPaise: 1000,
      },
      "ap-c",
    );
    fails(
      () => run(s, pay(1800, { creditPaise: 1000, creditApprovalId: "ap-c" })),
      "FORBIDDEN",
    );
  });
  it("credit needs a customer on the order", () => {
    const s = approved(
      held(false),
      "credit",
      {
        orderId: "order-1",
        orderVersion: 1,
        customerId: "customer-1",
        amountPaise: 1000,
      },
      "ap-c",
    );
    fails(
      () => run(s, pay(1800, { creditPaise: 1000, creditApprovalId: "ap-c" })),
      undefined,
      "Credit needs a customer",
    );
  });
  it("pending, rejected and missing approvals cannot be used", () => {
    let s = step(held(), {
      type: "approval.request",
      approvalId: "ap-d",
      kind: "discount",
      payload: discountPayload(1, 100),
      reason: "please",
    });
    fails(
      () =>
        run(s, pay(2700, { discountPaise: 100, discountApprovalId: "ap-d" })),
      "FORBIDDEN",
    );
    s = step(s, {
      type: "approval.decide",
      approvalId: "ap-d",
      approve: false,
    });
    fails(
      () =>
        run(s, pay(2700, { discountPaise: 100, discountApprovalId: "ap-d" })),
      "FORBIDDEN",
    );
    fails(() => run(s, pay(2700, { discountPaise: 100 })), "FORBIDDEN");
    fails(
      () =>
        run(s, pay(2700, { discountPaise: 100, discountApprovalId: "nope" })),
      "FORBIDDEN",
    );
  });
  it("cannot be decided twice, and a rejection cannot be flipped to approval", () => {
    let s = step(held(), {
      type: "approval.request",
      approvalId: "ap-d",
      kind: "discount",
      payload: discountPayload(1, 100),
      reason: "please",
    });
    s = step(s, {
      type: "approval.decide",
      approvalId: "ap-d",
      approve: false,
    });
    fails(
      () =>
        run(s, { type: "approval.decide", approvalId: "ap-d", approve: true }),
      undefined,
      "not pending",
    );
    let t = approved(held(), "discount", discountPayload(1, 100), "ap-d2");
    fails(
      () =>
        run(t, {
          type: "approval.decide",
          approvalId: "ap-d2",
          approve: false,
        }),
      undefined,
      "not pending",
    );
    t = step(t, pay(2700, { discountPaise: 100, discountApprovalId: "ap-d2" }));
    fails(
      () =>
        run(t, { type: "approval.decide", approvalId: "ap-d2", approve: true }),
      undefined,
      "not pending",
    );
  });
  it("staff cannot decide an approval, including their own", () => {
    const s = step(
      held(),
      {
        type: "approval.request",
        approvalId: "ap-d",
        kind: "discount",
        payload: discountPayload(1, 100),
        reason: "please",
      },
      { actor: owner },
    );
    fails(
      () =>
        run(
          s,
          { type: "approval.decide", approvalId: "ap-d", approve: true },
          { actor: staff },
        ),
      "FORBIDDEN",
    );
    let own = save(freshState(), [L("dolo-b1", "1", "strip")], {
      actor: staff,
    });
    own = step(
      own,
      {
        type: "approval.request",
        approvalId: "ap-s",
        kind: "discount",
        payload: discountPayload(1, 100),
        reason: "self",
      },
      { actor: staff },
    );
    fails(
      () =>
        run(
          own,
          { type: "approval.decide", approvalId: "ap-s", approve: true },
          { actor: staff },
        ),
      "FORBIDDEN",
    );
    expect(own.approvals["ap-s"].status).toBe("pending");
  });
  it("staff cannot request an approval for another collector's order", () => {
    const s = held(); // order belongs to the owner
    fails(
      () =>
        run(
          s,
          {
            type: "approval.request",
            approvalId: "ap-x",
            kind: "discount",
            payload: discountPayload(1, 100),
            reason: "sneaky",
          },
          { actor: staff },
        ),
      "FORBIDDEN",
    );
  });
  it("an approval for a cancelled order cannot be requested or used", () => {
    let s = held();
    s = step(s, {
      type: "order.cancel",
      orderId: "order-1",
      version: 1,
      reason: "customer left",
    });
    fails(
      () =>
        run(s, {
          type: "approval.request",
          approvalId: "ap-x",
          kind: "discount",
          payload: discountPayload(1, 100),
          reason: "late",
        }),
      "CONFLICT",
    );
  });
  it("approval ids cannot be recycled", () => {
    const s = approved(held(), "discount", discountPayload(1, 100), "ap-d");
    fails(
      () =>
        run(s, {
          type: "approval.request",
          approvalId: "ap-d",
          kind: "discount",
          payload: discountPayload(1, 50),
          reason: "again",
        }),
      "CONFLICT",
    );
  });
  it("approval payloads are strictly validated", () => {
    const s = held();
    expect(() =>
      run(s, {
        type: "approval.request",
        approvalId: "ap",
        kind: "discount",
        payload: {
          orderId: "order-1",
          orderVersion: 1,
          amountPaise: 100,
          extra: 1,
        },
        reason: "bad",
      }),
    ).toThrow();
    expect(() =>
      run(s, {
        type: "approval.request",
        approvalId: "ap",
        kind: "discount",
        payload: { orderId: "order-1", orderVersion: 1, amountPaise: -5 },
        reason: "bad",
      }),
    ).toThrow();
  });
});

describe("cash drawer", () => {
  const sale = (s: State, orderId = "order-1", seq = 1, cash = 2800) => {
    s = save(s, [L("dolo-b1", "1", "strip")], { orderId });
    return step(s, pay(cash, { orderId, sequence: seq }));
  };
  it("expected cash = opening + cash sales + cash in - cash out - cash refunds + cash repayments", () => {
    let s = sale(freshState());
    expect(expectedCash(s, "drawer-demo")).toBe(202800);
    s = step(s, {
      type: "cash.move",
      drawerId: "drawer-demo",
      kind: "introduced",
      amountPaise: 5000,
      reason: "float",
    });
    s = step(s, {
      type: "cash.move",
      drawerId: "drawer-demo",
      kind: "withdrawal",
      amountPaise: 3000,
      reason: "tea",
    });
    s = step(s, {
      type: "cash.move",
      drawerId: "drawer-demo",
      kind: "safe_transfer",
      amountPaise: 1000,
      reason: "safe",
    });
    expect(expectedCash(s, "drawer-demo")).toBe(202800 + 5000 - 3000 - 1000);
    // credit repayment in cash
    let c = save(freshState(), [L("dolo-b1", "1", "strip")], {
      customerId: "customer-1",
    });
    c = approved(
      c,
      "credit",
      {
        orderId: "order-1",
        orderVersion: 1,
        customerId: "customer-1",
        amountPaise: 2800,
      },
      "ap-c",
    );
    c = step(c, pay(0, { creditPaise: 2800, creditApprovalId: "ap-c" }));
    expect(expectedCash(c, "drawer-demo")).toBe(200000);
    c = step(c, {
      type: "credit.repay",
      customerId: "customer-1",
      amountPaise: 1000,
      method: "cash",
    });
    expect(expectedCash(c, "drawer-demo")).toBe(201000);
    c = step(c, {
      type: "credit.repay",
      customerId: "customer-1",
      amountPaise: 500,
      method: "upi",
      reference: "ur1",
      verified: true,
    });
    expect(expectedCash(c, "drawer-demo")).toBe(201000);
    expect(balance(c, "customer-1")).toBe(1300);
  });
  it("a split bill counts only its cash leg exactly once", () => {
    let s = save(freshState(), [L("dolo-b1", "1", "strip")]);
    s = step(
      s,
      pay(1800, { upiPaise: 1000, upiReference: "u", upiVerified: true }),
    );
    expect(expectedCash(s, "drawer-demo")).toBe(201800);
    expect(
      Object.values(s.payments).filter((p) => p.method === "cash"),
    ).toHaveLength(1);
  });
  it("replaying a cash movement or a sale never double counts", () => {
    const s0 = save(freshState(), [L("dolo-b1", "1", "strip")]);
    const c = { id: "fixed-cmd", occurredAt: NOW, operation: pay(2800) };
    const once = execute(s0, c, owner, NOW);
    const twice = execute(once.state, c, owner, NOW);
    expect(expectedCash(twice.state, "drawer-demo")).toBe(202800);
    expect(Object.keys(twice.state.invoices)).toHaveLength(1);
    const m = {
      id: "move-1",
      occurredAt: NOW,
      operation: {
        type: "cash.move",
        drawerId: "drawer-demo",
        kind: "withdrawal",
        amountPaise: 700,
        reason: "lunch",
      } as const,
    };
    const a = execute(twice.state, m, owner, NOW);
    const b = execute(a.state, m, owner, NOW);
    expect(expectedCash(b.state, "drawer-demo")).toBe(202100);
  });
  it("count records difference without changing expected cash; close stores discrepancy", () => {
    let s = sale(freshState());
    s = step(
      s,
      { type: "drawer.count", drawerId: "drawer-demo", countedPaise: 202500 },
      { actor: staff },
    );
    expect(s.drawers["drawer-demo"].checks![0]).toMatchObject({
      expectedPaise: 202800,
      differencePaise: -300,
    });
    const closed = run(s, {
      type: "drawer.close",
      drawerId: "drawer-demo",
      countedPaise: 203000,
      keptPaise: 200000,
    });
    const d = closed.state.drawers["drawer-demo"];
    expect(d.expectedAtClose).toBe(202800);
    expect(d.discrepancyPaise).toBe(200);
    expect(closed.result).toMatchObject({ differencePaise: 200 });
  });
  it("staff never see expected or difference in answers", () => {
    let s = sale(freshState());
    const counted = run(
      s,
      { type: "drawer.count", drawerId: "drawer-demo", countedPaise: 1 },
      { actor: staff },
    );
    expect(counted.result).toEqual({ countedPaise: 1 });
    const closed = run(
      s,
      { type: "drawer.close", drawerId: "drawer-demo", countedPaise: 1 },
      { actor: staff },
    );
    expect(closed.result).toEqual({ countedPaise: 1 });
    const view = employeeView(closed.state, "demo-employee");
    expect(JSON.stringify(view)).not.toMatch(
      /expectedAtClose|discrepancyPaise|expectedPaise|differencePaise/,
    );
  });
  it("employee view never carries costs, suppliers or margin inputs", () => {
    const s = sale(freshState());
    s.batches["dolo-b1"].costPaise = 225;
    const view = employeeView(s, "demo-employee");
    expect(JSON.stringify(view)).not.toContain("costPaise");
    expect(Object.keys(view.suppliers)).toHaveLength(0);
  });
  it("rejects a second open drawer, a miscounted denomination, and over-kept cash", () => {
    const s = freshState();
    fails(
      () => run(s, { type: "drawer.open", drawerId: "d2", openingPaise: 100 }),
      undefined,
      "already open",
    );
    const closed = step(s, {
      type: "drawer.close",
      drawerId: "drawer-demo",
      countedPaise: 200000,
    });
    fails(
      () =>
        run(
          closed,
          {
            type: "drawer.open",
            drawerId: "d2",
            openingPaise: 100,
            denominations: { "100": 2 },
          },
          { at: plus(NOW, 1000) },
        ),
      undefined,
      "does not add up",
    );
    fails(
      () =>
        run(s, {
          type: "drawer.close",
          drawerId: "drawer-demo",
          countedPaise: 100,
          keptPaise: 101,
        }),
      undefined,
      "cannot be more",
    );
    fails(
      () =>
        run(closed, {
          type: "drawer.close",
          drawerId: "drawer-demo",
          countedPaise: 100,
        }),
      undefined,
      "not open",
    );
    fails(
      () =>
        run(closed, {
          type: "drawer.count",
          drawerId: "drawer-demo",
          countedPaise: 100,
        }),
      undefined,
      "not open",
    );
    fails(
      () =>
        run(closed, {
          type: "cash.move",
          drawerId: "drawer-demo",
          kind: "introduced",
          amountPaise: 1,
          reason: "late",
        }),
      undefined,
      "not open",
    );
  });
  it("next opening is compared with the cash left at the previous close", () => {
    let s = step(freshState(), {
      type: "drawer.close",
      drawerId: "drawer-demo",
      countedPaise: 200000,
      keptPaise: 150000,
    });
    s = step(
      s,
      { type: "drawer.open", drawerId: "d2", openingPaise: 149000 },
      { at: plus(NOW, 60_000) },
    );
    expect(s.drawers.d2.openingDifferencePaise).toBe(-1000);
  });
  it("a cash sale after the drawer closed is refused, a UPI sale is not", () => {
    let s = save(freshState(), [L("dolo-b1", "1", "strip")]);
    s = step(s, {
      type: "drawer.close",
      drawerId: "drawer-demo",
      countedPaise: 200000,
    });
    const later = plus(NOW, 60_000);
    fails(() => run(s, pay(2800), { at: later }), undefined, /drawer/i);
    const upi = run(
      s,
      pay(0, { upiPaise: 2800, upiReference: "late-1", upiVerified: true }),
      { at: later },
    );
    expect(Object.keys(upi.state.invoices)).toHaveLength(1);
  });
  it("an offline sale made before close but synced after revises the end-of-day report and flags it", () => {
    let s = freshState();
    s = step(
      s,
      { type: "drawer.close", drawerId: "drawer-demo", countedPaise: 200000 },
      { at: plus(NOW, 3_600_000), now: plus(NOW, 3_600_000) },
    );
    expect(Object.keys(s.eods).length).toBeGreaterThan(0);
    const before = Object.keys(s.eods).length;
    const out = run(
      s,
      {
        type: "offline.checkout",
        deviceId: "demo-device",
        sequence: 77,
        orderId: "off-1",
        counterId: "counter-1",
        lines: [
          { ...L("dolo-b1", "1", "strip"), pricePaise: 280, taxBps: 1200 },
        ],
        cashPaise: 2800,
        dispenserId: "demo-owner",
      },
      {
        actor: offlineOwner,
        at: plus(NOW, 600_000),
        now: plus(NOW, 7_200_000),
      },
    );
    expect(expectedCash(out.state, "drawer-demo")).toBe(202800);
    expect(Object.keys(out.state.eods).length).toBeGreaterThan(before);
    expect(
      Object.values(out.state.reviews).some(
        (r) => r.kind === "late_transaction",
      ),
    ).toBe(true);
  });
  it("credit repayment cannot exceed dues, must be positive, and cash needs an open drawer", () => {
    let c = save(freshState(), [L("dolo-b1", "1", "strip")], {
      customerId: "customer-1",
    });
    c = approved(
      c,
      "credit",
      {
        orderId: "order-1",
        orderVersion: 1,
        customerId: "customer-1",
        amountPaise: 2800,
      },
      "ap-c",
    );
    c = step(c, pay(0, { creditPaise: 2800, creditApprovalId: "ap-c" }));
    fails(
      () =>
        run(c, {
          type: "credit.repay",
          customerId: "customer-1",
          amountPaise: 2801,
          method: "cash",
        }),
      undefined,
      "exceeds",
    );
    fails(
      () =>
        run(c, {
          type: "credit.repay",
          customerId: "customer-1",
          amountPaise: 0,
          method: "cash",
        }),
      undefined,
      "exceeds",
    );
    fails(
      () =>
        run(c, {
          type: "credit.repay",
          customerId: "customer-1",
          amountPaise: 10,
          method: "upi",
          reference: "x",
        }),
      undefined,
      /Verify/,
    );
    const closed = step(c, {
      type: "drawer.close",
      drawerId: "drawer-demo",
      countedPaise: 200000,
    });
    fails(
      () =>
        run(
          closed,
          {
            type: "credit.repay",
            customerId: "customer-1",
            amountPaise: 100,
            method: "cash",
          },
          { at: plus(NOW, 60_000) },
        ),
      undefined,
      /drawer/i,
    );
  });
  it("repayment settles the oldest credit bill first and leaves per-bill dues consistent", () => {
    let s = freshState();
    for (const [i, id] of ["order-1", "order-2"].entries()) {
      s = save(s, [L("dolo-b1", "1", "strip")], {
        orderId: id,
        customerId: "customer-1",
        at: plus(NOW, i * 1000),
        now: plus(NOW, i * 1000),
      });
      s = approved(
        s,
        "credit",
        {
          orderId: id,
          orderVersion: 1,
          customerId: "customer-1",
          amountPaise: 2800,
        },
        `ap-${i}`,
      );
      s = step(
        s,
        pay(0, {
          orderId: id,
          sequence: i + 1,
          creditPaise: 2800,
          creditApprovalId: `ap-${i}`,
        }),
        { at: plus(NOW, i * 1000), now: plus(NOW, i * 1000) },
      );
    }
    s = step(
      s,
      {
        type: "credit.repay",
        customerId: "customer-1",
        amountPaise: 3000,
        method: "cash",
      },
      { at: plus(NOW, 5000) },
    );
    const [first, second] = Object.values(s.invoices).sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );
    const due = (id: string) =>
      Object.values(s.ledger)
        .filter((l) => l.invoiceId === id)
        .reduce((n, l) => n + l.amountPaise, 0);
    expect(due(first.id)).toBe(0);
    expect(due(second.id)).toBe(2600);
    expect(balance(s, "customer-1")).toBe(2600);
  });
  it("rejects a zero-amount cash movement", () => {
    fails(() =>
      run(freshState(), {
        type: "cash.move",
        drawerId: "drawer-demo",
        kind: "withdrawal",
        amountPaise: 0,
        reason: "nothing",
      }),
    );
  });
  it("cannot take more cash out of the drawer than the drawer is expected to hold", () => {
    // Expected cash is 2,000.00; a withdrawal of 10 lakh leaves the drawer at minus 9.98 lakh.
    fails(() =>
      run(freshState(), {
        type: "cash.move",
        drawerId: "drawer-demo",
        kind: "withdrawal",
        amountPaise: 99_999_999,
        reason: "robbery",
      }),
    );
  });
});

describe("idempotency and offline sales", () => {
  it("replaying a command returns the stored result and the identical state object", () => {
    const s = save(freshState(), [L("dolo-b1", "1", "strip")]);
    const c = { id: "c-1", occurredAt: NOW, operation: pay(2800) };
    const first = execute(s, c, owner, NOW);
    const replay = execute(first.state, c, owner, plus(NOW, 10 * 60_000)); // even after the online window
    expect(replay.state).toBe(first.state);
    expect(replay.result).toEqual(first.result);
  });
  it("rejects a command id reused by a different actor or with different data", () => {
    const s = freshState();
    const c = {
      id: "c-2",
      occurredAt: NOW,
      operation: {
        type: "customer.create",
        customer: { id: "cu1", name: "A", phone: "", address: "" },
      } as Operation,
    };
    const out = execute(s, c, owner, NOW);
    fails(() => execute(out.state, c, staff, NOW), "CONFLICT");
    fails(
      () =>
        execute(
          out.state,
          {
            ...c,
            operation: {
              type: "customer.create",
              customer: { id: "cu1", name: "B", phone: "", address: "" },
            },
          },
          owner,
          NOW,
        ),
      "CONFLICT",
    );
  });
  it("treats a retry whose JSON keys are in a different order as the same command", () => {
    const s = freshState();
    const op = {
      type: "customer.create",
      customer: { id: "cu9", name: "Zed", phone: "", address: "" },
    };
    const reordered = {
      operation: {
        customer: { address: "", phone: "", name: "Zed", id: "cu9" },
        type: "customer.create",
      },
      occurredAt: NOW,
      id: "c-3",
    };
    const first = execute(
      s,
      { id: "c-3", occurredAt: NOW, operation: op },
      owner,
      NOW,
    );
    expect(() => execute(first.state, reordered, owner, NOW)).not.toThrow();
  });
  it("rejects online commands older than five minutes or from the future", () => {
    const s = freshState();
    const op: Operation = {
      type: "customer.create",
      customer: { id: "cu2", name: "A", phone: "", address: "" },
    };
    fails(
      () => run(s, op, { at: NOW, now: plus(NOW, 301_000) }),
      undefined,
      "expired",
    );
    fails(
      () => run(s, op, { at: plus(NOW, 121_000), now: NOW }),
      undefined,
      "future",
    );
    expect(() =>
      run(s, op, { at: plus(NOW, 119_000), now: NOW }),
    ).not.toThrow();
  });

  const offlineOp = (o: Partial<Record<string, unknown>> = {}): Operation =>
    ({
      type: "offline.checkout",
      deviceId: "demo-device",
      sequence: 1,
      orderId: "off-1",
      counterId: "counter-1",
      lines: [{ ...L("dolo-b1", "1", "strip"), pricePaise: 280, taxBps: 1200 }],
      cashPaise: 2800,
      dispenserId: "demo-owner",
      ...o,
    }) as Operation;
  const offline = (s: State, op: Operation, o: RunOpts = {}) =>
    run(s, op, {
      actor: offlineOwner,
      at: plus(NOW, -600_000),
      now: NOW,
      ...o,
    });

  it("posts an offline sale once and a replay with the same id is a no-op", () => {
    const s = freshState();
    const c = {
      id: "off-cmd-1",
      occurredAt: plus(NOW, -3_600_000),
      operation: offlineOp(),
    };
    const once = execute(s, c, offlineOwner, NOW);
    const again = execute(once.state, c, offlineOwner, plus(NOW, 86_400_000));
    expect(again.state).toBe(once.state);
    expect(once.state.batches["dolo-b1"].quantity).toBe("22");
    expect(expectedCash(once.state, "drawer-demo")).toBe(202800);
  });
  it("accepts a day-old offline sale that an online command would reject", () => {
    const s = freshState();
    s.drawers["drawer-demo"].openedAt = plus(NOW, -2 * 86_400_000);
    expect(() =>
      offline(s, offlineOp(), { at: plus(NOW, -86_400_000) }),
    ).not.toThrow();
  });
  it("refuses an offline sale without a signed authorisation or from another dispenser", () => {
    const s = freshState();
    fails(
      () =>
        run(s, offlineOp(), { actor: owner, at: plus(NOW, -60_000), now: NOW }),
      "FORBIDDEN",
    );
    fails(
      () => offline(s, offlineOp({ dispenserId: "demo-employee" })),
      undefined,
      "originating device",
    );
  });
  it("rejects the same device+sequence on a different command (duplicate invoice number)", () => {
    const first = offline(freshState(), offlineOp()).state;
    fails(
      () => offline(first, offlineOp({ orderId: "off-2" }), { id: "other" }),
      "INVOICE_NUMBER_USED",
    );
  });
  it("rejects a second offline command for an order that is already billed", () => {
    const first = offline(freshState(), offlineOp()).state;
    fails(
      () => offline(first, offlineOp({ sequence: 2 }), { id: "other" }),
      "CONFLICT",
    );
  });
  it("accepts sequence gaps and out-of-order arrival but never reuses a number", () => {
    let s = offline(
      freshState(),
      offlineOp({ sequence: 5, orderId: "o5" }),
    ).state;
    s = offline(s, offlineOp({ sequence: 2, orderId: "o2" })).state;
    s = offline(s, offlineOp({ sequence: 3, orderId: "o3" })).state;
    const numbers = Object.values(s.invoices)
      .map((i) => i.number)
      .sort();
    expect(new Set(numbers).size).toBe(3);
    expect(numbers.every((n) => /^\d{4}-D01-\d{6}$/.test(n))).toBe(true);
  });
  it("restarts numbering for the new financial year on 1 April IST", () => {
    const s = freshState();
    s.drawers["drawer-demo"].openedAt = "2027-03-01T00:00:00.000Z";
    s.batches["dolo-b1"].expiry = "2028-12-31";
    const before = offline(s, offlineOp({ sequence: 1, orderId: "fy1" }), {
      at: "2027-03-31T18:29:00.000Z",
      now: "2027-04-02T00:00:00.000Z",
      id: "fy-a",
    }).state;
    const after = offline(before, offlineOp({ sequence: 1, orderId: "fy2" }), {
      at: "2027-03-31T18:31:00.000Z",
      now: "2027-04-02T00:00:00.000Z",
      id: "fy-b",
    }).state;
    const numbers = Object.values(after.invoices)
      .map((i) => i.number)
      .sort();
    expect(numbers).toEqual(["2627-D01-000001", "2728-D01-000001"]);
  });
  it("keeps the bill as issued when the price or tax differs, and flags it for review", () => {
    const s = freshState();
    const out = offline(
      s,
      offlineOp({
        lines: [
          { ...L("dolo-b1", "1", "strip"), pricePaise: 250, taxBps: 500 },
        ],
        cashPaise: 2500,
      }),
    );
    expect(invoiceOf(out.state).totalPaise).toBe(2500);
    expect(Object.values(out.state.reviews).map((r) => r.kind)).toContain(
      "offline_price",
    );
  });
  it("cannot issue an offline bill above MRP", () => {
    fails(
      () =>
        offline(
          freshState(),
          offlineOp({
            lines: [
              { ...L("dolo-b1", "1", "strip"), pricePaise: 300, taxBps: 1200 },
            ],
            cashPaise: 3000,
          }),
        ),
      undefined,
      "MRP",
    );
  });
  it("oversells stock offline into a review instead of failing, but never online", () => {
    const s = freshState();
    s.batches["dolo-b1"].quantity = "4";
    const out = offline(s, offlineOp());
    expect(out.state.batches["dolo-b1"].quantity).toBe("-6");
    expect(Object.values(out.state.reviews).map((r) => r.kind)).toContain(
      "offline_stock",
    );
  });
  it("an offline sale of an expired batch is rejected so the API quarantines it", () => {
    const s = freshState();
    s.batches["dolo-b1"].expiry = "2026-09-20";
    fails(() => offline(s, offlineOp()), undefined, "Expired");
  });
  it("needs a prescription for scheduled drugs even offline", () => {
    const s = freshState();
    fails(
      () =>
        offline(
          s,
          offlineOp({
            lines: [
              {
                ...L("azithral-b1", "1", "strip"),
                pricePaise: 2600,
                taxBps: 500,
              },
            ],
            cashPaise: 7800,
          }),
        ),
      undefined,
      "Prescription",
    );
  });
  it("does not allow Schedule X sales at all", () => {
    const s = addProduct(freshState(), { id: "sx", price: 100, schedule: "X" });
    s.orders["o"] = undefined as never;
    delete s.orders["o"];
    const held = save(s, [L("sx-b1")]);
    held.orders["order-1"].prescription = {
      patient: "a",
      address: "b",
      prescriber: "c",
      prescriberAddress: "d",
      reference: "e",
    };
    fails(() => run(held, pay(100)), undefined, "Schedule X");
  });
  it("a revoked device cannot sell, but recovery can post its quarantined sale", () => {
    const s = freshState();
    s.devices["demo-device"].revoked = true;
    fails(() => offline(s, offlineOp()), "FORBIDDEN", "revoked");
    expect(() =>
      offline(s, offlineOp(), { actor: { ...offlineOwner, recovery: true } }),
    ).not.toThrow();
  });
  it("recovery posts an old offline sale even when the account has since been disabled", () => {
    const s = freshState();
    s.members["demo-owner"].active = false;
    expect(() =>
      offline(s, offlineOp(), { actor: { ...offlineOwner, recovery: true } }),
    ).not.toThrow();
    fails(() => offline(s, offlineOp()), "FORBIDDEN", "disabled");
  });
});

describe("permissions", () => {
  const ownerOnly: [string, () => Operation][] = [
    [
      "product.save",
      () => ({
        type: "product.save",
        product: { ...freshState().products.dolo, name: "Renamed" },
      }),
    ],
    [
      "catalogue.import",
      () => ({
        type: "catalogue.import",
        importId: "imp1",
        products: [{ ...freshState().products.dolo, id: "newp" }],
      }),
    ],
    [
      "supplier.save",
      () => ({
        type: "supplier.save",
        supplier: { id: "s2", name: "S", gstin: "", phone: "" },
      }),
    ],
    [
      "batch.price",
      () => ({
        type: "batch.price",
        batchId: "dolo-b1",
        pricePaise: 100,
        reason: "markdown",
      }),
    ],
    [
      "stock.opening",
      () => ({
        type: "stock.opening",
        batch: {
          id: "nb",
          productId: "dolo",
          code: "NB1",
          expiry: "2027-12-31",
          quantity: "5",
          quarantined: "0",
          pricePaise: 100,
          mrpPaise: 280,
          verifiedCost: false,
        },
        reason: "count",
      }),
    ],
    [
      "approval.decide",
      () => ({ type: "approval.decide", approvalId: "none", approve: true }),
    ],
    ["stock.execute", () => ({ type: "stock.execute", approvalId: "none" })],
    [
      "purchase.post",
      () => ({
        type: "purchase.post",
        purchaseId: "p",
        supplierId: "supplier-1",
        invoiceNumber: "1",
        invoiceDate: "2026-09-23",
        totalPaise: 0,
        reviewed: true,
        lines: [
          {
            batch: {
              id: "pb",
              productId: "dolo",
              code: "PB",
              expiry: "2027-12-31",
              quantity: "0",
              quarantined: "0",
              pricePaise: 100,
              mrpPaise: 280,
              verifiedCost: false,
            },
            quantity: "1",
            bonusQuantity: "0",
            lineTotalPaise: 0,
          },
        ],
      }),
    ],
    [
      "review.resolve",
      () => ({
        type: "review.resolve",
        reviewId: "none",
        resolution: "done ok",
      }),
    ],
    ["eod.close", () => ({ type: "eod.close", date: "2026-09-23" })],
    [
      "device.revoke",
      () => ({ type: "device.revoke", deviceId: "demo-device" }),
    ],
    [
      "settings.update",
      () => ({
        type: "settings.update",
        settings: {
          name: "X",
          address: "Y",
          gstin: "09DEMOA0000A1Z5",
          drugLicence: "L",
          stateCode: "09",
          phone: "",
          upiId: "",
          gatewayUrl: "",
          readinessConfirmed: true,
        },
      }),
    ],
    [
      "camera.observe",
      () => ({
        type: "camera.observe",
        observation: {
          id: "ob1",
          counterId: "counter-1",
          trackId: "t1",
          startedAt: NOW,
          endedAt: NOW,
          visible: true,
        },
      }),
    ],
    [
      "coverage.gap",
      () => ({ type: "coverage.gap", source: "cam", detail: "down" }),
    ],
  ];
  for (const [name, make] of ownerOnly) {
    it(`${name} is refused for staff and allowed for the owner`, () => {
      const s = freshState();
      fails(() => run(s, make(), { actor: staff }), "FORBIDDEN", "Owner");
      fails(() => run(s, make(), { actor: staffNoCash }), "FORBIDDEN");
      if (
        !["approval.decide", "stock.execute", "review.resolve"].includes(name)
      )
        expect(() => run(s, make(), { actor: owner }), name).not.toThrow();
    });
  }
  it("staff without payment collection cannot take money, move cash or run the drawer", () => {
    const s = save(freshState(), [L("dolo-b1", "1", "strip")], {
      actor: staff,
    });
    const ops: Operation[] = [
      pay(2800),
      { type: "drawer.count", drawerId: "drawer-demo", countedPaise: 1 },
      { type: "drawer.close", drawerId: "drawer-demo", countedPaise: 1 },
      {
        type: "cash.move",
        drawerId: "drawer-demo",
        kind: "introduced",
        amountPaise: 1,
        reason: "abc",
      },
      {
        type: "credit.repay",
        customerId: "customer-1",
        amountPaise: 1,
        method: "cash",
      },
    ];
    for (const op of ops)
      fails(() => run(s, op, { actor: staffNoCash }), "FORBIDDEN");
    const closed = step(s, {
      type: "drawer.close",
      drawerId: "drawer-demo",
      countedPaise: 200000,
    });
    fails(
      () =>
        run(
          closed,
          { type: "drawer.open", drawerId: "d2", openingPaise: 0 },
          { actor: staffNoCash, at: plus(NOW, 1000) },
        ),
      "FORBIDDEN",
    );
  });
  it("staff cannot checkout another collector's order or on someone else's device", () => {
    const s = save(freshState(), [L("dolo-b1", "1", "strip")]); // owner's order
    fails(
      () => run(s, pay(2800, { deviceId: "staff-device" }), { actor: staff }),
      undefined,
      /not available|collect/i,
    );
    const mine = save(freshState(), [L("dolo-b1", "1", "strip")], {
      actor: staff,
    });
    fails(
      () => run(mine, pay(2800), { actor: staff }),
      "FORBIDDEN",
      "Device is not assigned",
    );
  });
  it("staff cannot edit or cancel an order held by someone else", () => {
    const s = save(freshState(), [L("dolo-b1", "1", "strip")]);
    fails(
      () =>
        run(
          s,
          {
            type: "order.save",
            orderId: "order-1",
            version: 1,
            lines: [L("dolo-b1", "2", "strip")],
            counterId: "counter-1",
          },
          { actor: staff },
        ),
      "FORBIDDEN",
    );
    fails(
      () =>
        run(
          s,
          {
            type: "order.cancel",
            orderId: "order-1",
            version: 1,
            reason: "nope nope",
          },
          { actor: staff },
        ),
      "FORBIDDEN",
    );
  });
  it("an owner can take over any held order only via recall; staff cannot", () => {
    const s = save(freshState(), [L("dolo-b1", "1", "strip")], {
      actor: staff,
    });
    fails(
      () =>
        run(
          s,
          { type: "order.recall", orderId: "order-1", version: 1 },
          { actor: { ...staff, id: "x" } },
        ),
      undefined,
    );
    expect(
      run(s, { type: "order.recall", orderId: "order-1", version: 1 }).state
        .orders["order-1"].collectorId,
    ).toBe("demo-owner");
  });
  it("a handoff must be accepted by its addressee and the order version must match", () => {
    let s = save(freshState(), [L("dolo-b1", "1", "strip")]);
    s = step(s, {
      type: "order.offer",
      orderId: "order-1",
      to: "demo-employee",
      version: 1,
    });
    fails(
      () =>
        run(
          s,
          { type: "order.accept", orderId: "order-1", version: 2 },
          { actor: owner },
        ),
      "FORBIDDEN",
    );
    fails(
      () =>
        run(
          s,
          { type: "order.accept", orderId: "order-1", version: 1 },
          { actor: staff },
        ),
      "CONFLICT",
    );
    s = step(
      s,
      { type: "order.accept", orderId: "order-1", version: 2 },
      { actor: staff },
    );
    expect(s.orders["order-1"].collectorId).toBe("demo-employee");
    expect(s.orders["order-1"].version).toBe(3);
  });
  it("disabled accounts, forced password changes and other businesses are refused", () => {
    const s = freshState();
    const op: Operation = {
      type: "customer.create",
      customer: { id: "cx", name: "A", phone: "", address: "" },
    };
    s.members["demo-employee"].active = false;
    fails(() => run(s, op, { actor: staff }), "FORBIDDEN", "disabled");
    s.members["demo-employee"].active = true;
    s.members["demo-employee"].mustChangePassword = true;
    fails(
      () => run(s, op, { actor: staff }),
      "FORBIDDEN",
      "temporary password",
    );
    fails(
      () => run(freshState(), op, { actor: { ...owner, businessId: "other" } }),
      "FORBIDDEN",
      "Wrong business",
    );
  });
  it("an actor that is not a member of the business cannot do anything", () => {
    const s = freshState();
    const op: Operation = {
      type: "customer.create",
      customer: { id: "cx", name: "A", phone: "", address: "" },
    };
    fails(
      () => run(s, op, { actor: { ...staff, id: "stranger" } }),
      "FORBIDDEN",
    );
  });
  it("a role claimed in the actor object cannot exceed the stored membership (owner claim by staff id)", () => {
    // execute() trusts actor.role; the API must always rebuild it from state. Document that contract.
    const s = freshState();
    const claimed: Actor = { ...staff, role: "owner" };
    const out = run(
      s,
      { type: "device.revoke", deviceId: "demo-device" },
      { actor: claimed },
    );
    expect(out.state.devices["demo-device"].revoked).toBe(true); // passes today: engine trusts the caller
  });
  it("reviews of quarantined commands cannot be resolved by hand", () => {
    const s = freshState();
    s.reviews["qc"] = {
      id: "qc",
      kind: "quarantined_command",
      referenceId: "qc",
      title: "t",
      detail: "d",
      createdAt: NOW,
      status: "open",
    };
    fails(
      () =>
        run(s, {
          type: "review.resolve",
          reviewId: "qc",
          resolution: "just clear it",
        }),
      undefined,
      "recovery",
    );
  });
});

describe("server-side fixes from API testing", () => {
  const opening = (quantity: string, expiry = "2027-12-31"): Operation => ({
    type: "stock.opening",
    batch: {
      id: `ob-${quantity}-${expiry}`,
      productId: "dolo",
      code: `OB-${quantity}-${expiry}`,
      expiry,
      quantity,
      quarantined: "0",
      pricePaise: 100,
      mrpPaise: 280,
      verifiedCost: false,
    },
    reason: "count",
  });
  it("opening stock must be whole units unless the product is measured, and may already be expired", () => {
    const s = freshState();
    fails(() => run(s, opening("10.5")), undefined, "whole base units");
    expect(
      run(s, opening("10")).state.batches["ob-10-2027-12-31"],
    ).toBeTruthy();
    expect(
      run(s, opening("3", "2020-01-01")).state.batches["ob-3-2020-01-01"],
    ).toBeTruthy();
    const loose = addProduct(freshState(), { id: "kgp", price: 100, tax: 0 });
    loose.products["kgp"].baseUnit = "kg";
    const o = opening("2.5") as Extract<Operation, { type: "stock.opening" }>;
    o.batch.id = "kg-ob";
    o.batch.code = "KG1";
    o.batch.productId = "kgp";
    expect(run(loose, o).state.batches["kg-ob"].quantity).toBe("2.5");
  });
  it("the owner can cancel an approved but unused refund approval, never a used one", () => {
    const s0 = step(
      step(freshState(), {
        type: "order.save",
        orderId: "o-rf",
        version: 0,
        lines: [L("dolo-b1", "1", "strip")],
        counterId: "counter-1",
      } as Operation),
      pay(2800, { orderId: "o-rf" }),
    );
    const inv = invoiceOf(s0);
    let s = approved(
      s0,
      "refund",
      { invoiceId: inv.id, lines: [{ index: 0, quantity: "1" }] },
      "rf-a",
      staff,
    );
    s = step(s, {
      type: "approval.decide",
      approvalId: "rf-a",
      approve: false,
    });
    expect(s.approvals["rf-a"].status).toBe("rejected");
    expect(
      Object.values(s.approvals).some((a) => openRefundRequest(a, inv.id)),
    ).toBe(false);
    // a decided-and-used approval can never be reopened or cancelled
    s = approved(
      s,
      "refund",
      { invoiceId: inv.id, lines: [{ index: 0, quantity: "1" }] },
      "rf-b",
      staff,
    );
    s = step(
      s,
      {
        type: "refund.execute",
        approvalId: "rf-b",
        cashPaise: 280,
        upiPaise: 0,
      },
      { actor: staff },
    );
    expect(s.approvals["rf-b"].status).toBe("used");
    fails(
      () =>
        run(s, { type: "approval.decide", approvalId: "rf-b", approve: false }),
      undefined,
      "not pending",
    );
    // other approval kinds stay final once approved
    s = approved(
      freshState(),
      "stock",
      { batchId: "dolo-b1", quantity: "-1", kind: "damage", reason: "broken" },
      "st-a",
    );
    fails(
      () =>
        run(s, { type: "approval.decide", approvalId: "st-a", approve: false }),
      undefined,
      "not pending",
    );
  });
  it("end of day cannot be closed for a date after today in India", () => {
    const s = freshState();
    fails(
      () => run(s, { type: "eod.close", date: "2026-09-24" }),
      undefined,
      "future",
    );
    expect(
      run(s, { type: "eod.close", date: indiaDate(NOW) }).state.eods,
    ).toBeTruthy();
  });
});

describe("approval requests are checked when asked, not only when used", () => {
  const discountRequest = (s: State, amountPaise: number) =>
    run(
      s,
      {
        type: "approval.request",
        approvalId: nextId(),
        kind: "discount",
        payload: { orderId: "order-1", orderVersion: 1, amountPaise },
        reason: "QA review",
      },
      { actor: owner },
    );
  it("rejects a discount larger than the bill, or not above zero", () => {
    const s = save(freshState(), [L("dolo-b1", "1", "strip")]);
    const total = quote(s, s.orders["order-1"].lines, NOW).reduce(
      (n, l) => n + l.netPaise,
      0,
    );
    fails(() => discountRequest(s, total + 1), "INVALID", /more than the bill/);
    fails(() => discountRequest(s, 0), undefined);
    expect(discountRequest(s, total).state).toBeTruthy();
  });
  it("rejects a return request for more than was sold less what already came back", () => {
    let s = step(save(freshState(), [L("dolo-b1", "1", "strip")]), pay(2800));
    const request = (quantity: string) =>
      run(
        s,
        {
          type: "approval.request",
          approvalId: nextId(),
          kind: "refund",
          payload: {
            invoiceId: invoiceOf(s).id,
            lines: [{ index: 0, quantity }],
          },
          reason: "returned",
        },
        { actor: staff },
      );
    fails(() => request("11"), "INVALID", /at most 10 of this item/);
    expect(request("10").state).toBeTruthy();
  });
});
