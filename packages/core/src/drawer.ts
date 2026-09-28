import { D, expectedCash, indiaDate, round, totals } from "./money";
import type { Denominations, DrawerCheck, Eod, Order, State } from "./types";

/** Indian notes a drawer is counted in, largest first. Coins are entered as one amount. */
export const NOTES = [500, 200, 100, 50, 20, 10] as const;

/** Paise in a note-and-coin count. */
export function denominationTotal(d: Denominations) {
  return Object.entries(d).reduce(
    (n, [note, count]) =>
      n + (note === "coins" ? count : Number(note) * 100 * count),
    0,
  );
}

const nameOf = (state: State, id: string | undefined) =>
  (id && state.members[id]?.name) || "Unknown";
const onDate = (at: string | undefined, date: string) =>
  !!at && indiaDate(at) === date;
const sum = <T>(items: T[], value: (item: T) => number) =>
  items.reduce((n, item) => n + value(item), 0);

/** The drawer in use now, if any. */
export const openDrawerSession = (state: State) =>
  Object.values(state.drawers).find((d) => !d.closedAt);

/** The most recent closed drawer, whose kept cash the next opening is compared with. */
export const lastClosedDrawer = (state: State) =>
  Object.values(state.drawers)
    .filter((d) => d.closedAt)
    .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0];

/** The order's value at current prices, for cancelled orders that never became bills. */
export function orderValue(state: State, order: Order) {
  let paise = 0;
  for (const line of order.lines) {
    const batch = state.batches[line.batchId];
    const factor = batch && state.products[batch.productId]?.units[line.unit];
    if (batch && factor)
      paise += round(D(line.quantity).mul(factor).mul(batch.pricePaise));
  }
  return paise;
}

export type StaffDay = {
  id: string;
  name: string;
  /** Bills where they served the customer. */
  served: number;
  /** Bills where they took the money. */
  bills: number;
  salesPaise: number;
  cashInPaise: number;
  upiInPaise: number;
  creditGivenPaise: number;
  discountsPaise: number;
  refundsPaise: number;
  cancelled: number;
  cashOutPaise: number;
  cashAddedPaise: number;
  counts: number;
};
export type DrawerDay = {
  id: string;
  openedAt: string;
  openedBy: string;
  openingPaise: number;
  openingDifferencePaise?: number;
  closedAt?: string;
  closedBy?: string;
  /** At close for a closed drawer; now for an open one. */
  expectedPaise: number;
  countedPaise?: number;
  differencePaise?: number;
  keptPaise?: number;
  /** Cash recorded into this drawer after it closed (late offline sales). */
  lateChangePaise: number;
  checks: (DrawerCheck & { name: string })[];
};
export type DayReport = {
  date: string;
  generatedAt: string;
  sales: {
    bills: number;
    grossPaise: number;
    discountsPaise: number;
    billedPaise: number;
    returnsPaise: number;
    netPaise: number;
    cashPaise: number;
    upiPaise: number;
    creditPaise: number;
  };
  money: {
    cashInPaise: number;
    upiInPaise: number;
    repaidCashPaise: number;
    repaidUpiPaise: number;
    refundedCashPaise: number;
    refundedUpiPaise: number;
  };
  credit: {
    givenPaise: number;
    repaidPaise: number;
    cancelledByReturnsPaise: number;
    outstandingPaise: number;
  };
  drawers: DrawerDay[];
  movements: {
    at: string;
    name: string;
    kind: string;
    amountPaise: number;
    reason: string;
  }[];
  staff: StaffDay[];
  cancelled: {
    orderId: string;
    at: string;
    name: string;
    reason: string;
    valuePaise: number;
  }[];
  approvals: { approved: number; declined: number; waiting: number };
  openReviews: number;
  pendingDevices: number;
};

/**
 * Everything the owner needs about one India calendar day. Recorded actions carry the name of
 * who did them; a drawer difference belongs to the drawer, not to any one person.
 */
