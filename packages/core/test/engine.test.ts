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
  type State,
  type Command,
  type Operation,
  type Actor,
  type Invoice,
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
    s = approve(s, "refund", {
      invoiceId: i.id,
      lines: [{ index: 0, quantity: "11" }],
    });
    expect(() =>
      apply(s, {
        type: "refund.execute",
        approvalId: "approval-1",
        cashPaise: 3080,
        upiPaise: 0,
      }),
    ).toThrow("exceeds");
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
        employee,
      ),
    ).toThrow("Owner");
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
