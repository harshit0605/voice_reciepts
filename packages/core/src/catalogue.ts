import { unzipSync } from "fflate";
import { productSchema } from "./contracts";
import { barcodesOf, normalCode } from "./scan";
import type { Batch, Product, State } from "./types";

// ---------- reading files ----------

const cp1252: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};
function utf8(bytes: Uint8Array): string | null {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    const need =
      b < 0x80
        ? 0
        : b >> 5 === 6
          ? 1
          : b >> 4 === 14
            ? 2
            : b >> 3 === 30
              ? 3
              : -1;
    if (need < 0 || i + need >= bytes.length + (need ? 0 : 1)) return null;
    let cp = need === 0 ? b : b & (0x3f >> need);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || c >> 6 !== 2) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
function utf16(bytes: Uint8Array, little: boolean) {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2)
    out += String.fromCharCode(
      little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1],
    );
  return out;
}
/** UTF-8 (with or without BOM), UTF-16 with BOM ("Unicode text" from Excel), else Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return utf16(bytes.subarray(2), true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return utf16(bytes.subarray(2), false);
  const body =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  if (typeof TextDecoder !== "undefined")
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      /* not UTF-8: fall through to Windows-1252 */
    }
  return (
    utf8(body) ??
    Array.from(body, (b) => cp1252[b] ?? String.fromCharCode(b)).join("")
  );
}
/** CSV, semicolon, pipe or tab separated text (including rows pasted from a spreadsheet). */
export function parseDelimited(input: string): string[][] {
  let text = input.replace(/^﻿/, "");
  let delimiter = "";
  const hint = /^sep=(.)\r?\n/i.exec(text);
  if (hint) {
    delimiter = hint[1];
    text = text.slice(hint[0].length);
  } else {
    const sample = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
    const unquoted = sample.replace(/"[^"]*"/g, "");
    let best = 0;
    for (const d of [",", "\t", ";", "|"]) {
      const n = unquoted.split(d).length - 1;
      if (n > best) [best, delimiter] = [n, d];
    }
    delimiter ||= ",";
  }
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') cell += text[++i];
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return trimTrailing(rows);
}
const blank = (r: string[]) => !r.some((c) => c.trim());
/** Row positions stay equal to spreadsheet row numbers, so only trailing blank rows go. */
function trimTrailing(rows: string[][]) {
  let end = rows.length;
  while (end && blank(rows[end - 1])) end--;
  return rows.slice(0, end);
}
const entities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#")
      return String.fromCodePoint(
        k[1] === "x" ? parseInt(k.slice(2), 16) : Number(k.slice(1)),
      );
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[k] ?? _;
  });
const textOf = (xml: string) =>
  entities(
    [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""),
  );
const column = (ref: string) => {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "A")
    n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};
/** Excel stores computed values like 12.000000000000002; show what the cell displays. */
const tidyNumber = (v: string) =>
  /^-?\d+\.\d{9,}$/.test(v) ? String(Number(Number(v).toFixed(6))) : v;
/** First worksheet of an .xlsx file, as rows of cell text. */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, {
    filter: (f) =>
      f.name === "xl/workbook.xml" ||
      f.name === "xl/_rels/workbook.xml.rels" ||
      f.name === "xl/sharedStrings.xml" ||
      f.name.startsWith("xl/worksheets/"),
  });
  const read = (name: string) => (files[name] ? decodeText(files[name]) : "");
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(
    read("xl/workbook.xml"),
  )?.[1];
  const target = rid
    ? (new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(
        read("xl/_rels/workbook.xml.rels"),
      )?.[1] ??
      new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(
        read("xl/_rels/workbook.xml.rels"),
      )?.[1])
    : undefined;
  const sheetName = target
    ? target.startsWith("/")
      ? target.slice(1)
      : `xl/${target}`
    : "xl/worksheets/sheet1.xml";
  const sheet = read(sheetName) || read("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("The spreadsheet has no readable sheet");
  const shared = [
    ...read("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
  ].map((m) => textOf(m[1]));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const index = Number(/\br="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1],
        inner = c[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = entities(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      const value =
        type === "s"
          ? (shared[Number(v)] ?? "")
          : type === "inlineStr"
            ? textOf(inner)
            : type === "b"
              ? v === "1"
                ? "TRUE"
                : "FALSE"
              : tidyNumber(v);
      cells[ref ? column(ref) : cells.length] = value;
    }
    rows[index] = Array.from(cells, (x) => x ?? "");
  }
  return trimTrailing(Array.from(rows, (x) => x ?? []));
}
/** Any supported spreadsheet or text file. */
export function readTable(bytes: Uint8Array): string[][] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf)
    throw new Error("Old .xls files cannot be read. Save it as .xlsx or CSV.");
  return parseDelimited(decodeText(bytes));
}

