import Decimal from "decimal.js";
import type { State, InvoiceLine, OrderLine, ReturnTypeTotals } from "./types";
export const D = (v: Decimal.Value) => new Decimal(v);
export function integer(v: Decimal.Value): number {
  const d = D(v);
  if (!d.isInteger() || d.abs().gt(Number.MAX_SAFE_INTEGER))
    throw new Error("Unsafe money value");
  // Never -0: it would print as "-₹0.00".
  return d.toNumber() || 0;
}
/** Base units that are measured rather than counted, so a fraction can be sold. */
export const MEASURED_UNITS = new Set([
  "ml",
  "l",
  "litre",
  "liter",
  "g",
  "gm",
  "gram",
  "kg",
  "mg",
  "mcg",
  "cm",
  "m",
  "metre",
  "meter",
]);
export const round = (v: Decimal.Value) =>
  integer(D(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
export function indiaDate(at: string): string {
  return new Date(Date.parse(at) + 330 * 60_000).toISOString().slice(0, 10);
}
export function fiscalYear(at: string): string {
  const date = indiaDate(at);
  const year =
    Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0);
  return `${String(year).slice(2)}${String(year + 1).slice(2)}`;
}
export const invoiceNumber = (at: string, series: string, sequence: number) =>
  `${fiscalYear(at)}-${series}-${String(sequence).padStart(6, "0")}`;
export function quote(
  state: State,
  lines: OrderLine[],
  at: string,
  discountPaise = 0,
  override?: { pricePaise: number; taxBps: number }[],
): InvoiceLine[] {
  const gross = lines.map((line, i) => {
    const batch = state.batches[line.batchId];
    if (!batch) throw new Error("Batch not found");
    const p = state.products[batch.productId];
    if (!p?.active) throw new Error("Product unavailable");
    if (batch.expiry < indiaDate(at))
      throw new Error("Expired batch cannot be sold");
    if (!line.confirmed) throw new Error("Confirm the physical batch");
    const multiplier = p.units[line.unit];
    if (!multiplier) throw new Error("Unknown selling unit");
    const base = D(line.quantity).mul(multiplier);
    if (p.baseUnit === "tablet" && !base.isInteger())
      throw new Error("Tablets must be whole units");
    // A bottle, tube or piece cannot be split at the counter; only measured units (ml, g) can.
    if (
      !MEASURED_UNITS.has(p.baseUnit.trim().toLowerCase()) &&
      !base.isInteger()
    )
      throw new Error("This medicine is sold in whole units");
    const price = override?.[i]?.pricePaise ?? batch.pricePaise;
    if (price > batch.mrpPaise) throw new Error("Selling price exceeds MRP");
    return {
      line,
      batch,
      p,
      base,
      price,
      tax: override?.[i]?.taxBps ?? p.taxBps,
      gross: round(base.mul(price)),
    };
  });
  const total = gross.reduce((n, l) => n + l.gross, 0);
  if (discountPaise > total) throw new Error("Discount exceeds sale");
  if (discountPaise < 0) throw new Error("Discount cannot be negative");
  // Floor each line's share, then put the leftover paise on the last line, carrying whatever a
  // line cannot take (its discount may never exceed its gross) back to the lines before it.
  const shares = gross.map((x) =>
    Math.floor((discountPaise * x.gross) / Math.max(1, total)),
  );
  let left = discountPaise - shares.reduce((n, v) => n + v, 0);
  for (let i = shares.length - 1; i >= 0 && left > 0; i--) {
    const add = Math.min(left, gross[i].gross - shares[i]);
    shares[i] += add;
    left -= add;
  }
  return gross.map((x, i) => {
    const discount = shares[i];
    const net = x.gross - discount;
    const tax = round(
      D(net)
        .mul(x.tax)
        .div(10000 + x.tax),
    );
    const cgst = Math.floor(tax / 2);
    return {
      ...x.line,
      productId: x.p.id,
      name: x.p.name,
      strength: x.p.strength,
      form: x.p.form,
      hsn: x.p.hsn,
      batchCode: x.batch.code,
      expiry: x.batch.expiry,
      baseQuantity: x.base.toFixed(),
      pricePaise: x.price,
      taxBps: x.tax,
      grossPaise: x.gross,
      discountPaise: discount,
      netPaise: net,
      taxPaise: tax,
      cgstPaise: cgst,
      sgstPaise: tax - cgst,
      ...(x.batch.verifiedCost && x.batch.costPaise !== undefined
        ? { costPaise: round(x.base.mul(x.batch.costPaise)) }
        : {}),
    };
  });
}
export function balance(state: State, customerId: string): number {
  return Object.values(state.ledger)
    .filter((l) => l.customerId === customerId)
    .reduce((n, l) => n + l.amountPaise, 0);
}
export function expectedCash(state: State, drawerId: string): number {
  const drawer = state.drawers[drawerId];
  if (!drawer) throw new Error("Drawer not found");
  return (
    drawer.openingPaise +
    Object.values(state.payments)
      .filter((p) => p.drawerId === drawerId && p.method === "cash")
      .reduce(
        (n, p) => n + (p.kind === "refund" ? -p.amountPaise : p.amountPaise),
        0,
      ) +
    Object.values(state.cash)
      .filter((m) => m.drawerId === drawerId)
      .reduce(
        (n, m) =>
          n + (m.kind === "introduced" ? m.amountPaise : -m.amountPaise),
        0,
      )
  );
}
export function totals(state: State, date?: string): ReturnTypeTotals {
  const invoices = Object.values(state.invoices).filter(
    (i) => !date || indiaDate(i.occurredAt) === date,
  );
  const payments = Object.values(state.payments).filter(
    (p) => !date || indiaDate(p.occurredAt) === date,
  );
  const refunds = Object.values(state.refunds).filter(
    (r) => !date || indiaDate(r.occurredAt) === date,
  );
  const refundTotal = refunds.reduce((n, r) => n + r.totalPaise, 0);
  const allCost = invoices.every((i) =>
    i.lines.every((l) => l.costPaise !== undefined),
  );
  return {
    netSalesPaise: invoices.reduce((n, i) => n + i.totalPaise, 0) - refundTotal,
    cashCollectedPaise: payments
      .filter((p) => p.method === "cash")
      .reduce(
        (n, p) => n + (p.kind === "refund" ? -p.amountPaise : p.amountPaise),
        0,
      ),
    upiCollectedPaise: payments
      .filter((p) => p.method === "upi")
      .reduce(
        (n, p) => n + (p.kind === "refund" ? -p.amountPaise : p.amountPaise),
        0,
      ),
    creditOutstandingPaise: Object.values(state.ledger)
      .filter((l) => !date || indiaDate(l.occurredAt) <= date)
      .reduce((n, l) => n + l.amountPaise, 0),
    refundsPaise: refundTotal,
    discountsPaise: invoices.reduce((n, i) => n + i.discountPaise, 0),
    estimatedGrossMarginPaise:
      allCost && refunds.length === 0
        ? invoices.reduce(
            (n, i) =>
              n +
              i.totalPaise -
              i.taxPaise -
              i.lines.reduce((m, l) => m + (l.costPaise ?? 0), 0),
            0,
          )
        : null,
    invoiceCount: invoices.length,
    pendingDevices: Object.values(state.devices).filter(
      (d) =>
        !d.revoked &&
        (d.pendingCount > 0 || Date.now() - Date.parse(d.lastSeen) > 120000),
    ).length,
  };
}
export function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
