import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Invoice } from "@counterwell/core";
import {
  escposCommands,
  paperDots,
  printerModels,
  receiptRaster,
  type Raster,
} from "./receipt";

const UNCONFIRMED =
  "Printer did not confirm completion. Inspect paper and printer status before explicit reprint.";

/**
 * Where receipts go, from the gateway's settings:
 * PRINTER_NAME  a printer installed in Windows, such as a USB receipt printer;
 * PRINTER_RAW   a network receipt printer taking raw ESC/POS, "address[:port]" (port 9100);
 * PRINTER_HOST  an Epson printer with ePOS-Print, "address[:port]".
 * PRINTER_WIDTH_MM is the paper width, 80 (default) or 58. For ESC/POS printers, PRINTER_MODEL
 * names a model ReceiptPrinterEncoder knows (such as "pos-5890"), and PRINTER_IMAGE_MODE=column
 * helps a printer that garbles the receipt.
 */
export function printerConnection() {
  const env = process.env;
  if (env.PRINTER_NAME)
    return { kind: "windows", name: env.PRINTER_NAME } as const;
  if (env.PRINTER_RAW)
    return { kind: "raw", address: env.PRINTER_RAW } as const;
  if (env.PRINTER_HOST)
    return { kind: "epos", address: env.PRINTER_HOST } as const;
  return null;
}
export const printerConfigured = () => printerConnection() !== null;

export async function printInvoice(invoice: Invoice, reprint = false) {
  const connection = printerConnection();
  if (!connection) throw new Error("No printer is configured");
  if (
    connection.kind !== "windows" &&
    !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(connection.address)
  )
    throw new Error("Invalid printer address");
  const raster = await receiptRaster(
    invoice,
    reprint,
    paperDots(Number(process.env.PRINTER_WIDTH_MM ?? 80)),
  );
  if (connection.kind === "epos") return printEpos(connection.address, raster);
  const model = process.env.PRINTER_MODEL || undefined,
    imageMode = process.env.PRINTER_IMAGE_MODE || undefined;
  if (model && !printerModels().includes(model))
    throw new Error(
      `Unknown PRINTER_MODEL ${model}; known models: ${printerModels().join(", ")}`,
    );
  if (
    imageMode !== undefined &&
    imageMode !== "raster" &&
    imageMode !== "column"
  )
    throw new Error("PRINTER_IMAGE_MODE is raster or column");
  const commands = escposCommands(raster, { model, imageMode });
  if (connection.kind === "raw") return printRaw(connection.address, commands);
  return printWindows(connection.name, commands);
}

async function printEpos(host: string, raster: Raster) {
  const document = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><image width="${raster.width}" height="${raster.height}" color="color_1" mode="mono">${raster.bits.toString("base64")}</image><feed line="3"/><cut type="feed"/></epos-print></s:Body></s:Envelope>`;
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
    throw new Error(UNCONFIRMED);
}

/**
 * Raw printers answer nothing: every byte acknowledged and the connection closed is as much as
 * they confirm. Some never close their side, so a quiet second after sending also counts.
 */
function printRaw(address: string, commands: Buffer) {
  const [host, port] = address.split(":");
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port: Number(port ?? 9100) });
    socket.setTimeout(15000, () => socket.destroy(new Error("timed out")));
    socket.on("error", (e) =>
      reject(new Error(`${UNCONFIRMED} (${e.message})`)),
    );
    socket.on("close", (failed) => {
      if (!failed) resolve();
    });
    socket.end(commands, () =>
      setTimeout(() => {
        resolve();
        socket.destroy();
      }, 1000),
    );
  });
}

/**
 * Hands the receipt to the Windows print queue and waits until Windows has sent it to the
 * printer (windows/print-raw.ps1). A job still queued or in error is cancelled there, so it
 * cannot print later on top of a reprint.
 */
async function printWindows(name: string, commands: Buffer) {
  if (!name.trim() || name.length > 200 || /[\0-\x1f"]/.test(name))
    throw new Error("Invalid printer name");
  const folder = path.join(
    process.env.GATEWAY_DATA_DIR ?? tmpdir(),
    "print-jobs",
  );
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${randomUUID()}.bin`);
  await writeFile(file, commands);
  try {
    await new Promise<void>((resolve, reject) =>
      execFile(
        process.env.PRINTER_POWERSHELL ?? "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.resolve(import.meta.dirname, "../windows/print-raw.ps1"),
          "-Printer",
          name,
          "-Path",
          file,
        ],
        { timeout: 45000, windowsHide: true },
        (error, _stdout, stderr) => {
          const reason = String(stderr).trim().split(/\r?\n/).at(-1);
          if (error)
            reject(
              new Error(reason ? `${UNCONFIRMED} (${reason})` : UNCONFIRMED),
            );
          else resolve();
        },
      ),
    );
  } finally {
    await rm(file, { force: true });
  }
}