export function dayReport(
  state: State,
  date: string,
  now = new Date().toISOString(),
): DayReport {
  const invoices = Object.values(state.invoices).filter((i) =>
    onDate(i.occurredAt, date),
  );
  const payments = Object.values(state.payments).filter((p) =>
    onDate(p.occurredAt, date),
  );
  const paid = (kind: string, method: string) =>
    sum(
      payments.filter((p) => p.kind === kind && p.method === method),
      (p) => p.amountPaise,
    );
  const refunds = Object.values(state.refunds).filter((r) =>
    onDate(r.occurredAt, date),
  );
  const ledger = Object.values(state.ledger).filter((l) =>
    onDate(l.occurredAt, date),
  );
  const ledgerOf = (kind: string) =>
    sum(
      ledger.filter((l) => l.kind === kind),
      (l) => Math.abs(l.amountPaise),
    );
  const movements = Object.values(state.cash)
    .filter((m) => onDate(m.occurredAt, date))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const cancelledOrders = Object.values(state.orders).filter(
    (o) => o.status === "cancelled" && onDate(o.cancelledAt, date),
  );
  const returnsPaise = sum(refunds, (r) => r.totalPaise);
  const billedPaise = sum(invoices, (i) => i.totalPaise);

  const drawers = Object.values(state.drawers)
    .filter(
      (d) =>
        indiaDate(d.openedAt) <= date &&
        (!d.closedAt || indiaDate(d.closedAt) >= date),
    )
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
    .map((d): DrawerDay => {
      const current = expectedCash(state, d.id);
      return {
        id: d.id,
        openedAt: d.openedAt,
        openedBy: nameOf(state, d.openedBy),
        openingPaise: d.openingPaise,
        openingDifferencePaise: d.openingDifferencePaise,
        closedAt: d.closedAt,
        closedBy: d.closedBy ? nameOf(state, d.closedBy) : undefined,
        expectedPaise: d.closedAt ? (d.expectedAtClose ?? current) : current,
        countedPaise: d.countedPaise,
        differencePaise: d.discrepancyPaise,
        keptPaise: d.keptPaise,
        lateChangePaise:
          d.closedAt && d.expectedAtClose !== undefined
            ? current - d.expectedAtClose
            : 0,
        checks: (d.checks ?? []).map((c) => ({
          ...c,
          name: nameOf(state, c.by),
        })),
      };
    });

  const staffIds = new Set<string>();
  for (const i of invoices) staffIds.add(i.collectorId).add(i.dispenserId);
  for (const p of payments) staffIds.add(p.collectorId);
  for (const r of refunds) staffIds.add(r.executedBy);
  for (const m of movements) staffIds.add(m.actorId);
  for (const o of cancelledOrders) staffIds.add(o.cancelledBy ?? o.collectorId);
  for (const d of Object.values(state.drawers)) {
    if (onDate(d.openedAt, date)) staffIds.add(d.openedBy);
    if (d.closedBy && onDate(d.closedAt, date)) staffIds.add(d.closedBy);
    for (const c of d.checks ?? []) if (onDate(c.at, date)) staffIds.add(c.by);
  }
  const staff = [...staffIds]
    .filter((id) => state.members[id] && !id.startsWith("service:"))
    .map((id): StaffDay => {
      const mine = invoices.filter((i) => i.collectorId === id);
      const myPayments = payments.filter((p) => p.collectorId === id);
      const myMoves = movements.filter((m) => m.actorId === id);
      const drawerActs = Object.values(state.drawers).reduce(
        (n, d) =>
          n +
          (d.openedBy === id && onDate(d.openedAt, date) ? 1 : 0) +
          (d.closedBy === id && onDate(d.closedAt, date) ? 1 : 0) +
          (d.checks ?? []).filter((c) => c.by === id && onDate(c.at, date))
            .length,
        0,
      );
      return {
        id,
        name: nameOf(state, id),
        served: invoices.filter((i) => i.dispenserId === id).length,
        bills: mine.length,
        salesPaise: sum(mine, (i) => i.totalPaise),
        cashInPaise: sum(
          myPayments.filter((p) => p.method === "cash" && p.kind !== "refund"),
          (p) => p.amountPaise,
        ),
        upiInPaise: sum(
          myPayments.filter((p) => p.method === "upi" && p.kind !== "refund"),
          (p) => p.amountPaise,
        ),
        creditGivenPaise: sum(
          ledger.filter(
            (l) =>
              l.kind === "credit_sale" &&
              mine.some((i) => i.id === l.invoiceId),
          ),
          (l) => l.amountPaise,
        ),
        discountsPaise: sum(mine, (i) => i.discountPaise),
        refundsPaise: sum(
          refunds.filter((r) => r.executedBy === id),
          (r) => r.cashRefundPaise + r.upiRefundPaise,
        ),
        cancelled: cancelledOrders.filter(
          (o) => (o.cancelledBy ?? o.collectorId) === id,
        ).length,
        cashOutPaise: sum(
          myMoves.filter((m) => m.kind !== "introduced"),
          (m) => m.amountPaise,
        ),
        cashAddedPaise: sum(
          myMoves.filter((m) => m.kind === "introduced"),
          (m) => m.amountPaise,
        ),
        counts: drawerActs,
      };
    })
    .sort(
      (a, b) => b.salesPaise - a.salesPaise || a.name.localeCompare(b.name),
    );

  const approvals = Object.values(state.approvals);
  return {
    date,
    generatedAt: now,
    sales: {
      bills: invoices.length,
      grossPaise: sum(invoices, (i) => i.grossPaise),
      discountsPaise: sum(invoices, (i) => i.discountPaise),
      billedPaise,
      returnsPaise,
      netPaise: billedPaise - returnsPaise,
      cashPaise: paid("sale", "cash"),
      upiPaise: paid("sale", "upi"),
      creditPaise: ledgerOf("credit_sale"),
    },
    money: {
      cashInPaise: paid("sale", "cash") + paid("repayment", "cash"),
      upiInPaise: paid("sale", "upi") + paid("repayment", "upi"),
      repaidCashPaise: paid("repayment", "cash"),
      repaidUpiPaise: paid("repayment", "upi"),
      refundedCashPaise: paid("refund", "cash"),
      refundedUpiPaise: paid("refund", "upi"),
    },
    credit: {
      givenPaise: ledgerOf("credit_sale"),
      repaidPaise: ledgerOf("repayment"),
      cancelledByReturnsPaise: ledgerOf("credit_return"),
      outstandingPaise: totals(state, date).creditOutstandingPaise,
    },
    drawers,
    movements: movements.map((m) => ({
      at: m.occurredAt,
      name: nameOf(state, m.actorId),
      kind: m.kind,
      amountPaise: m.amountPaise,
      reason: m.reason,
    })),
    staff,
    cancelled: cancelledOrders.map((o) => ({
      orderId: o.id,
      at: o.cancelledAt!,
      name: nameOf(state, o.cancelledBy ?? o.collectorId),
      reason: o.cancelReason ?? "",
      valuePaise: orderValue(state, o),
    })),
    approvals: {
      approved: approvals.filter(
        (a) =>
          (a.status === "approved" || a.status === "used") &&
          onDate(a.decidedAt, date),
      ).length,
      declined: approvals.filter(
        (a) => a.status === "rejected" && onDate(a.decidedAt, date),
      ).length,
      waiting: approvals.filter((a) => a.status === "pending").length,
    },
    openReviews: Object.values(state.reviews).filter((r) => r.status === "open")
      .length,
    pendingDevices: Object.values(state.devices).filter(
      (d) => !d.revoked && d.pendingCount > 0,
    ).length,
  };
}