// ---------- columns ----------

export const catalogueFields = [
  "name",
  "generic",
  "strength",
  "form",
  "pack",
  "gst",
  "hsn",
  "barcode",
  "schedule",
  "company",
] as const;
export type CatalogueField = (typeof catalogueFields)[number];
export type ColumnMapping = Partial<Record<CatalogueField, number>>;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");
const headerNames: Record<CatalogueField, string[]> = {
  name: [
    "itemname",
    "productname",
    "product",
    "medicinename",
    "medicine",
    "drugname",
    "brandname",
    "brand",
    "item",
    "itemdescription",
    "description",
    "particulars",
    "name",
  ],
  generic: [
    "genericname",
    "generic",
    "saltname",
    "salt",
    "composition",
    "content",
    "molecule",
  ],
  strength: ["strength", "potency", "dose", "dosage"],
  form: ["dosageform", "form", "formulation", "itemtype", "type"],
  pack: [
    "packsize",
    "pack",
    "packing",
    "pkg",
    "unitsperpack",
    "qtyperpack",
    "conversion",
    "uom",
    "unit",
  ],
  gst: [
    "gst%",
    "gst",
    "gstrate",
    "igst%",
    "igst",
    "tax%",
    "taxrate",
    "tax",
    "taxslab",
  ],
  hsn: ["hsncode", "hsn", "hsnsac"],
  barcode: ["barcode", "ean", "eancode", "gtin", "upc"],
  schedule: ["schedule", "drugschedule", "scheduletype", "sch"],
  company: [
    "company",
    "companyname",
    "manufacturer",
    "mfr",
    "mfg",
    "mktby",
    "marketedby",
  ],
};
function fieldFor(header: string): CatalogueField | undefined {
  const h = key(header);
  if (!h) return undefined;
  for (const f of catalogueFields) if (headerNames[f].includes(h)) return f;
  for (const f of catalogueFields)
    if (headerNames[f].some((n) => n.length > 3 && h.includes(n))) return f;
  return undefined;
}
/** Exports often start with shop and report titles; the header is the most recognisable early row. */
export function findHeader(table: string[][]): number {
  let best = 0,
    score = 0;
  table.slice(0, 20).forEach((row, i) => {
    const fields = new Set(row.map(fieldFor).filter(Boolean));
    const n = fields.size + (fields.has("name") ? 1 : 0);
    if (n > score) [best, score] = [i, n];
  });
  return best;
}
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((h, i) => {
    const f = fieldFor(h);
    if (f && mapping[f] === undefined) mapping[f] = i;
  });
  return mapping;
}

// ---------- units ----------

