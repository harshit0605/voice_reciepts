import { D } from "./money";
import type { Batch, Product, State } from "./types";
/** Comparable code: GTIN-14 "0…" and EAN-13 of the same pack match. */
export function normalCode(code: string) {
  const c = code.trim().toUpperCase();
  return /^\d+$/.test(c) ? c.replace(/^0+(?=\d{8,}$)/, "") : c;
}
/** A product may carry several pack barcodes, separated by commas or spaces. */
export function barcodesOf(product: Pick<Product, "barcode">) {
  return product.barcode
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(normalCode);
}
export type Scan = {
  code: string;
  gtin?: string;
  batch?: string;
  expiry?: string;
};
const GS = "\u001d";
const fixed: Record<string, number> = {
  "00": 18,
  "01": 14,
  "02": 14,
  "11": 6,
  "12": 6,
  "13": 6,
  "15": 6,
  "16": 6,
  "17": 6,
  "20": 2,
};
const variable = [
  "10",
  "21",
  "22",
  "30",
  "37",
  "90",
  "240",
  "241",
  "250",
  "251",
];
function gs1Date(v: string) {
  if (!/^\d{6}$/.test(v)) return undefined;
  const year = 2000 + Number(v.slice(0, 2)),
    month = Number(v.slice(2, 4));
  let day = Number(v.slice(4, 6));
  if (month < 1 || month > 12) return undefined;
  // GS1 day 00 means the last day of the month.
  if (day === 0) day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function fields(raw: string): Record<string, string> | null {
  const human = [...raw.matchAll(/\((\d{2,4})\)([^(]*)/g)];
  if (human.length && raw.trimStart().startsWith("("))
    return Object.fromEntries(human.map(([, ai, v]) => [ai, v.trim()]));
  let s = raw.replace(/^\][A-Za-z]\d/, "");
  if (s.startsWith(GS)) s = s.slice(1);
  if (!/^01\d{14}/.test(s)) return null;
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    const two = s.slice(i, i + 2),
      three = s.slice(i, i + 3);
    if (fixed[two]) {
      out[two] = s.slice(i + 2, i + 2 + fixed[two]);
      i += 2 + fixed[two];
      continue;
    }
    const ai = variable.includes(two)
      ? two
      : variable.includes(three)
        ? three
        : null;
    if (!ai) break;
    const end = s.indexOf(GS, i + ai.length);
    out[ai] = s.slice(i + ai.length, end < 0 ? undefined : end);
    i = end < 0 ? s.length : end + 1;
  }
  return out;
}
/** Plain EAN/UPC codes, or GS1 element strings from pack DataMatrix/QR codes. */
export function parseScan(raw: string): Scan {
  const code = raw.trim();
  const f = fields(code);
  if (!f?.["01"]) return { code };
  return {
    code,
    gtin: f["01"],
    batch: f["10"] || undefined,
    expiry: f["17"] ? gs1Date(f["17"]) : undefined,
  };
}
export type ScanMatch = {
  scan: Scan;
  key: string;
  products: Product[];
  /** The stock record for the scanned pack's printed batch, when it names one. */
  batch?: Batch;
  batchIssue?: "unrecorded" | "expired" | "no_stock";
};
export function matchScan(state: State, raw: string, today: string): ScanMatch {
  const scan = parseScan(raw);
  const key = normalCode(scan.gtin ?? scan.code);
  const products = Object.values(state.products).filter(
    (p) => p.active && barcodesOf(p).includes(key),
  );
  if (products.length !== 1 || !scan.batch) return { scan, key, products };
  const code = scan.batch.trim().toUpperCase();
  const batch = Object.values(state.batches).find(
    (b) =>
      b.productId === products[0].id && b.code.trim().toUpperCase() === code,
  );
  const batchIssue = !batch
    ? "unrecorded"
    : batch.expiry < today
      ? "expired"
      : D(batch.quantity).lte(0)
        ? "no_stock"
        : undefined;
  return { scan, key, products, batch, batchIssue };
}