/** A new report revision for a day. Earlier revisions are never changed. */
export function eodSnapshot(
  state: State,
  date: string,
  now: string,
  extra: Partial<Eod> = {},
): Eod {
  const revision =
    Math.max(
      0,
      ...Object.values(state.eods)
        .filter((e) => e.date === date)
        .map((e) => e.revision),
    ) + 1;
  return {
    id: `${date}:${revision}`,
    date,
    revision,
    createdAt: now,
    totals: totals(state, date),
    report: dayReport(state, date, now),
    syncCutoffAt: now,
    syncCutoffRevision: state.revision + 1,
    provisional:
      Object.values(state.devices).some((d) => !d.revoked) ||
      Object.values(state.quarantine).some((q) => q.status === "pending"),
    ...extra,
  };
}

/** When the last thing was recorded on a day: a bill, payment, refund, cash movement, cancellation or drawer count. */
function lastRecordedOn(state: State, date: string) {
  return [
    ...Object.values(state.invoices).map((i) => i.occurredAt),
    ...Object.values(state.payments).map((p) => p.occurredAt),
    ...Object.values(state.refunds).map((r) => r.occurredAt),
    ...Object.values(state.ledger).map((l) => l.occurredAt),
    ...Object.values(state.cash).map((m) => m.occurredAt),
    ...Object.values(state.orders).map((o) => o.cancelledAt),
    ...Object.values(state.drawers).flatMap((d) => [
      d.openedAt,
      d.closedAt,
      ...(d.checks ?? []).map((c) => c.at),
    ]),
  ]
    .filter((at): at is string => onDate(at, date))
    .sort()
    .at(-1);
}

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * The reports made when the last drawer closes, one for each day the drawer was open that has
 * no report yet or has changed since its last one. A drawer closed after midnight still reports
 * the day before. Looks back at most 62 days.
 */
export function closingReports(
  state: State,
  from: string,
  to: string,
  now: string,
): Eod[] {
  const earliest = new Date(Date.parse(`${to}T00:00:00Z`) - 61 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const reports: Eod[] = [];
  for (
    let day = from < earliest ? earliest : from;
    day <= to;
    day = nextDay(day)
  ) {
    const last = lastRecordedOn(state, day);
    const latest = Object.values(state.eods)
      .filter((e) => e.date === day)
      .sort((a, b) => b.revision - a.revision)[0];
    if (!last || (latest && last <= (latest.syncCutoffAt ?? latest.createdAt)))
      continue;
    reports.push(eodSnapshot(state, day, now));
  }
  return reports;
}
