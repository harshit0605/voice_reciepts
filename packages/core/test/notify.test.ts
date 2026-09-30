import { describe, it, expect } from "vitest";
import {
  demoState,
  execute,
  noticesFor,
  type Actor,
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
const employee: Actor = {
  id: "demo-employee",
  role: "employee",
  businessId: "pilot-pharmacy",
  canCollect: true,
};
let n = 0;
/** Runs one command and returns what it would notify. */
function step(s: State, operation: Operation, actor: Actor) {
  const cmd: Command = { id: `n-${++n}`, occurredAt: now, operation };
  const after = execute(s, cmd, actor, now).state;
  return { after, notices: noticesFor(s, after, actor.id) };
}

describe("phone notifications", () => {
  it("tells the owner about a request and the asker about the answer", () => {
    let s = demoState(undefined, undefined, undefined, now);
    s = step(
      s,
      {
        type: "order.save",
        orderId: "order-1",
        version: 0,
        lines: [
          { batchId: "dolo-b1", quantity: "1", unit: "strip", confirmed: true },
        ],
        counterId: "counter-1",
        customerId: Object.keys(s.customers)[0],
      },
      employee,
    ).after;
    const asked = step(
      s,
      {
        type: "approval.request",
        approvalId: "credit-1",
        kind: "credit",
        payload: {
          orderId: "order-1",
          orderVersion: 1,
          customerId: Object.keys(s.customers)[0],
          amountPaise: 2800,
        },
        reason: "Customer requested credit",
      },
      employee,
    );
    expect(asked.notices).toHaveLength(1);
    expect(asked.notices[0]).toMatchObject({
      to: ["demo-owner"],
      page: "reviews",
      en: { title: "Approval needed" },
    });
    expect(asked.notices[0].en.body).toMatch(/^Aarav: Credit ₹28\.00/);
    expect(asked.notices[0].hi.body).toMatch(/उधार ₹28\.00/);
    const answered = step(
      asked.after,
      { type: "approval.decide", approvalId: "credit-1", approve: true },
      owner,
    );
    expect(answered.notices).toEqual([
      expect.objectContaining({
        to: ["demo-employee"],
        page: "orders",
        en: expect.objectContaining({ title: "Owner approved" }),
      }),
    ]);
  });

  it("tells the owner when the drawer does not match and when the day's report is ready", () => {
    const s = demoState(undefined, undefined, undefined, now);
    // The demo drawer opened with ₹2,000 and nothing was sold: ₹10 short.
    const closed = step(
      s,
      {
        type: "drawer.close",
        drawerId: "drawer-demo",
        countedPaise: 199000,
        keptPaise: 100000,
      },
      employee,
    );
    const titles = closed.notices.map((x) => x.en.title);
    expect(titles).toContain("Drawer closed ₹10.00 short");
    expect(titles).toContain("Day report ready · 2026-09-23");
    expect(closed.notices.every((x) => x.to.join() === "demo-owner")).toBe(
      true,
    );
    const report = closed.notices.find(
      (x) => x.page === "money" && /report/.test(x.en.title),
    )!;
    expect(report.en.body).toMatch(/drawer ₹10\.00 short/);
    expect(report.hi.body).toMatch(/दराज़ ₹10\.00 कम/);
  });

  it("does not notify people about their own actions", () => {
    const s = demoState(undefined, undefined, undefined, now);
    const closed = step(
      s,
      { type: "drawer.close", drawerId: "drawer-demo", countedPaise: 199000 },
      owner,
    );
    expect(closed.notices).toEqual([]);
  });
});
