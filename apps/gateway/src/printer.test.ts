import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { demoState, execute, type Invoice } from "@counterwell/core";
import { printerConnection, printInvoice } from "./printer";
import { escposCommands, receiptRaster, wrap } from "./receipt";

function invoice() {
  const s = demoState();
  const actor = {
    id: "demo-owner",
    businessId: s.businessId,
    role: "owner" as const,
    canCollect: true,
    offlineAuthorized: true,
  };
  return execute(
    s,
    {
      id: "sale",
      occurredAt: new Date().toISOString(),
      operation: {
        type: "offline.checkout",
        orderId: "o",
        deviceId: "demo-device",
        sequence: 1,
        dispenserId: actor.id,
        counterId: "counter-1",
        lines: [
          {
            batchId: "dolo-b1",
            quantity: "1",
            unit: "tablet",
            confirmed: true,
            pricePaise: 280,
            taxBps: 1200,
          },
        ],
        cashPaise: 280,
      },
    },
    actor,
  ).result as Invoice;
}

/** Reads back what a printer would print from the commands the gateway sends. */
function decode(b: Buffer) {
  let width = 0,
    cut = false;
  const bands: Buffer[] = [];
  for (let i = 0; i < b.length;) {
    if (b[i] === 0x1b && b[i + 1] === 0x40) i += 2;
    else if (b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30) {
      const rowBytes = b[i + 4] | (b[i + 5] << 8),
        rows = b[i + 6] | (b[i + 7] << 8);
      width = rowBytes * 8;
      bands.push(b.subarray(i + 8, i + 8 + rowBytes * rows));
      i += 8 + rowBytes * rows;
    } else if (b[i] === 0x1b && b[i + 1] === 0x64) i += 3;
    else if (b[i] === 0x1d && b[i + 1] === 0x56) {
      cut = true;
      i += 4;
    } else throw new Error(`unexpected byte ${b[i]} at ${i}`);
  }
  return { width, bits: Buffer.concat(bands), bands: bands.length, cut };
}

const saved = { ...process.env };
afterEach(() => {
  for (const key of [
    "PRINTER_NAME",
    "PRINTER_RAW",
    "PRINTER_HOST",
    "PRINTER_WIDTH_MM",
    "PRINTER_POWERSHELL",
    "GATEWAY_DATA_DIR",
  ])
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
});

describe("receipt printing", () => {
  it("encodes the receipt picture as ESC/POS bands that read back exactly", async () => {
    const raster = await receiptRaster(invoice(), false, 576);
    const commands = escposCommands(raster, 50);
    const back = decode(commands);
    expect(back.width).toBe(576);
    expect(back.bands).toBe(Math.ceil(raster.height / 50));
    expect(back.bits.equals(raster.bits)).toBe(true);
    expect(back.cut).toBe(true);
    // Something is drawn: the receipt is not blank.
    expect(raster.bits.some((byte) => byte !== 0)).toBe(true);
  });

  it("fits 58 mm paper and wraps long medicine names", async () => {
    const long = invoice();
    long.lines[0].name = "Amoxycillin and Potassium Clavulanate Dispersible";
    const narrow = await receiptRaster(long, false, 384);
    const wide = await receiptRaster(long, false, 576);
    expect(narrow.width).toBe(384);
    expect(narrow.bits.length).toBe(48 * narrow.height);
    // Lines are 28 dots apart on 58 mm paper and 32 on 80 mm; the long name takes more of them.
    expect((narrow.height - 24) / 28).toBeGreaterThan((wide.height - 24) / 32);
    expect(wrap("a ".repeat(40).trim(), 30).every((l) => l.length <= 30)).toBe(
      true,
    );
  });

  it("chooses the printer from the settings, a Windows printer first", () => {
    process.env.PRINTER_HOST = "10.0.0.5";
    expect(printerConnection()).toEqual({ kind: "epos", address: "10.0.0.5" });
    process.env.PRINTER_RAW = "10.0.0.6:9100";
    expect(printerConnection()?.kind).toBe("raw");
    process.env.PRINTER_NAME = "POS-80";
    expect(printerConnection()).toEqual({ kind: "windows", name: "POS-80" });
  });

  it("sends raw ESC/POS to a network printer on 58 mm paper", async () => {
    const received: Buffer[] = [];
    const printer = createServer((socket) => {
      socket.on("data", (c) => received.push(c));
      socket.on("end", () => socket.end());
    });
    await new Promise<void>((r) => printer.listen(0, "127.0.0.1", r));
    try {
      process.env.PRINTER_RAW = `127.0.0.1:${(printer.address() as { port: number }).port}`;
      process.env.PRINTER_WIDTH_MM = "58";
      await printInvoice(invoice());
      const back = decode(Buffer.concat(received));
      expect(back.width).toBe(384);
      expect(back.cut).toBe(true);
    } finally {
      printer.close();
    }
  });

  it("reports a closed raw printer as unconfirmed", async () => {
    process.env.PRINTER_RAW = "127.0.0.1:1";
    await expect(printInvoice(invoice())).rejects.toThrow(
      /did not confirm completion/,
    );
  });

  it("hands Windows printers the receipt through the print queue helper", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "counterwell-print-"));
    const copy = path.join(dir, "sent.bin");
    // Stands in for powershell.exe: records the printer name and copies the receipt.
    const helper = path.join(dir, "fake-powershell");
    writeFileSync(
      helper,
      `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -Printer) echo "$2" > "${dir}/printer.txt"; shift;; -Path) cp "$2" "${copy}"; shift;; esac; shift; done\n`,
    );
    chmodSync(helper, 0o755);
    process.env.PRINTER_POWERSHELL = helper;
    process.env.PRINTER_NAME = "POS-80 Printer";
    process.env.GATEWAY_DATA_DIR = dir;
    await printInvoice(invoice());
    expect(readFileSync(path.join(dir, "printer.txt"), "utf8").trim()).toBe(
      "POS-80 Printer",
    );
    expect(decode(readFileSync(copy)).width).toBe(576);

    writeFileSync(
      helper,
      "#!/bin/sh\necho 'The printer reports: PaperOut; it was cancelled.' >&2\nexit 1\n",
    );
    await expect(printInvoice(invoice())).rejects.toThrow(
      /Inspect paper.*\(The printer reports: PaperOut; it was cancelled\.\)/,
    );
  });
});
