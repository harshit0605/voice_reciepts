// Local stand-in for a receipt printer, for testing printing without hardware. Saves each receipt
// as a PNG. It answers both ways the gateway prints:
//   ePOS-Print over HTTP, like an Epson TM-m30III      port 8090 (FAKE_PRINTER_PORT)
//   raw ESC/POS, like USB and port-9100 printers       port 9109 (FAKE_RAW_PRINTER_PORT)
//
//   node scripts/fake-printer.mjs [output directory]   (default .data/printer)
//   PRINTER_HOST=127.0.0.1:8090 npm run dev:gateway    or    PRINTER_RAW=127.0.0.1:9109 npm run dev:gateway
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { readEscpos } from "./escpos-read.mjs";
const dir = process.argv[2] ?? ".data/printer";
const port = Number(process.env.FAKE_PRINTER_PORT ?? 8090);
// Not 9100, which real printers use and other tools on a development machine often hold.
const rawPort = Number(process.env.FAKE_RAW_PRINTER_PORT ?? 9109);
mkdirSync(dir, { recursive: true });
let jobs = 0;

async function save(width, height, bits, note) {
  const pixels = Buffer.alloc(width * height, 255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (bits[y * (width / 8) + (x >> 3)] & (0x80 >> (x & 7)))
        pixels[y * width + x] = 0;
  const file = `${dir}/job-${++jobs}.png`;
  await sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(file);
  console.log(
    new Date().toISOString(),
    "printed",
    file,
    `${width}x${height}`,
    note,
  );
}

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const image =
      /<image width="(\d+)" height="(\d+)"[^>]*>([^<]+)<\/image>/.exec(body);
    if (!image) {
      res.writeHead(400).end();
      return;
    }
    await save(
      Number(image[1]),
      Number(image[2]),
      Buffer.from(image[3], "base64"),
      /<cut/.test(body) ? "ePOS, cut" : "ePOS, no cut",
    );
    res
      .writeHead(200, { "Content-Type": "text/xml" })
      .end('<response success="true" code="" status="251658262"/>');
  });
}).listen(port, "127.0.0.1", () =>
  console.log(`fake printer on 127.0.0.1:${port}, saving to ${dir}`),
);

createTcpServer((socket) => {
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("end", async () => {
    socket.end();
    try {
      const r = readEscpos(Buffer.concat(chunks));
      await save(
        r.width,
        r.height,
        r.bits,
        r.cut ? "ESC/POS, cut" : "ESC/POS, no cut",
      );
    } catch (e) {
      console.log(new Date().toISOString(), "unreadable ESC/POS:", e.message);
    }
  });
}).listen(rawPort, "127.0.0.1", () =>
  console.log(`fake raw ESC/POS printer on 127.0.0.1:${rawPort}`),
);
