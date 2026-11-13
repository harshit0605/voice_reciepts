import { rupees } from "./money";
import { refundQuote, type ReturnLine } from "./returns";
import { differenceText } from "./report-html";
import type { Approval, State } from "./types";

/** "Credit ₹35.00 · Ramesh Kumar", "Return on bill 2627-004-000001 · ₹14.00". */
export function approvalSummary(state: State, a: Approval, hi: boolean) {
  const p = a.payload;
  const customer =
    state.customers[
      String(
        p.customerId ??
          state.orders[String(p.orderId)]?.customerId ??
          state.invoices[String(p.invoiceId)]?.customerId ??
          "",
      )
    ]?.name;
  if (a.kind === "refund") {
    const invoice = state.invoices[String(p.invoiceId)];
    let amount = "";
    try {
      amount = invoice
        ? ` · ${rupees(refundQuote(state, invoice, p.lines as ReturnLine[]).payablePaise)}`
        : "";
    } catch {
      amount = "";
    }
    return `${hi ? "वापसी · बिल" : "Return on bill"} ${invoice?.number ?? ""}${amount}`;
  }
  if (a.kind === "stock") return hi ? "स्टॉक बदलाव" : "Stock change";
  const what =
    a.kind === "credit" ? (hi ? "उधार" : "Credit") : hi ? "छूट" : "Discount";
  return `${what} ${rupees(Number(p.amountPaise))}${customer ? ` · ${customer}` : ""}`;
}

const hindiDifference = (paise: number) =>
  paise === 0
    ? "बराबर"
    : `${rupees(Math.abs(paise))} ${paise < 0 ? "कम" : "ज़्यादा"}`;

type Text = { title: string; body: string };
/** A phone notification for some people, in both languages, and the screen it opens. */
export type Notice = { to: string[]; en: Text; hi: Text; page: string };

/**
 * What changed that someone away from the counter must know: a request waiting for the owner,
 * the owner's answer to the person who asked, an order handed to a cashier, a drawer that did
 * not match, and the day's report. Nobody is told about their own action.
 */
