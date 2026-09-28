import { z } from "zod";
import { D, indiaDate } from "./money";
import type { Product, State } from "./types";
import type { Operation } from "./contracts";

export const invoiceDraftSchema = z.object({
  supplierName: z.string(),
  supplierGstin: z.string().nullable(),
  invoiceNumber: z.string(),
  invoiceDate: z.string().nullable(),
  totalPaise: z.number().int().nullable(),
  lines: z
    .array(
      z.object({
        name: z.string(),
        strength: z.string().nullable(),
        batchCode: z.string().nullable(),
        expiry: z.string().nullable(),
        quantity: z.string().nullable(),
        bonusQuantity: z.string().nullable(),
        unit: z.string().nullable(),
        packSize: z.string().nullable(),
        mrpPaise: z.number().int().nullable(),
        lineTotalPaise: z.number().int().nullable(),
        taxBps: z.number().int().nullable(),
      }),
    )
    .max(500),
  warnings: z.array(z.string()),
});
export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;
export type ReceivingLine = {
  id: string;
  productId: string;
  batchId: string;
  code: string;
  expiry: string;
  quantity: string;
  bonus: string;
  unit: string;
  priceUnit: string;
  price: string;
  mrp: string;
  cost: string;
  total: string;
  confirmed: boolean;
  catalogueSignature?: string;
  source?: InvoiceDraft["lines"][number];
};
export type ReceivingDraft = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierGstin: string;
  number: string;
  date: string;
  total: string;
  lines: ReceivingLine[];
  adjustment?: string;
  adjustmentReason?: string;
  documentId?: string;
  jobId?: string;
  warnings: string[];
  savedAt?: string;
};
export function catalogueSignature(p: Product) {
  return JSON.stringify([
    p.id,
    p.name,
    p.strength,
    p.form,
    p.taxBps,
    p.active,
    p.baseUnit,
    Object.entries(p.units).sort(),
  ]);
}
export function signedPaise(v: string) {
  return v.startsWith("-") ? -inputPaise(v.slice(1)) : inputPaise(v);
}
const normal = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function productSuggestions(products: Product[], query: string) {
  const q = normal(query);
  return products
    .filter((p) => p.active)
    .map((p) => {
      const names = [p.name, ...p.aliases].map(normal);
      const full = normal(`${p.name} ${p.strength}`);
      const score = !q
        ? 1
        : full === q
          ? 100
          : names.includes(q)
            ? 90
            : names.some((n) => n && (n.includes(q) || q.includes(n)))
              ? 60
              : normal(
                    `${p.name} ${p.generic} ${p.strength} ${p.barcode}`,
                  ).includes(q)
                ? 30
                : 0;
      return { product: p, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.product.name.localeCompare(b.product.name),
    )
    .slice(0, 8)
    .map((x) => x.product);
}
export function blankReceivingLine(id: string, batchId: string): ReceivingLine {
  return {
    id,
    batchId,
    productId: "",
    code: "",
    expiry: "",
    quantity: "",
    bonus: "0",
    unit: "",
    priceUnit: "",
    price: "",
    mrp: "",
    cost: "",
    total: "",
    confirmed: false,
  };
}
// Printed quantities arrive as "1." or "1,200"; printed batches can wrap onto two lines. The source
// line keeps what was read; the editable fields start in the form the receiving checks accept.
const printedQuantity = (value: string | null) =>
  (value ?? "").replace(/[\s,]/g, "").replace(/\.$/, "");
const printedCode = (value: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();
export function importInvoiceDraft(
  extracted: InvoiceDraft,
  id: () => string,
): Pick<
  ReceivingDraft,
  | "supplierName"
  | "supplierGstin"
  | "number"
  | "date"
  | "total"
  | "lines"
  | "warnings"
> {
  const d = invoiceDraftSchema.parse(extracted);
  return {
    supplierName: d.supplierName,
    supplierGstin: d.supplierGstin ?? "",
    number: d.invoiceNumber,
    date: d.invoiceDate ?? "",
    total: d.totalPaise === null ? "" : D(d.totalPaise).div(100).toFixed(),
    warnings: d.warnings,
    lines: d.lines.map((source) => ({
      ...blankReceivingLine(id(), id()),
      source,
      code: printedCode(source.batchCode),
      expiry: source.expiry ?? "",
      quantity: printedQuantity(source.quantity),
      bonus: printedQuantity(source.bonusQuantity) || "0",
      mrp:
        source.mrpPaise === null ? "" : D(source.mrpPaise).div(100).toFixed(),
      total:
        source.lineTotalPaise === null
          ? ""
          : D(source.lineTotalPaise).div(100).toFixed(),
    })),
  };
}
function quantity(value: string) {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(value))
    throw new Error("Enter a non-negative quantity with up to three decimals");
  return D(value);
}
export function inputPaise(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter an amount with up to two decimals");
  const amount = D(value).mul(100);
  if (amount.gt(100_000_000))
    throw new Error("Amount exceeds the supported limit");
  return amount.toNumber();
}
export function receivingLine(
  line: ReceivingLine,
  product: Product | undefined,
  today = indiaDate(new Date().toISOString()),
) {
  if (!product?.active) throw new Error("Choose an active catalogue product");
  const factor = product.units[line.unit];
  const priceFactor = product.units[line.priceUnit];
  if (!factor || !priceFactor)
    throw new Error("Confirm the received unit and price unit");
  if (!line.code.trim()) throw new Error("Enter the physical batch code");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(line.expiry) ||
    !Number.isFinite(Date.parse(line.expiry)) ||
    new Date(line.expiry).toISOString().slice(0, 10) !== line.expiry
  )
    throw new Error("Confirm a complete, valid expiry date");
  if (line.expiry < today)
    throw new Error("Expired stock cannot be received as sellable stock");
  const paid = quantity(line.quantity).mul(factor),
    bonus = quantity(line.bonus).mul(factor);
  if (paid.plus(bonus).lte(0))
    throw new Error("Received quantity must be positive");
  for (const n of [paid, bonus]) {
    if (n.gt(999_999_999) || n.decimalPlaces() > 3)
      throw new Error("Converted quantity exceeds supported precision");
    if (
      !["g", "kg", "ml", "l"].includes(product.baseUnit.toLowerCase()) &&
      !n.isInteger()
    )
      throw new Error("Received stock must contain whole base units");
  }
  const basePrice = (s: string) => {
    const v = D(inputPaise(s)).div(priceFactor);
    if (!v.isInteger())
      throw new Error(
        "Price conversion has fractions of a paise; enter reviewed prices per base unit",
      );
    return v.toNumber();
  };
  const pricePaise = basePrice(line.price),
    mrpPaise = basePrice(line.mrp);
  if (pricePaise > mrpPaise) throw new Error("Selling price exceeds MRP");
  const costPaise = line.cost === "" ? undefined : basePrice(line.cost);
  return {
    batch: {
      id: line.batchId,
      productId: product.id,
      code: line.code.trim(),
      expiry: line.expiry,
      quantity: "0",
      quarantined: "0",
      pricePaise,
      mrpPaise,
      costPaise,
      verifiedCost: costPaise !== undefined,
    },
    quantity: paid.toFixed(),
    bonusQuantity: bonus.toFixed(),
    lineTotalPaise: inputPaise(line.total),
    receiving: {
      quantity: line.quantity,
      bonusQuantity: line.bonus,
      unit: line.unit,
      baseUnitsPerUnit: factor,
      priceUnit: line.priceUnit,
      baseUnitsPerPriceUnit: priceFactor,
    },
    ...(line.source ? { source: line.source } : {}),
  };
}
export function buildPurchase(
  draft: ReceivingDraft,
  state: State,
): Extract<Operation, { type: "purchase.post" }> {
  if (!state.suppliers[draft.supplierId])
    throw new Error("Choose or create the supplier");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
    !Number.isFinite(Date.parse(draft.date)) ||
    new Date(draft.date).toISOString().slice(0, 10) !== draft.date ||
    draft.date > indiaDate(new Date().toISOString())
  )
    throw new Error("Confirm a valid invoice date, not in the future");
  if (!draft.number.trim())
    throw new Error("Enter the supplier invoice number");
  if (!draft.lines.length) throw new Error("Add at least one received item");
  if (draft.lines.some((l) => !l.confirmed))
    throw new Error("Review and confirm every item");
  if (
    draft.lines.some(
      (l) =>
        !state.products[l.productId] ||
        l.catalogueSignature !==
          catalogueSignature(state.products[l.productId]),
    )
  )
    throw new Error(
      "Catalogue changed or item review is missing; confirm the items again",
    );
  const lines = draft.lines.map((l) =>
    receivingLine(l, state.products[l.productId]),
  );
  const totalPaise = inputPaise(draft.total);
  const adjustmentPaise = signedPaise(draft.adjustment || "0");
  if (adjustmentPaise !== 0 && (draft.adjustmentReason ?? "").trim().length < 3)
    throw new Error("Enter a reason for the invoice adjustment");
  if (
    lines.reduce((n, l) => n + l.lineTotalPaise, 0) + adjustmentPaise !==
    totalPaise
  )
    throw new Error("Line totals must match the invoice total");
  return {
    type: "purchase.post",
    purchaseId: draft.id,
    supplierId: draft.supplierId,
    invoiceNumber: draft.number.trim(),
    invoiceDate: draft.date,
    documentId: draft.documentId,
    totalPaise,
    adjustmentPaise,
    adjustmentReason: draft.adjustmentReason,
    reviewed: true,
    lines,
  };
}
