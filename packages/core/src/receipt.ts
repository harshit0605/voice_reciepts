import type { Invoice } from "./types";
import { rupees } from "./money";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function receiptHtml(invoice: Invoice, reprint = false): string {
  const business = invoice.business;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:12px sans-serif;color:#111;max-width:300px;margin:16px auto}h1{font-size:18px;margin:0}p{margin:5px 0}table{width:100%;border-collapse:collapse}td{padding:6px 0;vertical-align:top;border-bottom:1px dashed #ccc}td:last-child{text-align:right}small{font-size:10px}.total{font-size:18px;font-weight:bold;padding:10px 0}footer{margin-top:20px;text-align:center}@media print{body{margin:0}}</style></head><body><h1>${escape(business.name)}</h1><p>${escape(business.address)}</p><small>GSTIN ${escape(business.gstin)}<br>Drug licence ${escape(business.drugLicence)}</small><hr><p>Tax invoice ${escape(invoice.number)} ${reprint ? "· COPY" : ""}</p><p>${escape(new Date(invoice.occurredAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</p><table>${invoice.lines.map((l) => `<tr><td>${escape(l.name)} ${escape(l.strength)}<br><small>${escape(l.quantity)} ${escape(l.unit)} · Batch ${escape(l.batchCode)}<br>Exp ${escape(l.expiry)} · HSN ${escape(l.hsn)}<br>GST ${l.taxBps / 100}%</small></td><td>${escape(rupees(l.netPaise))}</td></tr>`).join("")}</table><p>Discount ${escape(rupees(invoice.discountPaise))}</p><p>Taxable value ${escape(rupees(invoice.totalPaise - invoice.taxPaise))}</p><p>CGST ${escape(rupees(invoice.lines.reduce((n, l) => n + l.cgstPaise, 0)))} · SGST ${escape(rupees(invoice.lines.reduce((n, l) => n + l.sgstPaise, 0)))}</p><div class="total">Total ${escape(rupees(invoice.totalPaise))}</div><p>Payment details are recorded separately.</p><footer>Thank you for visiting.<br>Keep this bill for your records.</footer></body></html>`;
}