export function noticesFor(
  before: State,
  after: State,
  actorId: string,
): Notice[] {
  const name = (id: string | undefined) =>
    (id && after.members[id]?.name) || "Someone";
  const owners = Object.values(after.members)
    .filter((m) => m.role === "owner" && m.active && m.id !== actorId)
    .map((m) => m.id);
  const notices: Notice[] = [];
  const add = (to: string[], en: Text, hi: Text, page: string) => {
    const people = to.filter((id) => id && id !== actorId);
    if (people.length) notices.push({ to: people, en, hi, page });
  };
  for (const a of Object.values(after.approvals)) {
    const was = before.approvals[a.id];
    if (!was && a.status === "pending")
      add(
        owners,
        {
          title: "Approval needed",
          body: `${name(a.requestedBy)}: ${approvalSummary(after, a, false)}`,
        },
        {
          title: "मंज़ूरी चाहिए",
          body: `${name(a.requestedBy)}: ${approvalSummary(after, a, true)}`,
        },
        "reviews",
      );
    else if (
      was?.status === "pending" &&
      (a.status === "approved" || a.status === "rejected")
    )
      add(
        [a.requestedBy],
        {
          title: a.status === "approved" ? "Owner approved" : "Owner declined",
          body: approvalSummary(after, a, false),
        },
        {
          title:
            a.status === "approved"
              ? "मालिक ने मंज़ूर किया"
              : "मालिक ने मना किया",
          body: approvalSummary(after, a, true),
        },
        "orders",
      );
  }
  for (const o of Object.values(after.orders)) {
    const was = before.orders[o.id];
    if (
      o.status === "handoff" &&
      o.offeredTo &&
      (was?.status !== "handoff" || was.offeredTo !== o.offeredTo)
    )
      add(
        [o.offeredTo],
        {
          title: "Order handed to you",
          body: `${name(o.collectorId)} handed you an order to collect`,
        },
        {
          title: "आपको ऑर्डर सौंपा गया",
          body: `${name(o.collectorId)} ने भुगतान लेने के लिए ऑर्डर सौंपा`,
        },
        "orders",
      );
  }
  for (const d of Object.values(after.drawers)) {
    const was = before.drawers[d.id];
    if (!was && d.openingDifferencePaise)
      add(
        owners,
        {
          title: `Drawer opened ${differenceText(d.openingDifferencePaise)}`,
          body: `${name(d.openedBy)} counted ${rupees(d.openingPaise)} against the cash left at the last close`,
        },
        {
          title: `दराज़ खुली · ${hindiDifference(d.openingDifferencePaise)}`,
          body: `${name(d.openedBy)} ने ${rupees(d.openingPaise)} गिने, पिछली बार छोड़ी नकदी से मिलान`,
        },
        "money",
      );
    if (d.closedAt && !was?.closedAt && d.discrepancyPaise)
      add(
        owners,
        {
          title: `Drawer closed ${differenceText(d.discrepancyPaise)}`,
          body: `${name(d.closedBy)} counted ${rupees(d.countedPaise ?? 0)}`,
        },
        {
          title: `दराज़ बंद · ${hindiDifference(d.discrepancyPaise)}`,
          body: `${name(d.closedBy)} ने ${rupees(d.countedPaise ?? 0)} गिने`,
        },
        "money",
      );
  }
  for (const e of Object.values(after.eods)) {
    if (before.eods[e.id] || e.revision !== 1 || !e.report) continue;
    const drawer = e.report.drawers.at(-1)?.differencePaise;
    add(
      owners,
      {
        title: `Day report ready · ${e.date}`,
        body: `Net sales ${rupees(e.report.sales.netPaise)}${drawer !== undefined ? ` · drawer ${differenceText(drawer)}` : ""}`,
      },
      {
        title: `दिन की रिपोर्ट तैयार · ${e.date}`,
        body: `शुद्ध बिक्री ${rupees(e.report.sales.netPaise)}${drawer !== undefined ? ` · दराज़ ${hindiDifference(drawer)}` : ""}`,
      },
      "money",
    );
  }
  return notices;
}

/**
 * The owner's phone notification when the shop PC (gateway) stops reporting, and when it is back.
 * The gateway prints receipts and keeps the second copy of offline sales, so a long silence is
 * worth a call to the shop. `minutes` is how long it has been quiet (silent) or how long the
 * outage lasted (back). Both are for owners only; the worker decides when to send them.
 */
export function gatewayNotices(
  state: State,
  kind: "silent" | "back",
  minutes: number,
): Notice[] {
  const owners = Object.values(state.members)
    // The gateway's own service account is an owner too but has no phone.
    .filter(
      (m) => m.role === "owner" && m.active && !m.id.startsWith("service:"),
    )
    .map((m) => m.id);
  if (!owners.length) return [];
  const mins = Math.max(1, Math.round(minutes));
  return kind === "silent"
    ? [
        {
          to: owners,
          en: {
            title: "Shop PC is not responding",
            body: `No signal for ${mins} minutes. Receipt printing and the backup copy of offline sales may be down. Check the PC and its internet.`,
          },
          hi: {
            title: "दुकान का PC जवाब नहीं दे रहा",
            body: `${mins} मिनट से कोई संकेत नहीं। रसीद छपाई और ऑफ़लाइन बिक्री की बैकअप कॉपी बंद हो सकती है। PC और इंटरनेट देखें।`,
          },
          page: "reviews",
        },
      ]
    : [
        {
          to: owners,
          en: {
            title: "Shop PC is back",
            body: `It was silent for about ${mins} minutes and is reporting again.`,
          },
          hi: {
            title: "दुकान का PC फिर चालू",
            body: `लगभग ${mins} मिनट बंद रहने के बाद फिर से संकेत आ रहा है।`,
          },
          page: "reviews",
        },
      ];
}
