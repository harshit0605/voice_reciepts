import { D, round } from "./money";
import type { Batch, Product, State } from "./types";

export type ExpiryGroup = "expired" | "within30" | "within90";
export type ExpiryRow = {
  batch: Batch;
  product: Product;
  group: ExpiryGroup;
  /** Whole days from today to the last valid day; negative once expired. */
  daysLeft: number;
  /** Sellable quantity in the product's base unit. */
  quantity: string;
  /** Quantity at the recorded cost; undefined when this batch has no cost. */
  costValuePaise?: number;
  mrpValuePaise: number;
};
const DAY = 86_400_000;
const days = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY,
  );

/**
 * Batches still holding sellable stock that are expired or expire within 90 days, soonest first.
 * `today` is the shop's date (India); a batch is valid through its expiry date, so it counts as
 * expired from the day after.
 */
export function expiryRows(
  state: Pick<State, "batches" | "products">,
  today: string,
): ExpiryRow[] {
  const rows: ExpiryRow[] = [];
  for (const batch of Object.values(state.batches)) {
    const product = state.products[batch.productId];
    if (!product || !D(batch.quantity).gt(0)) continue;
    const daysLeft = days(today, batch.expiry);
    if (daysLeft > 90) continue;
    rows.push({
      batch,
      product,
      group:
        daysLeft < 0 ? "expired" : daysLeft <= 30 ? "within30" : "within90",
      daysLeft,
      quantity: batch.quantity,
      costValuePaise:
        batch.costPaise === undefined
          ? undefined
          : round(D(batch.quantity).mul(batch.costPaise)),
      mrpValuePaise: round(D(batch.quantity).mul(batch.mrpPaise)),
    });
  }
  return rows.sort(
    (a, b) =>
      a.batch.expiry.localeCompare(b.batch.expiry) ||
      a.product.name.localeCompare(b.product.name) ||
      a.batch.code.localeCompare(b.batch.code),
  );
}
export const sumCostValue = (rows: ExpiryRow[]) =>
  rows.reduce((n, r) => n + (r.costValuePaise ?? 0), 0);
