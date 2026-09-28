import { confirmEodSynchronisation } from "../src";
import { describe, it, expect } from "vitest";
import {
  demoState,
  execute,
  quote,
  totals,
  balance,
  expectedCash,
  employeeView,
  fiscalYear,
  receiptHtml,
  receiptPage,
  type State,
  type Command,
  type Operation,
  type Actor,
  type Invoice,
  refundQuote,
  returnable,
  returnBaseQuantity,
  dayReport,
  dayReportHtml,
  differenceText,
} from "../src";
const now = "2026-09-23T09:00:00.000Z";
const owner: Actor = {
  id: "demo-owner",
  role: "owner",
  businessId: "pilot-pharmacy",
  canCollect: true,
};
const employee: Actor = {
  id: "demo-employee",
  role: "employee",
  businessId: "pilot-pharmacy",
  canCollect: true,
};
let n = 0;
const cmd = (operation: Operation, at = now): Command => ({
  id: `cmd-${++n}`,
  occurredAt: at,
  operation,
});
const apply = (s: State, operation: Operation, a = owner) =>
  execute(s, cmd(operation), a, now).state;
const line = {
  batchId: "dolo-b1",
  quantity: "1",
  unit: "strip",
  confirmed: true,
};
function order(
  s = demoState(undefined, undefined, undefined, now),
  id = "order-1",
) {
  return apply(s, {
    type: "order.save",
    orderId: id,
    version: 0,
    lines: [line],
    counterId: "counter-1",
  });
}
const checkout = (extra: Record<string, unknown> = {}): Operation =>
  ({
    type: "checkout",
    orderId: "order-1",
    version: 1,
    deviceId: "demo-device",
    sequence: 1,
    cashPaise: 2800,
    upiPaise: 0,
    creditPaise: 0,
    discountPaise: 0,
    ...extra,
  }) as Operation;