const forms: [RegExp, string, string][] = [
  [/\b(tab|tabs|tablet|tablets|tb|dt|md)\b/, "tablet", "tablet"],
  [
    /\b(cap|caps|capsule|capsules|softgel|rotacap|rotacaps)\b/,
    "capsule",
    "capsule",
  ],
  [
    /\b(syp|syr|syrup|susp|suspension|liquid|elixir|linctus)\b/,
    "syrup",
    "bottle",
  ],
  [/\b(drop|drops|drp)\b/, "drops", "bottle"],
  [/\b(inj|injection|vial|amp|ampoule|ampule)\b/, "injection", "vial"],
  [/\b(cream|crm|oint|ointment|gel|jelly)\b/, "cream", "tube"],
  [/\b(lotion|spray|mouthwash|shampoo)\b/, "lotion", "bottle"],
  [/\b(sachet|sachets|sach|granules)\b/, "sachet", "sachet"],
  [/\b(respule|respules|nebule|nebules)\b/, "respule", "respule"],
];
const word = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
export type PackUnits = {
  form: string;
  baseUnit: string;
  units: Record<string, string>;
  /** Pack volume or weight such as "100 ml", when the pack names one. */
  size?: string;
  note?: string;
};
/** Base unit and pack conversions from a form and a pack text such as "10's", "1x15" or "100ML". */
export function packUnits(form: string, pack: string, name = ""): PackUnits {
  const match =
    forms.find(([re]) => re.test(word(form))) ??
    forms.find(([re]) => re.test(word(name))) ??
    forms.find(([re]) => re.test(word(pack)));
  const p = pack.toLowerCase().replace(/\s+/g, " ").trim();
  const size = /(\d+(?:\.\d+)?)\s*(ml|l|gm|g|kg|mg)\b/.exec(p);
  const sizeText = size
    ? `${size[1]} ${size[2] === "gm" ? "g" : size[2]}`
    : undefined;
  if (!match)
    return {
      form: form.trim().toLowerCase() || "item",
      baseUnit: "piece",
      units: { piece: "1" },
      size: sizeText,
      note: "Unit could not be worked out: sold per piece",
    };
  const [, formName, baseUnit] = match;
  if (baseUnit !== "tablet" && baseUnit !== "capsule")
    return {
      form: formName,
      baseUnit,
      units: { [baseUnit]: "1" },
      size: sizeText,
    };
  const cross = /(\d+)\s*[x*×]\s*(\d+)/.exec(p);
  const count =
    /strip\s*of\s*(\d+)/.exec(p)?.[1] ??
    /(\d+)\s*(?:'?s\b|tabs?\b|tablets?\b|caps?\b|capsules?\b|nos?\b|pcs\b)/.exec(
      p,
    )?.[1] ??
    /^(\d+)$/.exec(p)?.[1];
  const units: Record<string, string> = { [baseUnit]: "1" };
  if (cross) {
    const [a, b] = [Number(cross[1]), Number(cross[2])];
    if (b > 1 && b <= 100) units.strip = String(b);
    if (a > 1 && b > 0) units.box = String(a * b);
  } else if (count && Number(count) > 1) {
    units[Number(count) <= 30 ? "strip" : "pack"] = String(Number(count));
  }
  return {
    form: formName,
    baseUnit,
    units,
    note:
      Object.keys(units).length === 1
        ? "Strip size unknown: add it before selling by strip"
        : undefined,
  };
}

// ---------- planning ----------

const clip = (s: string, n: number) =>
  s.trim().replace(/\s+/g, " ").slice(0, n);
const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\d)\s+(mg|mcg|g|gm|ml|iu|%)\b/g, "$1$2")
    .replace(/[^a-z0-9.%]+/g, " ")
    .trim();
const canonical: Record<string, string> = {
  tab: "tablet",
  tabs: "tablet",
  tablets: "tablet",
  cap: "capsule",
  caps: "capsule",
  capsules: "capsule",
  syp: "syrup",
  syr: "syrup",
  susp: "suspension",
  inj: "injection",
  oint: "ointment",
  crm: "cream",
  drop: "drops",
  drp: "drops",
  sachets: "sachet",
};
const tokens = (s: string) =>
  normal(s)
    .split(" ")
    .filter(Boolean)
    .map(
      (t) =>
        canonical[t] ?? t.replace(/^(\d+(?:\.\d+)?)(mg|mcg|g|gm|ml|iu)$/, "$1"),
    );
/**
 * Same medicine when brand, strength and form agree however they were typed:
 * "DOLO 650 TAB" = "Dolo" + "650 mg" (tablet), but a syrup and a suspension differ.
 */
