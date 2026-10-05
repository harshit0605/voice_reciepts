import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import sharp from "sharp";
import { rupees, type Invoice } from "@counterwell/core";

type PrinterModel = NonNullable<
  ConstructorParameters<typeof ReceiptPrinterEncoder>[0]
>["printerModel"];

const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

/** Printable width in dots at 203 dpi: 80 mm paper prints 72 mm, 58 mm paper prints 48 mm. */
export const paperDots = (mm: number) => (mm === 58 ? 384 : 576);

export type Raster = { width: number; height: number; bits: Buffer };

/**
 * The receipt as a one-bit picture, one row of `width / 8` bytes per line, most significant bit
 * leftmost and set for black. Drawing it keeps Hindi and the rupee sign readable on printers that
 * have no such characters built in.
 */
export async function receiptRaster(
  invoice: Invoice,
  reprint: boolean,
  width = 576,
): Promise<Raster> {
  const narrow = width < 576;
  const size = narrow ? 20 : 23,
    step = narrow ? 28 : 32;
  // Roughly how many characters fit across the paper at this size.
  const fit = Math.floor((width - 24) / (size * 0.6));
  const rule = "─".repeat(Math.floor(fit * 0.75));
  const tax = (key: "cgstPaise" | "sgstPaise") =>
    rupees(invoice.lines.reduce((n, l) => n + l[key], 0));
  const lines = [
    invoice.business.name,
    invoice.business.address,
    `GSTIN ${invoice.business.gstin}`,
    `Licence ${invoice.business.drugLicence}`,
    `${reprint ? "COPY · " : ""}${invoice.number}`,
    new Date(invoice.occurredAt).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    }),
    rule,
    ...invoice.lines.flatMap((l) => [
      `${l.name} ${l.strength}`,
      `${l.quantity} ${l.unit}  ${rupees(l.netPaise)}`,
      `Batch ${l.batchCode} · Exp ${l.expiry}`,
      `HSN ${l.hsn} · GST ${l.taxBps / 100}%`,
    ]),
    rule,
    `Discount ${rupees(invoice.discountPaise)}`,
    `CGST ${tax("cgstPaise")}`,
    `SGST ${tax("sgstPaise")}`,
    `TOTAL ${rupees(invoice.totalPaise)}`,
    // Sent by the phone that billed it: "Paid ₹50.00 by cash".
    ...((invoice as Invoice & { paid?: string }).paid
      ? [(invoice as Invoice & { paid?: string }).paid!]
      : []),
    "Thank you. Keep this bill.",
  ].flatMap((line) => wrap(line, fit));
  const height = lines.length * step + 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${lines.map((l, i) => `<text x="12" y="${step - 2 + i * step}" font-family="Noto Sans Devanagari, Nirmala UI, sans-serif" font-size="${size}" fill="black">${xml(l)}</text>`).join("")}</svg>`;
  const pixels = await sharp(Buffer.from(svg))
    .flatten({ background: "#fff" })
    .greyscale()
    .threshold(160)
    .raw()
    .toBuffer();
  const bits = Buffer.alloc((width / 8) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (pixels[y * width + x] < 128)
        bits[y * (width / 8) + (x >> 3)] |= 0x80 >> (x & 7);
  return { width, height, bits };
}

/** Splits a line at spaces so it fits the paper; a word longer than the line is cut. */
export function wrap(value: string, fit: number): string[] {
  if (value.length <= fit) return [value];
  return value
    .match(new RegExp(`.{1,${fit}}(\\s|$)|.{1,${fit}}`, "g"))!
    .map((part) => part.trimEnd());
}

export type EscposOptions = {
  /** A model from ReceiptPrinterEncoder's list, such as "pos-5890" or "epson-tm-t88vi". */
  model?: string;
  /** "column" suits very old printers that garble raster pictures. */
  imageMode?: "raster" | "column";
};

/** Printer models ReceiptPrinterEncoder knows. */
export const printerModels = () =>
  ReceiptPrinterEncoder.printerModels.map((m) => m.id);

/**
 * ESC/POS commands for the receipt picture, made by ReceiptPrinterEncoder: reset, the picture, a
 * few blank lines and a partial cut (ignored without a cutter). A known printer model applies that
 * printer's own settings; otherwise the picture goes as a raster image ("GS v 0"), which nearly
 * every thermal printer understands.
 */
export function escposCommands(
  raster: Raster,
  options: EscposOptions = {},
): Buffer {
  const rgba = Buffer.alloc(raster.width * raster.height * 4, 255);
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++)
      if (raster.bits[y * (raster.width / 8) + (x >> 3)] & (0x80 >> (x & 7))) {
        const at = (y * raster.width + x) * 4;
        rgba.fill(0, at, at + 3);
      }
  const encoder = new ReceiptPrinterEncoder({
    language: "esc-pos",
    ...(options.model
      ? { printerModel: options.model as PrinterModel }
      : {
          columns: raster.width === 384 ? 32 : 48,
          imageMode: "raster",
          feedBeforeCut: 4,
        }),
    ...(options.imageMode ? { imageMode: options.imageMode } : {}),
  });
  return Buffer.from(
    encoder
      .initialize()
      .image(
        { data: rgba, width: raster.width, height: raster.height },
        raster.width,
        raster.height,
        "threshold",
        128,
      )
      .cut("partial")
      .encode(),
  );
}
