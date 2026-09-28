import Decimal from "decimal.js";
import { D, round } from "./money";
import type { Approval, Invoice, State } from "./types";

export type ReturnLine = { index: number; quantity: string };

/** Base units of each bill line already refunded. */
export function returnedQuantities(state: State, invoiceId: string) {
  const returned = new Map<number, Decimal>();
  for (const refund of Object.values(state.refunds))
    if (refund.invoiceId === invoiceId)
      for (const l of refund.lines)
        returned.set(l.index, (returned.get(l.index) ?? D(0)).plus(l.quantity));
  return returned;
}

/** Per bill line: what was sold, what came back already, and what can still come back. */
export function returnable(state: State, invoice: Invoice) {
  const returned = returnedQuantities(state, invoice.id);
  return invoice.lines.map((line, index) => {
    const back = returned.get(index) ?? D(0);
    return {
      index,
      line,
      sold: D(line.baseQuantity),
      returned: back,
      remaining: D(line.baseQuantity).minus(back),
    };
  });
}

/** What the customer still owes on this bill (credit sales less repayments and earlier returns). */
export function billDue(state: State, invoiceId: string) {
  return Math.max(
    0,
    Object.values(state.ledger)
      .filter((l) => l.invoiceId === invoiceId)
      .reduce((n, l) => n + l.amountPaise, 0),
  );
}

/**
 * The money a return is worth. Each line is valued at its share of what the customer paid for
 * that line (after discount), counted from what came back before so rounding never pays out a
 * line twice. Anything the customer still owes on the bill is cancelled first; only the rest
 * is handed back.
 */
export function refundQuote(
  state: State,
  invoice: Invoice,
  lines: ReturnLine[],
) {
  if (!lines.length) throw new Error("Choose what came back");
  const returned = returnedQuantities(state, invoice.id);
  const seen = new Set<number>();
  let totalPaise = 0;
  const priced = lines.map((l) => {
    if (seen.has(l.index)) throw new Error("Duplicate return line");
    seen.add(l.index);
    const original = invoice.lines[l.index];
    if (!original) throw new Error("Return line missing");
    const quantity = D(l.quantity);
    if (!quantity.gt(0))
      throw new Error("Returned quantity must be more than zero");
    const before = returned.get(l.index) ?? D(0);
    if (before.plus(quantity).gt(original.baseQuantity))
      throw new Error("Return exceeds quantity sold");
    const value = (q: Decimal) =>
      round(D(original.netPaise).mul(q).div(original.baseQuantity));
    const amountPaise = value(before.plus(quantity)) - value(before);
    totalPaise += amountPaise;
    return { ...l, amountPaise };
  });
  const creditReductionPaise = Math.min(billDue(state, invoice.id), totalPaise);
  return {
    lines: priced,
    totalPaise,
    creditReductionPaise,
    payablePaise: totalPaise - creditReductionPaise,
  };
}

/**
 * A quantity entered in a sale unit ("1 strip") as base units ("10"), for a bill line.
 * Uses the product's current pack sizes, or the bill line's own when the product is gone.
 */
export function returnBaseQuantity(
  state: State,
  invoice: Invoice,
  index: number,
  quantity: string,
  unit: string,
) {
  const line = invoice.lines[index];
  if (!line) throw new Error("Return line missing");
  if (!/^\d+(\.\d{1,3})?$/.test(quantity.trim()))
    throw new Error("Enter the returned quantity");
  const units = returnUnits(state, invoice, index);
  const factor = units[unit];
  if (!factor) throw new Error("Choose the returned unit");
  const base = D(quantity.trim()).mul(factor);
  const product = state.products[line.productId];
  const measured = ["g", "kg", "ml", "l"].includes(
    (product?.baseUnit ?? "").toLowerCase(),
  );
  if (!measured && !base.isInteger())
    throw new Error("Returned quantity must be whole units");
  return base.toFixed();
}

/** Units a bill line can be returned in, as base units per unit. */
export function returnUnits(state: State, invoice: Invoice, index: number) {
  const line = invoice.lines[index];
  const product = line && state.products[line.productId];
  if (product) return product.units;
  if (!line) return {};
  const perUnit = D(line.baseQuantity).div(line.quantity);
  return { [line.unit]: perUnit.toFixed() };
}

/** A refund request that has not been executed or turned down yet. */
export const openRefundRequest = (a: Approval, invoiceId: string) =>
  a.kind === "refund" &&
  (a.status === "pending" || a.status === "approved") &&
  a.payload.invoiceId === invoiceId;