export function productKey(name: string, strength: string, form: string) {
  return [...new Set([...tokens(name), ...tokens(strength), ...tokens(form)])]
    .sort()
    .join(" ");
}
const packOf = (units: Record<string, string>) =>
  JSON.stringify(Object.entries(units).sort(([a], [b]) => a.localeCompare(b)));
function gstBps(raw: string): { bps?: number; problem?: string } {
  const v = raw.replace(/gst|igst|%|\s/gi, "");
  if (!v) return {};
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 28)
    return { problem: "GST rate is not a valid number" };
  const pct = n > 0 && n < 1 ? n * 100 : n;
  return { bps: Math.round(pct * 100) };
}
function schedule(raw: string): Product["schedule"] | undefined {
  const s = raw
    .toLowerCase()
    .replace(/schedule|sch\.?|drug/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!s) return undefined;
  if (s === "h1") return "H1";
  if (s === "x") return "X";
  if (s === "h" || s === "rx" || s.startsWith("pres")) return "H";
  return "OTC";
}
export type ImportRowPlan = {
  /** Spreadsheet row number, counting from 1. */
  line: number;
  name: string;
  status: "new" | "existing" | "repeat" | "error";
  product?: Product;
  existingId?: string;
  repeatOf?: number;
  errors: string[];
  warnings: string[];
};
export type ImportPlan = {
  rows: ImportRowPlan[];
  create: Product[];
  counts: Record<ImportRowPlan["status"] | "warnings", number>;
};
export function planImport(
  table: string[][],
  headerRow: number,
  mapping: ColumnMapping,
  state: Pick<State, "products">,
  options: { defaultGst?: string; idFor: (line: number) => string },
): ImportPlan {
  const byKey = new Map<string, Product>(),
    byCode = new Map<string, Product>();
  for (const p of Object.values(state.products)) {
    byKey.set(productKey(p.name, p.strength, p.form), p);
    for (const c of barcodesOf(p)) byCode.set(c, p);
  }
  const seenKey = new Map<string, Product>(),
    seenCode = new Map<string, Product>(),
    lineOf = new Map<Product, number>();
  const fallback = options.defaultGst?.trim() ? gstBps(options.defaultGst) : {};
  const rows: ImportRowPlan[] = [];
  const create: Product[] = [];
  table.slice(headerRow + 1).forEach((cells, i) => {
    const line = headerRow + i + 2;
    if (blank(cells)) return;
    const cell = (f: CatalogueField) =>
      mapping[f] === undefined ? "" : (cells[mapping[f]!] ?? "").trim();
    const errors: string[] = [],
      warnings: string[] = [];
    const name = clip(cell("name"), 180);
    if (!name) {
      rows.push({
        line,
        name: "",
        status: "error",
        errors: ["Name is missing"],
        warnings,
      });
      return;
    }
    const pack = packUnits(cell("form"), cell("pack"), name);
    if (pack.note) warnings.push(pack.note);
    let tax = gstBps(cell("gst"));
    if (tax.problem) errors.push(tax.problem);
    else if (tax.bps === undefined) {
      tax = fallback;
      if (tax.bps === undefined) errors.push("GST rate is missing");
      else warnings.push("GST from the default rate: check it");
    }
    if (tax.bps !== undefined && ![0, 500, 1200, 1800, 2800].includes(tax.bps))
      warnings.push("Unusual GST rate: check it");
    const sched = schedule(cell("schedule"));
    if (sched === "X") warnings.push("Schedule X: sales stay blocked");
    const rawCodes = cell("barcode");
    let codes: string[] = [];
    if (/\de\+?\d/i.test(rawCodes))
      warnings.push(
        "Barcode was saved in Excel scientific notation and was ignored",
      );
    else
      codes = rawCodes
        .split(/[\s,;/]+/)
        .map(normalCode)
        .filter((c) => c.length >= 6 && !/^0+$/.test(c));
    const hsnRaw = cell("hsn").replace(/\s/g, "");
    const hsn = /^\d{4,8}$/.test(hsnRaw) ? hsnRaw : "";
    if (hsnRaw && !hsn)
      warnings.push("HSN code was not 4 to 8 digits and was left blank");
    const strength = clip(cell("strength") || pack.size || "", 60);
    const company = clip(cell("company"), 100);
    const product: Product = {
      id: options.idFor(line),
      name,
      generic: clip(cell("generic"), 180),
      strength,
      form: clip(pack.form, 60),
      hsn,
      aliases: company ? [company.toLowerCase()] : [],
      barcode: [...new Set(codes)].join(", ").slice(0, 300),
      units: pack.units,
      baseUnit: pack.baseUnit,
      taxBps: tax.bps ?? 0,
      reorderAt: "0",
      schedule: sched ?? "OTC",
      active: true,
    };
    if (errors.length) {
      rows.push({ line, name, status: "error", errors, warnings });
      return;
    }
    const parsed = productSchema.safeParse(product);
    if (!parsed.success) {
      rows.push({
        line,
        name,
        status: "error",
        errors: ["Row could not be read as a product"],
        warnings,
      });
      return;
    }
    const k = productKey(name, strength, pack.form);
    const existing =
      byKey.get(k) ?? codes.map((c) => byCode.get(c)).find(Boolean);
    if (existing) {
      if (packOf(existing.units) !== packOf(product.units))
        warnings.push(
          "Already in the catalogue with a different pack: not changed",
        );
      rows.push({
        line,
        name,
        status: "existing",
        existingId: existing.id,
        errors,
        warnings,
      });
      return;
    }
    const earlier =
      seenKey.get(k) ?? codes.map((c) => seenCode.get(c)).find(Boolean);
    if (earlier) {
      if (packOf(earlier.units) !== packOf(product.units))
        warnings.push(
          "Same medicine as an earlier row with a different pack: skipped",
        );
      rows.push({
        line,
        name,
        status: "repeat",
        repeatOf: lineOf.get(earlier),
        errors,
        warnings,
      });
      return;
    }
    seenKey.set(k, product);
    lineOf.set(product, line);
    for (const c of codes) if (!seenCode.has(c)) seenCode.set(c, product);
    rows.push({ line, name, status: "new", product, errors, warnings });
    create.push(product);
  });
  const counts = { new: 0, existing: 0, repeat: 0, error: 0, warnings: 0 };
  for (const r of rows) {
    counts[r.status]++;
    if (r.warnings.length && r.status === "new") counts.warnings++;
  }
  return { rows, create, counts };
}
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
/** Starting values for a new product from an unmatched supplier-invoice line. */
export function productFromInvoiceLine(
  line: {
    name: string;
    strength: string | null;
    packSize: string | null;
    unit: string | null;
    taxBps: number | null;
  },
  id: string,
): Product {
  const pack = packUnits(line.unit ?? "", line.packSize ?? "", line.name);
  return {
    id,
    name: clip(line.name, 180),
    generic: "",
    strength: clip(line.strength ?? pack.size ?? "", 60),
    form: pack.form,
    hsn: "",
    aliases: [],
    barcode: "",
    units: pack.units,
    baseUnit: pack.baseUnit,
    taxBps: line.taxBps ?? 0,
    reorderAt: "0",
    schedule: "OTC",
    active: true,
  };
}
/** Batches per product, earliest expiry first; one pass instead of a filter per product. */
export function groupBatches(batches: Record<string, Batch>) {
  const out = new Map<string, Batch[]>();
  for (const b of Object.values(batches)) {
    const list = out.get(b.productId);
    if (list) list.push(b);
    else out.set(b.productId, [b]);
  }
  for (const list of out.values())
    list.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return out;
}
/** Every typed word must appear somewhere in the product's names, salt, strength, barcodes or aliases. */
export function matchesSearch(p: Product, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text =
    `${p.name} ${p.generic} ${p.strength} ${p.form} ${p.barcode} ${p.aliases.join(" ")}`.toLowerCase();
  return words.every((w) => text.includes(w));
}