function approve(
  s: State,
  kind: "credit" | "discount" | "refund" | "stock",
  payload: Record<string, unknown>,
  id = "approval-1",
) {
  s = apply(s, {
    type: "approval.request",
    approvalId: id,
    kind,
    payload,
    reason: "Reviewed request",
  });
  return apply(s, { type: "approval.decide", approvalId: id, approve: true });
}
describe("retail ledger", () => {
  it("atomically posts invoice, stock, cash and immutable line snapshot", () => {
    const before = order();
    const after = apply(before, checkout());
    expect(before.batches["dolo-b1"].quantity).toBe("32");
    expect(after.batches["dolo-b1"].quantity).toBe("22");
    expect(Object.values(after.invoices)).toHaveLength(1);
    expect(expectedCash(after, "drawer-demo")).toBe(202800);
    const i = Object.values(after.invoices)[0];
    expect(i.taxPaise).toBe(300);
    expect(i.lines[0].cgstPaise + i.lines[0].sgstPaise).toBe(300);
  });
  it("deduplicates exact retries and rejects mutated command IDs", () => {
    const s = order();
    const c = cmd(checkout());
    const once = execute(s, c, owner, now);
    expect(execute(once.state, c, owner, now).state).toBe(once.state);
    expect(() =>
      execute(
        once.state,
        { ...c, occurredAt: "2026-09-23T09:00:01.000Z" },
        owner,
        now,
      ),
    ).toThrow("reused");
  });
  it("rejects a second payment against the same order", () => {
    const s = apply(order(), checkout());
    expect(() => apply(s, checkout({ sequence: 2 }))).toThrow(
      "already completed",
    );
  });
  it("rejects another tenant", () => {
    expect(() =>
      execute(order(), cmd(checkout()), { ...owner, businessId: "other" }, now),
    ).toThrow("Wrong business");
  });
  it("rejects expired or unconfirmed batches and fractional tablets", () => {
    const s = demoState(undefined, undefined, undefined, now);
    s.batches["dolo-b1"].expiry = "2020-01-01";
    expect(() => quote(s, [line], now)).toThrow("Expired");
    s.batches["dolo-b1"].expiry = "2028-01-01";
    expect(() => quote(s, [{ ...line, confirmed: false }], now)).toThrow(
      "Confirm",
    );
    expect(() => quote(s, [{ ...line, quantity: "0.15" }], now)).toThrow(
      "whole",
    );
  });
  it("checks aggregate quantities across repeated batch lines", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s = apply(s, {
      type: "order.save",
      orderId: "order-1",
      version: 0,
      lines: [
        { ...line, quantity: "2" },
        { ...line, quantity: "2" },
      ],
      counterId: "counter-1",
    });
    expect(() => apply(s, checkout({ cashPaise: 11200 }))).toThrow(
      "Insufficient",
    );
  });
  it("does not partially mutate on a payment validation failure", () => {
    const s = order();
    expect(() => apply(s, checkout({ cashPaise: 2799 }))).toThrow("equal");
    expect(s.orders["order-1"].status).toBe("held");
    expect(Object.keys(s.invoices)).toHaveLength(0);
  });
  it("requires a prescription register for schedule H and blocks unvalidated X", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s = apply(s, {
      type: "order.save",
      orderId: "order-1",
      version: 0,
      lines: [{ ...line, batchId: "azithral-b1", unit: "tablet" }],
      counterId: "counter-1",
    });
    expect(() => apply(s, checkout({ cashPaise: 2600 }))).toThrow(
      "Prescription",
    );
  });
  it("deduplicates UPI references case-insensitively", () => {
    let s = apply(
      order(),
      checkout({
        cashPaise: 0,
        upiPaise: 2800,
        upiReference: "abc123",
        upiVerified: true,
      }),
    );
    s = order(s, "order-2");
    expect(() =>
      apply(
        s,
        checkout({
          orderId: "order-2",
          sequence: 2,
          cashPaise: 0,
          upiPaise: 2800,
          upiReference: " ABC123 ",
          upiVerified: true,
        }),
      ),
    ).toThrow("already recorded");
  });
  it("requires manual merchant confirmation for UPI", () =>
    expect(() =>
      apply(
        order(),
        checkout({ cashPaise: 0, upiPaise: 2800, upiReference: "ref" }),
      ),
    ).toThrow("Verify"));
  it("requires acknowledgement of cashier handoff and enforces versions", () => {
    let s = order();
    s.devices["employee-device"] = {
      ...s.devices["demo-device"],
      id: "employee-device",
      series: "002",
      userId: employee.id,
    };
    s = apply(s, {
      type: "order.offer",
      orderId: "order-1",
      to: employee.id,
      version: 1,
    });
    expect(() => apply(s, checkout({ version: 2 }))).toThrow("not available");
    expect(() =>
      apply(s, { type: "order.accept", orderId: "order-1", version: 2 }, owner),
    ).toThrow("not addressed");
    s = apply(
      s,
      { type: "order.accept", orderId: "order-1", version: 2 },
      employee,
    );
    s = apply(
      s,
      checkout({ version: 3, deviceId: "employee-device" }),
      employee,
    );
    const invoice = Object.values(s.invoices)[0];
    expect(invoice.dispenserId).toBe(owner.id);
    expect(invoice.collectorId).toBe(employee.id);
  });
  describe("stranded handoffs and abandoned orders", () => {
    const offered = () =>
      apply(order(), {
        type: "order.offer",
        orderId: "order-1",
        to: employee.id,
        version: 1,
      });
    const other: Actor = { ...employee, id: "demo-other" };
    it("lets the offering collector take back an unaccepted handoff", () => {
      const s = apply(offered(), {
        type: "order.recall",
        orderId: "order-1",
        version: 2,
      });
      expect(s.orders["order-1"]).toMatchObject({
        status: "held",
        collectorId: owner.id,
        version: 3,
      });
      expect(s.orders["order-1"].offeredTo).toBeUndefined();
      expect(() =>
        apply(
          s,
          { type: "order.accept", orderId: "order-1", version: 3 },
          employee,
        ),
      ).toThrow("not addressed");
      expect(apply(s, checkout({ version: 3 })).orders["order-1"].status).toBe(
        "completed",
      );
    });
    it("lets the recipient decline, returning the order to the offerer", () => {
      const s = apply(
        offered(),
        { type: "order.decline", orderId: "order-1", version: 2 },
        employee,
      );
      expect(s.orders["order-1"]).toMatchObject({
        status: "held",
        collectorId: owner.id,
      });
      expect(Object.values(s.audit).map((a) => a.action)).toContain(
        "order.decline",
      );
    });
    it("lets only the people involved, or an owner, move a handoff", () => {
      const s = offered();
      s.members[other.id] = { ...s.members[employee.id], id: other.id };
      for (const type of ["order.decline", "order.recall"] as const)
        expect(() =>
          apply(s, { type, orderId: "order-1", version: 2 }, other),
        ).toThrow(/not addressed|Only the offering/);
    });
    it("lets an owner take over an order stranded with an absent employee", () => {
      let s = offered();
      s = apply(
        s,
        { type: "order.accept", orderId: "order-1", version: 2 },
        employee,
      );
      s = apply(s, { type: "order.recall", orderId: "order-1", version: 3 });
      expect(s.orders["order-1"]).toMatchObject({
        status: "held",
        collectorId: owner.id,
        dispenserId: owner.id,
      });
      expect(
        Object.values(s.audit).find(
          (a) => a.action === "order.recall" && a.referenceId === "order-1",
        )?.detail,
      ).toBe(`from ${employee.id}`);
    });
    it("cancels an unbilled held order with a recorded reason and blocks billing it", () => {
      const s = apply(order(), {
        type: "order.cancel",
        orderId: "order-1",
        version: 1,
        reason: "Customer left without medicines",
      });
      expect(s.orders["order-1"]).toMatchObject({
        status: "cancelled",
        cancelReason: "Customer left without medicines",
      });
      expect(s.batches["dolo-b1"].quantity).toBe(
        order().batches["dolo-b1"].quantity,
      );
      expect(() => apply(s, checkout({ version: 2 }))).toThrow("cancelled");
      expect(() =>
        execute(
          s,
          cmd({
            type: "offline.checkout",
            deviceId: "demo-device",
            sequence: 1,
            orderId: "order-1",
            counterId: "counter-1",
            lines: [{ ...line, pricePaise: 280, taxBps: 1200 }],
            cashPaise: 2800,
            dispenserId: owner.id,
          }),
          { ...owner, offlineAuthorized: true },
          now,
        ),
      ).toThrow("transferred");
    });
    it("does not cancel a pending handoff or another collector's order", () => {
      const cancel = (version: number): Operation => ({
        type: "order.cancel",
        orderId: "order-1",
        version,
        reason: "Not needed",
      });
      expect(() => apply(offered(), cancel(2))).toThrow("Take back");
      const held = apply(
        offered(),
        { type: "order.accept", orderId: "order-1", version: 2 },
        employee,
      );
      held.members[other.id] = { ...held.members[employee.id], id: other.id };
      expect(() => apply(held, cancel(3), other)).toThrow("Only the current");
    });
  });
  describe("catalogue import", () => {
    const item = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      name: `Imported ${id}`,
      generic: "",
      strength: "500 mg",
      form: "tablet",
      hsn: "3004",
      aliases: ["x".repeat(90)],
      barcode: "",
      units: { tablet: "1", strip: "10" },
      baseUnit: "tablet",
      taxBps: 1200,
      reorderAt: "0",
      schedule: "OTC" as const,
      active: true,
      ...over,
    });
    const importing = (products: ReturnType<typeof item>[]): Operation => ({
      type: "catalogue.import",
      importId: "import-1",
      products,
    });
    it("creates a chunk of products at once and keeps a small, hashed receipt", () => {
      const s0 = demoState(undefined, undefined, undefined, now);
      const c = cmd(
        importing(Array.from({ length: 60 }, (_, i) => item(`p${i}`))),
      );
      const out = execute(s0, c, owner, now);
      expect(Object.keys(out.state.products)).toHaveLength(66);
      expect(out.result).toEqual({ importId: "import-1", created: 60 });
      const receipt = out.state.commands[c.id];
      expect(receipt.fingerprint).toMatch(/^h:/);
      expect(execute(out.state, c, owner, now).state).toBe(out.state);
      expect(() =>
        execute(
          out.state,
          { ...c, operation: importing([item("p0")]) },
          owner,
          now,
        ),
      ).toThrow("different data");
    });
    it("is owner-only and all-or-nothing", () => {
      const s0 = demoState(undefined, undefined, undefined, now);
      expect(() => apply(s0, importing([item("a")]), employee)).toThrow(
        "Owner",
      );
      expect(() => apply(s0, importing([item("a"), item("dolo")]))).toThrow(
        "already exists",
      );
      expect(() => apply(s0, importing([item("a"), item("a")]))).toThrow(
        "repeated",
      );
      expect(() =>
        apply(s0, importing([item("b", { units: { tablet: "2" } })])),
      ).toThrow("base unit");
      expect(s0.products.a).toBeUndefined();
    });
  });
  it("binds discount approval to a specific order version", () => {
    let s = order();
    s = approve(s, "discount", {
      orderId: "order-1",
      orderVersion: 1,
      amountPaise: 100,
    });
    s = apply(s, {
      type: "order.save",
      orderId: "order-1",
      version: 1,
      lines: [line],
      counterId: "counter-1",
    });
    expect(() =>
      apply(
        s,
        checkout({
          version: 2,
          cashPaise: 2700,
          discountPaise: 100,
          discountApprovalId: "approval-1",
        }),
      ),
    ).toThrow("does not match");
  });
  it("credit repayment changes collections and dues but not sales", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s = apply(s, {
      type: "order.save",
      orderId: "order-1",
      version: 0,
      lines: [line],
      customerId: "customer-1",
      counterId: "counter-1",
    });
    s = approve(s, "credit", {
      orderId: "order-1",
      orderVersion: 1,
      customerId: "customer-1",
      amountPaise: 1800,
    });
    s = apply(
      s,
      checkout({
        cashPaise: 1000,
        creditPaise: 1800,
        creditApprovalId: "approval-1",
      }),
    );
    expect(balance(s, "customer-1")).toBe(1800);
    s = apply(s, {
      type: "credit.repay",
      customerId: "customer-1",
      amountPaise: 800,
      method: "cash",
    });
    expect(balance(s, "customer-1")).toBe(1000);
    expect(totals(s).netSalesPaise).toBe(2800);
    expect(totals(s).cashCollectedPaise).toBe(1800);
  });
  it("separates refund approval from execution and quarantines stock", () => {
    let s = apply(order(), checkout());
    const invoice = Object.values(s.invoices)[0];
    s = approve(s, "refund", {
      invoiceId: invoice.id,
      lines: [{ index: 0, quantity: "5" }],
    });
    expect(Object.keys(s.refunds)).toHaveLength(0);
    s = apply(s, {
      type: "refund.execute",
      approvalId: "approval-1",
      cashPaise: 1400,
      upiPaise: 0,
    });
    expect(s.batches["dolo-b1"].quantity).toBe("22");
    expect(s.batches["dolo-b1"].quarantined).toBe("5");
    expect(totals(s).netSalesPaise).toBe(1400);
    expect(() =>
      apply(s, {
        type: "refund.execute",
        approvalId: "approval-1",
        cashPaise: 1400,
        upiPaise: 0,
      }),
    ).toThrow("unused");
  });
  it("rejects returns larger than the original quantity", () => {
    let s = apply(order(), checkout());
    const i = Object.values(s.invoices)[0];
    // Refused when asked, so the owner never sees a return that cannot be paid out.
    expect(() =>
      approve(s, "refund", {
        invoiceId: i.id,
        lines: [{ index: 0, quantity: "11" }],
      }),
    ).toThrow("exceeds");
  });
  it("prices a return from what was paid and says the exact refund when the amount is wrong", () => {
    let s = apply(order(), checkout());
    const i = Object.values(s.invoices)[0];
    // 10 tablets for ₹28: returning 3 then 7 pays ₹8.40 then ₹19.60, never more than the line.
    const first = refundQuote(s, i, [{ index: 0, quantity: "3" }]);
    expect(first).toMatchObject({ totalPaise: 840, payablePaise: 840 });
    s = approve(s, "refund", {
      invoiceId: i.id,
      lines: [{ index: 0, quantity: "3" }],
    });
    expect(() =>
      apply(s, {
        type: "refund.execute",
        approvalId: "approval-1",
        cashPaise: 900,
        upiPaise: 0,
      }),
    ).toThrow("Refund ₹8.40");
    s = apply(s, {
      type: "refund.execute",
      approvalId: "approval-1",
      cashPaise: 840,
      upiPaise: 0,
    });
    const rest = refundQuote(s, i, [{ index: 0, quantity: "7" }]);
    expect(rest.totalPaise + first.totalPaise).toBe(i.lines[0].netPaise);
    expect(returnable(s, i)[0].remaining.toFixed()).toBe("7");
  });
  it("allows one open return request per bill", () => {
    let s = apply(order(), checkout());
    const i = Object.values(s.invoices)[0];
    s = approve(s, "refund", {
      invoiceId: i.id,
      lines: [{ index: 0, quantity: "2" }],
    });
    expect(() =>
      apply(s, {
        type: "approval.request",
        approvalId: "approval-2",
        kind: "refund",
        payload: { invoiceId: i.id, lines: [{ index: 0, quantity: "2" }] },
        reason: "Asked twice",
      }),
    ).toThrow("already waiting");
  });
  it("lets the employee who asked hand back an approved refund, and nobody else", () => {
    let s = apply(order(), checkout());
    s.members["other-employee"] = {
      ...s.members[employee.id],
      id: "other-employee",
    };
    const i = Object.values(s.invoices)[0];
    s = apply(
      s,
      {
        type: "approval.request",
        approvalId: "return-1",
        kind: "refund",
        payload: { invoiceId: i.id, lines: [{ index: 0, quantity: "10" }] },
        reason: "Doctor changed the prescription",
      },
      employee,
    );
    const refund: Operation = {
      type: "refund.execute",
      approvalId: "return-1",
      cashPaise: 2800,
      upiPaise: 0,
    };
    expect(() => apply(s, refund, employee)).toThrow("unused owner approval");
    s = apply(s, {
      type: "approval.decide",
      approvalId: "return-1",
      approve: true,
    });
    expect(() =>
      apply(s, refund, { ...employee, id: "other-employee" }),
    ).toThrow("Owner approval required");
    expect(() => apply(s, refund, { ...employee, canCollect: false })).toThrow(
      "Owner approval required",
    );
    s = apply(s, refund, employee);
    expect(Object.values(s.refunds)[0].executedBy).toBe(employee.id);
    // The employee's phone sees the return on a bill it can see, so it cannot offer it again.
    const view = employeeView(s, employee.id);
    expect(Object.keys(view.refunds)).toEqual([]);
    const own = employeeView(
      { ...s, invoices: { [i.id]: { ...i, collectorId: employee.id } } },
      employee.id,
    );
    expect(Object.keys(own.refunds)).toHaveLength(1);
    expect(returnable(own, own.invoices[i.id])[0].remaining.toFixed()).toBe(
      "0",
    );
    expect(totals(s).cashCollectedPaise).toBe(0);
  });
  it("cancels what the customer still owes before handing back money", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s = apply(s, {
      type: "order.save",
      orderId: "order-1",
      version: 0,
      lines: [line],
      customerId: "customer-1",
      counterId: "counter-1",
    });
    s = approve(s, "credit", {
      orderId: "order-1",
      orderVersion: 1,
      customerId: "customer-1",
      amountPaise: 1800,
    });
    s = apply(
      s,
      checkout({
        cashPaise: 1000,
        creditPaise: 1800,
        creditApprovalId: "approval-1",
      }),
    );
    const i = Object.values(s.invoices)[0];
    expect(refundQuote(s, i, [{ index: 0, quantity: "10" }])).toMatchObject({
      totalPaise: 2800,
      creditReductionPaise: 1800,
      payablePaise: 1000,
    });
    s = approve(
      s,
      "refund",
      { invoiceId: i.id, lines: [{ index: 0, quantity: "10" }] },
      "approval-2",
    );
    expect(() =>
      apply(s, {
        type: "refund.execute",
        approvalId: "approval-2",
        cashPaise: 2800,
        upiPaise: 0,
      }),
    ).toThrow("₹18.00 is taken off what the customer owes");
    s = apply(s, {
      type: "refund.execute",
      approvalId: "approval-2",
      cashPaise: 1000,
      upiPaise: 0,
    });
    expect(balance(s, "customer-1")).toBe(0);
  });
  it("converts a returned strip to tablets and refuses part of a tablet", () => {
    const s = apply(order(), checkout());
    const i = Object.values(s.invoices)[0];
    expect(returnBaseQuantity(s, i, 0, "1", "strip")).toBe("10");
    expect(returnBaseQuantity(s, i, 0, "4", "tablet")).toBe("4");
    expect(() => returnBaseQuantity(s, i, 0, "0.5", "tablet")).toThrow("whole");
    expect(() => returnBaseQuantity(s, i, 0, "1", "bottle")).toThrow("unit");
  });
  it("releases quarantined returns only through a stock approval", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s.batches["dolo-b1"].quarantined = "5";
    s = approve(s, "stock", {
      batchId: "dolo-b1",
      quantity: "3",
      kind: "release",
      reason: "Package checked",
    });
    s = apply(s, { type: "stock.execute", approvalId: "approval-1" });
    expect(s.batches["dolo-b1"].quantity).toBe("35");
    expect(s.batches["dolo-b1"].quarantined).toBe("2");
  });
  it("records supplier bonus units and rejects duplicate invoices", () => {
    let s = demoState(undefined, undefined, undefined, now);
    const operation: Operation = {
      type: "purchase.post",
      purchaseId: "p1",
      supplierId: "supplier-1",
      invoiceNumber: "INV1",
      invoiceDate: "2026-09-23",
      totalPaise: 2000,
      reviewed: true,
      lines: [
        {
          batch: { ...s.batches["dolo-b1"], id: "new-batch", quantity: "0" },
          quantity: "10",
          bonusQuantity: "2",
          lineTotalPaise: 2000,
        },
      ],
    };
    s = apply(s, operation);
    expect(s.batches["new-batch"].quantity).toBe("12");
    expect(() => apply(s, { ...operation, purchaseId: "p2" })).toThrow(
      "already posted",
    );
  });
  it("prevents staff viewing purchase costs and other staff bills", () => {
    const s = apply(order(), checkout());
    const view = employeeView(s, employee.id);
    expect(view.batches["dolo-b1"].costPaise).toBeUndefined();
    expect(Object.keys(view.invoices)).toHaveLength(0);
    expect(Object.keys(view.commands)).toHaveLength(0);
    expect(() =>
      apply(
        s,
        { type: "drawer.close", drawerId: "drawer-demo", countedPaise: 0 },
        { ...employee, canCollect: false },
      ),
    ).toThrow("Drawer access");
  });
  it("sizes the shared PDF like a receipt and says what was paid", () => {
    const s = apply(order(), checkout());
    const i = Object.values(s.invoices)[0];
    const one = receiptPage(i);
    expect(one.width).toBe(300);
    const longer = receiptPage({
      ...i,
      lines: [...i.lines, ...i.lines, ...i.lines],
    });
    expect(longer.height).toBeGreaterThan(one.height + 100);
    expect(
      receiptPage(i, { customerName: "Meera Sharma" }).height,
    ).toBeGreaterThan(one.height);
    const html = receiptHtml(i, false, {
      page: one,
      customerName: "Meera Sharma",
      payments: [
        { kind: "sale", method: "cash", amountPaise: i.totalPaise - 100 },
        { kind: "refund", method: "cash", amountPaise: 999 },
      ],
    });
    expect(html).toContain(`@page{size:300pt ${one.height}pt;margin:0}`);
    expect(html).toContain("Customer: Meera Sharma");
    expect(html).toMatch(/Paid ₹[\d.,]+ by cash · Balance due ₹1\.00/);
    expect(html).not.toContain("recorded separately");
    // The owner's on-screen copy keeps the neutral wording and page-free layout.
    expect(receiptHtml(i)).toContain(
      "Payment details are recorded separately.",
    );
    expect(receiptHtml(i)).not.toContain("@page");
  });
  it("escapes invoice HTML", () => {
    const s = apply(order(), checkout());
    const i = Object.values(s.invoices)[0];
    i.business.name = "<script>alert(1)</script>";
    const html = receiptHtml(i);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
describe("offline and evidence", () => {
  const offline = (s: State, extra: Record<string, unknown> = {}): Operation =>
    ({
      type: "offline.checkout",
      deviceId: "demo-device",
      sequence: 1,
      orderId: "offline-order",
      counterId: "counter-1",
      lines: [{ ...line, pricePaise: 280, taxBps: 1200 }],
      cashPaise: 2800,
      dispenserId: owner.id,
      ...extra,
    }) as Operation;
  it("requires a verified offline lease", () => {
    const s = demoState(undefined, undefined, undefined, now);
    expect(() => apply(s, offline(s))).toThrow("Signed");
  });
  it("preserves sale and number through a four-hour outage and flags stock conflict", () => {
    const s = demoState(undefined, undefined, undefined, now);
    s.batches["dolo-b1"].quantity = "2";
    const c = cmd(offline(s));
    const later = "2026-09-23T13:00:00.000Z";
    const out = execute(s, c, { ...owner, offlineAuthorized: true }, later);
    expect(out.state.batches["dolo-b1"].quantity).toBe("-8");
    expect(Object.values(out.state.invoices)[0].number).toBe("2627-D01-000001");
    expect(Object.values(out.state.reviews)[0].kind).toBe("offline_stock");
    expect(
      execute(out.state, c, { ...owner, offlineAuthorized: true }, later).state,
    ).toBe(out.state);
  });
  it("flags changed cached prices without changing the bill", () => {
    const s = demoState(undefined, undefined, undefined, now);
    s.batches["dolo-b1"].pricePaise = 270;
    const out = execute(
      s,
      cmd(offline(s)),
      { ...owner, offlineAuthorized: true },
      now,
    ).state;
    expect(Object.values(out.invoices)[0].totalPaise).toBe(2800);
    expect(Object.values(out.reviews)[0].kind).toBe("offline_price");
  });
  describe("shared drawer", () => {
    const sale = () => apply(order(), checkout());
    it("lets staff who take money count and close blind, while the owner sees the difference", () => {
      let s = sale();
      // 2,000 opening + 28 cash sale.
      s = apply(
        s,
        {
          type: "drawer.count",
          drawerId: "drawer-demo",
          countedPaise: 201800,
          denominations: { "500": 4, "10": 1, coins: 800 },
        },
        employee,
      );
      const answered = execute(
        s,
        cmd({
          type: "drawer.count",
          drawerId: "drawer-demo",
          countedPaise: 1,
          denominations: { coins: 1 },
        }),
        employee,
        now,
      ).result;
      expect(answered).toEqual({ countedPaise: 1 });
      const check = s.drawers["drawer-demo"].checks![0];
      expect(check).toMatchObject({
        by: employee.id,
        expectedPaise: 202800,
        differencePaise: -1000,
      });
      const view = employeeView(s, employee.id).drawers["drawer-demo"];
      expect(view.checks![0]).not.toHaveProperty("expectedPaise");
      expect(view.checks![0]).not.toHaveProperty("differencePaise");
      expect(() =>
        apply(
          s,
          {
            type: "drawer.count",
            drawerId: "drawer-demo",
            countedPaise: 5000,
            denominations: { "500": 1 },
          },
          employee,
        ),
      ).toThrow("does not add up");
      s = apply(
        s,
        {
          type: "drawer.close",
          drawerId: "drawer-demo",
          countedPaise: 202800,
          keptPaise: 200000,
        },
        employee,
      );
      const closed = s.drawers["drawer-demo"];
      expect(closed).toMatchObject({
        closedBy: employee.id,
        expectedAtClose: 202800,
        discrepancyPaise: 0,
        keptPaise: 200000,
      });
      const blind = employeeView(s, employee.id).drawers["drawer-demo"];
      expect(blind.expectedAtClose).toBeUndefined();
      expect(blind.discrepancyPaise).toBeUndefined();
      expect(blind.keptPaise).toBeUndefined();
      // Closing the last drawer made the day's report.
      const report = s.eods["2026-09-23:1"].report!;
      expect(report.sales).toMatchObject({
        bills: 1,
        netPaise: 2800,
        cashPaise: 2800,
      });
      expect(report.drawers[0]).toMatchObject({
        openingPaise: 200000,
        expectedPaise: 202800,
        countedPaise: 202800,
        differencePaise: 0,
        closedBy: "Aarav",
      });
      expect(report.drawers[0].checks[0].differencePaise).toBe(-1000);
    });
    it("shares the day report with names and reasons escaped", () => {
      let s = sale();
      s = apply(
        s,
        {
          type: "cash.move",
          drawerId: "drawer-demo",
          kind: "withdrawal",
          amountPaise: 20000,
          reason: "<img src=x onerror=alert(1)>",
        },
        employee,
      );
      const html = dayReportHtml(
        dayReport(s, "2026-09-23", now),
        "Shop <b>",
        2,
        true,
      );
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
      expect(html).toContain("Shop &lt;b&gt;");
      expect(html).toContain("revision 2");
      expect(html).toContain("Paid out");
      expect(differenceText(-5000)).toBe("₹50.00 short");
      expect(differenceText(0)).toBe("matches");
    });
    it("compares the next opening with what was left in the drawer", () => {
      let s = apply(sale(), {
        type: "drawer.close",
        drawerId: "drawer-demo",
        countedPaise: 202800,
        keptPaise: 50000,
      });
      s = apply(
        s,
        { type: "drawer.open", drawerId: "next", openingPaise: 45000 },
        employee,
      );
      expect(s.drawers.next.openingDifferencePaise).toBe(-5000);
      expect(
        employeeView(s, employee.id).drawers.next.openingDifferencePaise,
      ).toBeUndefined();
      expect(() =>
        apply(s, { type: "drawer.open", drawerId: "again", openingPaise: 0 }),
      ).toThrow("already open");
      expect(() =>
        apply(s, {
          type: "drawer.close",
          drawerId: "next",
          countedPaise: 100,
          keptPaise: 200,
        }),
      ).toThrow("more than was counted");
    });
    it("still reports the day before when the drawer is closed after midnight", () => {
      // Sale at 2:30 pm on the 23rd; drawer closed at 12:30 am on the 24th.
      const lateNight = "2026-09-23T19:00:00.000Z";
      let s = execute(
        sale(),
        cmd(
          {
            type: "drawer.close",
            drawerId: "drawer-demo",
            countedPaise: 202800,
            keptPaise: 100000,
          },
          lateNight,
        ),
        employee,
        lateNight,
      ).state;
      expect(s.eods["2026-09-23:1"].report!.sales.bills).toBe(1);
      expect(s.eods["2026-09-23:1"].report!.drawers[0].countedPaise).toBe(
        202800,
      );
      expect(s.eods["2026-09-24:1"].report!.sales.bills).toBe(0);
      // The next night's close revises only the day that changed.
      const morning = "2026-09-24T03:30:00.000Z";
      const night = "2026-09-24T16:00:00.000Z";
      s = execute(
        s,
        cmd(
          { type: "drawer.open", drawerId: "day-2", openingPaise: 100000 },
          morning,
        ),
        employee,
        morning,
      ).state;
      s = execute(
        s,
        cmd(
          { type: "drawer.close", drawerId: "day-2", countedPaise: 100000 },
          night,
        ),
        employee,
        night,
      ).state;
      expect(s.eods["2026-09-24:2"]).toBeDefined();
      expect(s.eods["2026-09-23:2"]).toBeUndefined();
    });
    it("names who recorded each cash movement and cancellation in the day report", () => {
      let s = sale();
      s = apply(
        s,
        {
          type: "cash.move",
          drawerId: "drawer-demo",
          kind: "withdrawal",
          amountPaise: 20000,
          reason: "Paid delivery boy",
        },
        employee,
      );
      s = apply(s, {
        type: "order.save",
        orderId: "order-2",
        version: 0,
        lines: [line],
        counterId: "counter-1",
      });
      s = apply(s, {
        type: "order.cancel",
        orderId: "order-2",
        version: 1,
        reason: "Customer left",
      });
      const r = dayReport(s, "2026-09-23", now);
      expect(r.movements).toEqual([
        expect.objectContaining({
          name: "Aarav",
          kind: "withdrawal",
          amountPaise: 20000,
          reason: "Paid delivery boy",
        }),
      ]);
      expect(r.cancelled[0]).toMatchObject({
        name: "Shop owner",
        reason: "Customer left",
        valuePaise: 2800,
      });
      const staff = Object.fromEntries(r.staff.map((x) => [x.name, x]));
      expect(staff["Shop owner"]).toMatchObject({
        bills: 1,
        cashInPaise: 2800,
        cancelled: 1,
      });
      expect(staff["Aarav"]).toMatchObject({ cashOutPaise: 20000 });
      expect(r.drawers[0].expectedPaise).toBe(182800);
      // Staff see only their own movements.
      expect(Object.keys(employeeView(s, owner.id).cash)).toHaveLength(0);
      expect(Object.keys(employeeView(s, employee.id).cash)).toHaveLength(1);
    });
    it("does not revise a report for sales made after it, only for ones that arrive late", () => {
      let s = apply(sale(), { type: "eod.close", date: "2026-09-23" });
      s = execute(
        s,
        {
          id: "after",
          occurredAt: "2026-09-23T09:10:00.000Z",
          operation: {
            type: "cash.move",
            drawerId: "drawer-demo",
            kind: "introduced",
            amountPaise: 5000,
            reason: "Change from the bank",
          } as Operation,
        },
        owner,
        "2026-09-23T09:10:00.000Z",
      ).state;
      expect(Object.keys(s.eods)).toEqual(["2026-09-23:1"]);
    });
  });
  it("appends EOD revision for late sales", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s = apply(s, { type: "eod.close", date: "2026-09-23" });
    const first = structuredClone(s.eods["2026-09-23:1"]);
    s = execute(
      s,
      cmd(offline(s)),
      { ...owner, offlineAuthorized: true },
      "2026-09-23T13:00:00.000Z",
    ).state;
    expect(s.eods["2026-09-23:1"]).toEqual(first);
    expect(s.eods["2026-09-23:2"].totals.netSalesPaise).toBe(2800);
  });
  it("keeps camera observations ambiguous and updates late matches", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s = apply(s, {
      type: "camera.observe",
      observation: {
        id: "obs",
        counterId: "counter-1",
        trackId: "anon-1",
        startedAt: "2026-09-23T08:59:00.000Z",
        endedAt: now,
        visible: true,
      },
    });
    expect(s.observations.obs.association).toBe("unmatched");
    s = execute(
      s,
      cmd(offline(s)),
      { ...owner, offlineAuthorized: true },
      now,
    ).state;
    expect(s.observations.obs.association).toBe("candidate");
    expect(
      Object.values(s.reviews).find((r) => r.kind === "camera")?.status,
    ).toBe("resolved");
  });
  it("uses Indian fiscal year at midnight on April 1", () => {
    expect(fiscalYear("2026-03-31T18:29:59.000Z")).toBe("2526");
    expect(fiscalYear("2026-03-31T18:30:00.000Z")).toBe("2627");
  });
  it("owner price updates respect MRP and preserve previously issued invoice prices", () => {
    let s = apply(order(), checkout());
    const invoice = Object.values(s.invoices)[0];
    expect(() =>
      apply(s, {
        type: "batch.price",
        batchId: "dolo-b1",
        pricePaise: 100000,
        reason: "test price",
      }),
    ).toThrow("MRP");
    s = apply(s, {
      type: "batch.price",
      batchId: "dolo-b1",
      pricePaise: 270,
      reason: "Reviewed selling price",
    });
    expect(s.invoices[invoice.id].lines[0].pricePaise).toBe(280);
    expect(() =>
      apply(
        s,
        {
          type: "batch.price",
          batchId: "dolo-b1",
          pricePaise: 260,
          reason: "test price",
        },
        employee,
      ),
    ).toThrow("Owner");
  });
  it("disposes quarantined returns without reducing sellable inventory", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s.batches["dolo-b1"].quarantined = "5";
    s = approve(s, "stock", {
      batchId: "dolo-b1",
      quantity: "-3",
      kind: "quarantine_disposal",
      reason: "Damaged packaging; disposed",
    });
    s = apply(s, { type: "stock.execute", approvalId: "approval-1" });
    expect(s.batches["dolo-b1"].quantity).toBe("32");
    expect(s.batches["dolo-b1"].quarantined).toBe("2");
  });
  it("keeps EOD provisional until every device syncs after the close cutoff", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s.devices["second"] = {
      ...s.devices["demo-device"],
      id: "second",
      series: "D02",
    };
    s = apply(s, { type: "eod.close", date: "2026-09-23" });
    expect(s.eods["2026-09-23:1"].provisional).toBe(true);
    s.devices["demo-device"].lastSyncedAt = "2026-09-23T09:00:01.000Z";
    s.devices["demo-device"].lastSyncedRevision = s.revision;
    confirmEodSynchronisation(s, "2026-09-23T09:00:02.000Z");
    expect(Object.keys(s.eods)).toHaveLength(1);
    s.devices.second.lastSyncedAt = "2026-09-23T09:00:03.000Z";
    s.devices.second.lastSyncedRevision = s.revision;
    confirmEodSynchronisation(s, "2026-09-23T09:00:04.000Z");
    expect(s.eods["2026-09-23:2"].provisional).toBe(false);
    expect(s.eods["2026-09-23:1"].provisional).toBe(true);
  });
});
