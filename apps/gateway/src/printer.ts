import sharp from "sharp";
import { rupees, type Invoice } from "@counterwell/core";
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
export async function printInvoice(invoice: Invoice, reprint = false) {
  const host = process.env.PRINTER_HOST;
  if (!host) throw new Error("PRINTER_HOST is not configured");
  if (!/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host))
    throw new Error("Invalid printer host");
  const lines = [
    invoice.business.name,
    ...wrap(invoice.business.address),
    `GSTIN ${invoice.business.gstin}`,
    `Licence ${invoice.business.drugLicence}`,
    `${reprint ? "COPY · " : ""}${invoice.number}`,
    new Date(invoice.occurredAt).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    }),
    "────────────────────────────",
    ...invoice.lines.flatMap((l) => [
      `${l.name} ${l.strength}`,
      `${l.quantity} ${l.unit}  ${rupees(l.netPaise)}`,
      `Batch ${l.batchCode} · Exp ${l.expiry}`,
      `HSN ${l.hsn} · GST ${l.taxBps / 100}%`,
    ]),
    "────────────────────────────",
    `Discount ${rupees(invoice.discountPaise)}`,
    `CGST ${rupees(invoice.lines.reduce((n, l) => n + l.cgstPaise, 0))}`,
    `SGST ${rupees(invoice.lines.reduce((n, l) => n + l.sgstPaise, 0))}`,
    `TOTAL ${rupees(invoice.totalPaise)}`,
    // Sent by the phone that billed it: "Paid ₹50.00 by cash".
    ...((invoice as Invoice & { paid?: string }).paid
      ? [(invoice as Invoice & { paid?: string }).paid!]
      : []),
    "Thank you. Keep this bill.",
  ];
  const width = 576,
    height = lines.length * 32 + 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${lines.map((l, i) => `<text x="12" y="${30 + i * 32}" font-family="Noto Sans Devanagari, sans-serif" font-size="23" fill="black">${xml(l)}</text>`).join("")}</svg>`;
  const pixels = await sharp(Buffer.from(svg))
    .flatten({ background: "#fff" })
    .greyscale()
    .threshold(160)
    .raw()
    .toBuffer();
  const raster = Buffer.alloc((width / 8) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (pixels[y * width + x] < 128)
        raster[y * (width / 8) + (x >> 3)] |= 0x80 >> (x & 7);
  const document = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><image width="${width}" height="${height}" color="color_1" mode="mono">${raster.toString("base64")}</image><feed line="3"/><cut type="feed"/></epos-print></s:Body></s:Envelope>`;
  const response = await fetch(
    `http://${host}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`,
    {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      body: document,
      signal: AbortSignal.timeout(15000),
    },
  );
  const body = await response.text();
  if (!response.ok || !/<response\b[^>]*\bsuccess="true"/.test(body))
    throw new Error(
      "Printer did not confirm completion. Inspect paper and printer status before explicit reprint.",
    );
}
function wrap(value: string) {
  return value.match(/.{1,38}(\s|$)|.{1,38}/g) ?? [""];
}
