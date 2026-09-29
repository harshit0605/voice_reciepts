import { describe, it, expect } from "vitest";
import {
  demoState,
  execute,
  recoverCheckout,
  billsLocally,
  orderMatches,
  commandOrderId,
  neverSent,
  type Actor,
  type CheckoutAttempt,
  type Command,
  type Operation,
  type State,
} from "../src";
const now = "2026-09-23T09:00:00.000Z";
const owner: Actor = {
  id: "demo-owner",
  role: "owner",
  businessId: "pilot-pharmacy",
  canCollect: true,
};
const line = {
  batchId: "dolo-b1",
  quantity: "1",
  unit: "strip",
  confirmed: true,
};
const attempt: CheckoutAttempt = {
  orderId: "basket-order",
  cashCommandId: "basket-cash",
  online: true,
};
const command = (id: string, operation: Operation): Command => ({
  id,
  occurredAt: now,
  operation,
});
const run = (s: State, id: string, operation: Operation, actor = owner) =>
  execute(s, command(id, operation), actor, now).state;
const save: Operation = {
  type: "order.save",
  orderId: attempt.orderId,
  version: 0,
  lines: [line],
  counterId: "counter-1",
};
const checkout = (extra: Record<string, unknown> = {}): Operation =>
  ({
    type: "checkout",
    orderId: attempt.orderId,
    version: 1,
    deviceId: "demo-device",
    sequence: 1,
    cashPaise: 0,
    upiPaise: 2800,
    upiReference: "UPI-123",
    upiVerified: true,
    creditPaise: 0,
    discountPaise: 0,
    ...extra,
  }) as Operation;
const fresh = () => demoState(undefined, undefined, undefined, now);
const recover = (
  s: State,
  a: CheckoutAttempt | undefined = attempt,
  queued: string[] = [],
  uncertain: Command | null = null,
) => recoverCheckout(a, s, owner.id, queued, uncertain);
describe("checkout attempt recovery", () => {
  it("reports nothing to recover without a pinned attempt", () => {
    expect(recoverCheckout(undefined, fresh(), owner.id, [], null).kind).toBe(
      "none",
    );
  });
  it("treats an attempt with no recorded trace as safe to retry", () => {
    expect(recover(fresh()).kind).toBe("unsent");
  });
  it("finds a local cash sale committed before a crash cleared the draft", () => {
    const local = { ...attempt, online: false };
    const s = execute(
      fresh(),
      command(local.cashCommandId, {
        type: "offline.checkout",
        deviceId: "demo-device",
        sequence: 1,
        orderId: local.orderId,
        counterId: "counter-1",
        lines: [{ ...line, pricePaise: 280, taxBps: 1200 }],
        cashPaise: 2800,
        dispenserId: owner.id,
      }),
      { ...owner, offlineAuthorized: true },
      now,
    ).state;
    const r = recover(s, local);
    expect(r.kind).toBe("billed");
    expect(r.kind === "billed" && r.invoice.id).toBe("basket-cash:invoice");
  });
  it("finds an online checkout whose response was lost, even before the retry resolves", () => {
    const s = run(run(fresh(), "save", save), "lost", checkout());
    const r = recover(s, attempt, [], command("lost", checkout()));
    expect(r.kind).toBe("billed");
    expect(r.kind === "billed" && r.invoice.orderId).toBe(attempt.orderId);
  });
  it("locks the basket while its own checkout has no answer", () => {
    const s = run(fresh(), "save", save);
    expect(recover(s, attempt, [], command("pending", checkout())).kind).toBe(
      "uncertain",
    );
  });
  it("does not lock a basket for another order's unanswered command", () => {
    const s = run(fresh(), "save", save);
    const other = command("other", {
      ...checkout(),
      orderId: "someone-else",
    } as Operation);
    expect(recover(s, attempt, [], other).kind).toBe("held");
  });
  it("recognises a cash sale that is queued on the phone but not projected", () => {
    expect(recover(fresh(), attempt, ["basket-cash"]).kind).toBe(
      "saved_locally",
    );
  });
  it("releases a basket whose order was handed to another collector", () => {
    const held = run(fresh(), "save", save);
    const s = run(held, "offer", {
      type: "order.offer",
      orderId: attempt.orderId,
      to: "demo-employee",
      version: 1,
    });
    expect(recover(s).kind).toBe("elsewhere");
  });
  it("links credit approval requests to their order", () => {
    expect(
      commandOrderId(
        command("ask", {
          type: "approval.request",
          approvalId: "a1",
          kind: "credit",
          payload: { orderId: attempt.orderId, amountPaise: 100 },
          reason: "Customer requested credit",
        }),
      ),
    ).toBe(attempt.orderId);
  });
});
describe("cash after an unanswered online payment", () => {
  it("routes the basket through its server order once it has been sent", () => {
    expect(billsLocally("cash", undefined)).toBe(true);
    expect(billsLocally("cash", { ...attempt, online: false })).toBe(true);
    expect(billsLocally("cash", attempt)).toBe(false);
    expect(billsLocally("upi", undefined)).toBe(false);
    expect(billsLocally("cash", undefined, "held-order")).toBe(false);
  });
  it("cannot create a second invoice for a basket whose UPI checkout already committed", () => {
    const s = run(run(fresh(), "save", save), "lost", checkout());
    expect(() =>
      run(
        s,
        "cash-retry",
        checkout({
          sequence: 2,
          cashPaise: 2800,
          upiPaise: 0,
          upiReference: undefined,
          upiVerified: undefined,
        }),
      ),
    ).toThrow("Order already completed");
    expect(Object.keys(s.invoices)).toHaveLength(1);
  });
});
describe("held order reuse", () => {
  const order = run(fresh(), "save", save).orders[attempt.orderId];
  it("matches regardless of key order so approvals stay valid", () => {
    const reordered = {
      confirmed: true,
      unit: "strip",
      quantity: "1",
      batchId: "dolo-b1",
    };
    expect(orderMatches(order, { lines: [reordered] })).toBe(true);
  });
  it("detects basket, customer and prescription changes", () => {
    expect(orderMatches(order, { lines: [{ ...line, quantity: "2" }] })).toBe(
      false,
    );
    expect(orderMatches(order, { lines: [line], customerId: "c1" })).toBe(
      false,
    );
    expect(
      orderMatches(order, {
        lines: [line],
        prescription: {
          patient: "P",
          address: "A",
          prescriber: "D",
          prescriberAddress: "DA",
          reference: "R",
        },
      }),
    ).toBe(false);
  });
});
describe("failed requests", () => {
  it("treats only requests that never left the phone as not sent", () => {
    for (const message of [
      "fetch failed: java.net.ConnectException: Failed to connect to localhost/127.0.0.1:4100",
      'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.example.in": No address associated with hostname',
      "fetch failed: UnexpectedException: Could not connect to the server.",
      "The Internet connection appears to be offline.",
      "A server with the specified hostname could not be found.",
    ])
      expect(neverSent(new Error(message))).toBe(true);
    for (const message of [
      "fetch failed: java.io.IOException: unexpected end of stream on http://localhost:4100/...",
      "The request timed out.",
      "The network connection was lost.",
      "java.net.SocketTimeoutException: timeout",
      "The operation was aborted due to timeout",
    ])
      expect(neverSent(new Error(message))).toBe(false);
  });
});
