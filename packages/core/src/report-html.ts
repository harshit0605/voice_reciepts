import { rupees } from "./money";
import type { DayReport } from "./drawer";

const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const time = (at?: string) =>
  at
    ? new Date(at).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
/** "12:11 pm", or "23 Sept, 12:11 pm" when the drawer opened on an earlier day. */
const opened = (at: string, date: string) => {
  const day = new Date(Date.parse(at) + 330 * 60_000)
    .toISOString()
    .slice(0, 10);
  return day === date
    ? time(at)
    : `${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}, ${time(at)}`;
};
/** "₹50 short", "₹20 over", "matches". */
export function differenceText(paise: number | undefined) {
  if (paise === undefined) return "not counted";
  if (paise === 0) return "matches";
  return `${rupees(Math.abs(paise))} ${paise < 0 ? "short" : "over"}`;
}
const MOVE: Record<string, string> = {
  withdrawal: "Paid out",
  safe_transfer: "Taken to safe",
  introduced: "Put in",
};

/** The day report as a page to share as a PDF. */
export function dayReportHtml(
  report: DayReport,
  shop: string,
  revision?: number,
  provisional?: boolean,
) {
  const row = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ""}><td>${escape(label)}</td><td>${escape(value)}</td></tr>`;
  const day = new Date(`${report.date}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const s = report.sales,
    m = report.money,
    c = report.credit;
  const drawers = report.drawers
    .map(
      (d) =>
        `<h3>Drawer · opened ${opened(d.openedAt, report.date)} by ${escape(d.openedBy)}</h3><table>${[
          row("Opening cash", rupees(d.openingPaise)),
          ...(d.openingDifferencePaise
            ? [
                row(
                  "Against cash left at last close",
                  differenceText(d.openingDifferencePaise),
                ),
              ]
            : []),
          row(
            d.closedAt ? "Should have held at close" : "Should hold now",
            rupees(d.expectedPaise),
          ),
          ...(d.countedPaise !== undefined
            ? [
                row(
                  `Counted at ${time(d.closedAt)} by ${d.closedBy ?? ""}`,
                  rupees(d.countedPaise),
                ),
                row("Difference", differenceText(d.differencePaise), true),
              ]
            : [row("Closed", "Not yet")]),
          ...(d.keptPaise !== undefined
            ? [row("Left in drawer for next opening", rupees(d.keptPaise))]
            : []),
          ...(d.lateChangePaise
            ? [
                row(
                  "Changed after close by late sales",
                  rupees(d.lateChangePaise),
                ),
              ]
            : []),
          ...d.checks.map((k) =>
            row(
              `Check at ${time(k.at)} by ${k.name}: counted ${rupees(k.countedPaise)}`,
              differenceText(k.differencePaise),
            ),
          ),
        ].join("")}</table>`,
    )
    .join("");
  const staff = report.staff
    .map(
      (p) =>
        `<tr><td>${escape(p.name)}</td><td>${p.bills}</td><td>${escape(rupees(p.salesPaise))}</td><td>${escape(rupees(p.cashInPaise))}</td><td>${escape(rupees(p.upiInPaise))}</td><td>${escape(rupees(p.creditGivenPaise))}</td><td>${escape(rupees(p.discountsPaise))}</td><td>${escape(rupees(p.refundsPaise))}</td><td>${p.cancelled}</td><td>${escape(rupees(p.cashOutPaise))}</td></tr>`,
    )
    .join("");
  const moves = report.movements
    .map(
      (v) =>
        `<tr><td>${time(v.at)}</td><td>${escape(v.name)}</td><td>${escape(MOVE[v.kind] ?? v.kind)}</td><td>${escape(rupees(v.amountPaise))}</td><td>${escape(v.reason)}</td></tr>`,
    )
    .join("");
  const cancelled = report.cancelled
    .map(
      (o) =>
        `<tr><td>${time(o.at)}</td><td>${escape(o.name)}</td><td>${escape(rupees(o.valuePaise))}</td><td>${escape(o.reason)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{font:12px sans-serif;color:#111;margin:28px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}h3{font-size:13px;margin:14px 0 4px}p{margin:4px 0;color:#555}table{width:100%;border-collapse:collapse}td,th{padding:4px 6px 4px 0;text-align:left;vertical-align:top;border-bottom:1px dashed #e2e2e2}td:last-child,th:last-child{text-align:right}.strong td{font-weight:bold}.grid td:not(:first-child),.grid th:not(:first-child){text-align:right}.note{margin-top:18px;font-size:10px;color:#666}</style></head><body><h1>${escape(shop)} · End of day</h1><p>${escape(day)}${revision ? ` · revision ${revision}` : ""}${provisional ? " · waiting for phones to sync" : ""}</p><h2>Sales</h2><table>${[
    row("Bills", String(s.bills)),
    row("Billed after discounts", rupees(s.billedPaise)),
    row("Discounts given", rupees(s.discountsPaise)),
    row("Returns", rupees(s.returnsPaise)),
    row("Net sales", rupees(s.netPaise), true),
    row("Paid in cash", rupees(s.cashPaise)),
    row("Paid by UPI", rupees(s.upiPaise)),
    row("On credit", rupees(s.creditPaise)),
  ].join("")}</table><h2>Money</h2><table>${[
    row("Cash taken (sales and repayments)", rupees(m.cashInPaise)),
    row("UPI taken (sales and repayments)", rupees(m.upiInPaise)),
    row("Credit repaid in cash", rupees(m.repaidCashPaise)),
    row("Credit repaid by UPI", rupees(m.repaidUpiPaise)),
    row("Refunded in cash", rupees(m.refundedCashPaise)),
    row("Refunded by UPI", rupees(m.refundedUpiPaise)),
  ].join(
    "",
  )}</table><h2>Cash drawer</h2>${drawers || "<p>No drawer was used.</p>"}${
    moves
      ? `<h3>Cash put in and taken out</h3><table class="grid"><tr><th>Time</th><th>By</th><th>What</th><th>Amount</th><th>Reason</th></tr>${moves}</table>`
      : ""
  }<h2>Staff</h2>${
    staff
      ? `<table class="grid"><tr><th>Name</th><th>Bills</th><th>Sales</th><th>Cash</th><th>UPI</th><th>Credit</th><th>Discount</th><th>Refunds</th><th>Cancelled</th><th>Paid out</th></tr>${staff}</table>`
      : "<p>No staff activity.</p>"
  }${
    cancelled
      ? `<h2>Cancelled orders</h2><table class="grid"><tr><th>Time</th><th>By</th><th>Value</th><th>Reason</th></tr>${cancelled}</table>`
      : ""
  }<h2>Customer credit</h2><table>${[
    row("New credit given", rupees(c.givenPaise)),
    row("Repaid", rupees(c.repaidPaise)),
    row("Cancelled by returns", rupees(c.cancelledByReturnsPaise)),
    row("Owed by customers at end of day", rupees(c.outstandingPaise), true),
  ].join("")}</table><h2>Needs attention</h2><table>${[
    row("Approvals given today", String(report.approvals.approved)),
    row("Approvals declined today", String(report.approvals.declined)),
    row("Requests still waiting", String(report.approvals.waiting)),
    row("Open exceptions", String(report.openReviews)),
    row("Phones with unsent sales", String(report.pendingDevices)),
  ].join(
    "",
  )}</table><p class="note">A drawer difference belongs to the shared drawer. It does not by itself show who is responsible. Generated ${escape(new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}.</p></body></html>`;
}
