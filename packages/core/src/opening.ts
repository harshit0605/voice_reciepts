import { D, rupees } from "./money";
import type { Batch, Product } from "./types";
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const monthEnd = (y: number, m: number) =>
  iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
/**
 * Expiry as printed on the pack: "04/27", "04/2027", "APR-27", "Apr 2027",
 * "30/04/2027" or "2027-04-30". A month-only expiry means the last day of that month.
 */
export function parseExpiry(input: string): string | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^exp\.?\s*/, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const out = iso(+m[1], +m[2], +m[3]);
    return !Number.isNaN(Date.parse(out)) &&
      new Date(out).toISOString().slice(0, 10) === out
      ? out
      : null;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const out = iso(fullYear(m[3]), +m[2], +m[1]);
    return +m[2] >= 1 &&
      +m[2] <= 12 &&
      new Date(out).toISOString().slice(0, 10) === out
      ? out
      : null;
  }
  m = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return monthEnd(fullYear(m[2]), +m[1]);
  m = /^([a-z]{3})[a-z]*\s*[/.\-' ]?\s*(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS[m[1]]) return monthEnd(fullYear(m[2]), MONTHS[m[1]]);
  return null;
}
export type CountInput = {
  code: string;
  expiry: string;
  quantity: string;
  unit: string;
  mrp: string;
  /** Unit the MRP, selling price and cost are entered for (usually the strip). */
  priceUnit: string;
  price: string;
  cost: string;
};
const paise = (value: string, what: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error(`Enter the ${what} in rupees, up to two decimals`);
  return D(value.trim()).mul(100);
};
/** The shelf count of one batch as a `stock.opening` batch, in base units and whole paise. */
export function openingCount(
  input: CountInput,
  product: Product,
  existing: Batch[],
  today: string,
  id: string,
) {
  const notes: string[] = [];
  const code = input.code.trim();
  if (!code) throw new Error("Enter the batch number printed on the pack");
  if (code.length > 80) throw new Error("Batch number is too long");
  if (
    existing.some(
      (b) =>
        b.productId === product.id &&
        b.code.trim().toUpperCase() === code.toUpperCase(),
    )
  )
    throw new Error(
      "This batch is already in stock. Use a stock adjustment to correct its count.",
    );
  const expiry = parseExpiry(input.expiry);
  if (!expiry)
    throw new Error("Enter the expiry as printed, for example 04/27");
  if (expiry < today)
    throw new Error(
      "This batch has expired. Keep it aside for return or disposal; it is not added as sellable stock.",
    );
  const soon = new Date(Date.parse(today) + 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (expiry <= soon) notes.push("Expires within 3 months");
  const factor = product.units[input.unit];
  const priceFactor = product.units[input.priceUnit];
  if (!factor || !priceFactor)
    throw new Error("Choose the counted unit and price unit");
  if (!/^\d+(\.\d{1,3})?$/.test(input.quantity.trim()))
    throw new Error("Enter the counted quantity");
  const base = D(input.quantity.trim()).mul(factor);
  if (base.lte(0)) throw new Error("Counted quantity must be more than zero");
  if (base.gt(999_999_999)) throw new Error("Counted quantity is too large");
  const measured = ["g", "kg", "ml", "l"].includes(
    product.baseUnit.toLowerCase(),
  );
  if (!measured && !base.isInteger())
    throw new Error(`Count whole ${product.baseUnit}s`);
  if (base.decimalPlaces() > 3)
    throw new Error("Counted quantity is too precise");
  // Never above the printed MRP: a per-unit price that is not a whole number of paise rounds down.
  const perBase = (value: ReturnType<typeof D>) => {
    const v = value.div(priceFactor);
    return { paise: v.floor().toNumber(), rounded: !v.isInteger() };
  };
  const mrp = perBase(paise(input.mrp, "MRP"));
  if (mrp.paise <= 0) throw new Error("Enter the MRP printed on the pack");
  const price = input.price.trim()
    ? perBase(paise(input.price, "selling price"))
    : mrp;
  if (price.paise > mrp.paise)
    throw new Error("Selling price cannot be more than MRP");
  if (price.paise <= 0) throw new Error("Selling price must be more than zero");
  const cost = input.cost.trim()
    ? perBase(paise(input.cost, "purchase cost"))
    : undefined;
  if (priceFactor !== "1" && (mrp.rounded || price.rounded))
    notes.push(
      `Price per ${product.baseUnit} rounded down to whole paise, so a full ${input.priceUnit} is billed at ${rupees(price.paise * Number(priceFactor))}`,
    );
  const batch: Batch = {
    id,
    productId: product.id,
    code,
    expiry,
    quantity: base.toFixed(),
    quarantined: "0",
    pricePaise: price.paise,
    mrpPaise: mrp.paise,
    costPaise: cost?.paise,
    verifiedCost: cost !== undefined,
  };
  return { batch, notes };
}
/** The unit MRP is printed for and shelves are counted in: the strip when there is one. */
export function packUnit(product: Product) {
  return product.units.strip ? "strip" : product.baseUnit;
}
