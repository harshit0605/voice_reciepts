import type { Invoice, Payment } from "./types";
import { rupees } from "./money";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** PDF page in points (1/72 inch). */
export type ReceiptPage = { width: number; height: number };
export type ReceiptExtras = {
  /** Size the page like a paper receipt, for the PDF a customer is sent. */
  page?: ReceiptPage;
  customerName?: string;
  /** Payments recorded against this bill; without them the receipt says nothing about payment. */
  payments?: Pick<Payment, "method" | "amountPaise" | "kind">[];
};
const PAGE_WIDTH = 300;
// Layout in CSS pixels (96 per inch); the page is in points (72 per inch).
const PX = 0.75;
const CHARS_PER_LINE = 44;
const rows = (text: string, chars = CHARS_PER_LINE) =>
  Math.max(1, Math.ceil(text.length / chars));
/**
 * A narrow page as tall as the bill, so a shared PDF reads like the paper receipt instead of
 * a mostly blank letter page. Generous by a few lines: blank space is better than a second page.
 */
export function receiptPage(
  invoice: Invoice,
  extras: Omit<ReceiptExtras, "page"> = {},
): ReceiptPage {
  let px = 40 + 30 + rows(invoice.business.address) * 18 + 2 * 16 + 20;
  px += 2 * 20 + (extras.customerName ? 20 : 0);
  for (const l of invoice.lines)
    px += 12 + rows(`${l.name} ${l.strength}`, 34) * 18 + 3 * 15;
  px += 3 * 20 + 44 + (extras.payments?.length ? 20 : 0) + 70;
  return { width: PAGE_WIDTH, height: Math.ceil((px + 30) * PX) };
}
function paymentLine(invoice: Invoice, payments: ReceiptExtras["payments"]) {
  const sale = (payments ?? []).filter((p) => p.kind === "sale");
  if (!sale.length) return "";
  const paid = sale.reduce((n, p) => n + p.amountPaise, 0);
  const methods = [
    ...new Set(sale.map((p) => (p.method === "upi" ? "UPI" : "cash"))),
  ];
  const due = invoice.totalPaise - paid;
  return `Paid ${rupees(paid)} by ${methods.join(" and ")}${due > 0 ? ` · Balance due ${rupees(due)}` : ""}`;
}
export function receiptHtml(
  invoice: Invoice,
  reprint = false,
  extras: ReceiptExtras = {},
): string {
  const business = invoice.business;
  const page = extras.page
    ? `@page{size:${extras.page.width}pt ${extras.page.height}pt;margin:0}html,body{margin:0}body{max-width:none;padding:20px 22px}`
    : "@media print{body{margin:0 auto}}";
  const payment = paymentLine(invoice, extras.payments);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:12px sans-serif;color:#111;max-width:300px;margin:16px auto}h1{font-size:18px;margin:0}p{margin:5px 0}table{width:100%;border-collapse:collapse}td{padding:6px 0;vertical-align:top;border-bottom:1px dashed #ccc}td:last-child{text-align:right;white-space:nowrap;padding-left:8px}small{font-size:10px}.total{font-size:18px;font-weight:bold;padding:10px 0}footer{margin-top:20px;text-align:center}${page}</style></head><body><h1>${escape(business.name)}</h1><p>${escape(business.address)}</p><small>GSTIN ${escape(business.gstin)}<br>Drug licence ${escape(business.drugLicence)}</small><hr><p>Tax invoice ${escape(invoice.number)} ${reprint ? "· COPY" : ""}</p><p>${escape(new Date(invoice.occurredAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</p>${extras.customerName ? `<p>Customer: ${escape(extras.customerName)}</p>` : ""}<table>${invoice.lines.map((l) => `<tr><td>${escape(l.name)} ${escape(l.strength)}<br><small>${escape(l.quantity)} ${escape(l.unit)} · Batch ${escape(l.batchCode)}<br>Exp ${escape(l.expiry)} · HSN ${escape(l.hsn)}<br>GST ${l.taxBps / 100}%</small></td><td>${escape(rupees(l.netPaise))}</td></tr>`).join("")}</table><p>Discount ${escape(rupees(invoice.discountPaise))}</p><p>Taxable value ${escape(rupees(invoice.totalPaise - invoice.taxPaise))}</p><p>CGST ${escape(rupees(invoice.lines.reduce((n, l) => n + l.cgstPaise, 0)))} · SGST ${escape(rupees(invoice.lines.reduce((n, l) => n + l.sgstPaise, 0)))}</p><div class="total">Total ${escape(rupees(invoice.totalPaise))}</div>${payment ? `<p>${escape(payment)}</p>` : extras.page ? "" : "<p>Payment details are recorded separately.</p>"}<footer>Thank you for visiting.<br>Keep this bill for your records.</footer></body></html>`;
}
