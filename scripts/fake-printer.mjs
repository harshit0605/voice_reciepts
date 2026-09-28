// Local stand-in for an Epson ePOS-Print printer (TM-m30III), for testing printing without hardware.
// Saves each receipt the gateway sends as a PNG and answers success.
//   node scripts/fake-printer.mjs [output directory]   (default .data/printer, port 8090)
//   PRINTER_HOST=127.0.0.1:8090 npm run dev:gateway
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
const dir = process.argv[2] ?? ".data/printer";
const port = Number(process.env.FAKE_PRINTER_PORT ?? 8090);
mkdirSync(dir, { recursive: true });
let jobs = 0;
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
    const width = Number(image[1]),
      height = Number(image[2]);
    const bits = Buffer.from(image[3], "base64"),
      pixels = Buffer.alloc(width * height, 255);
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
      /<cut/.test(body) ? "cut" : "no cut",
    );
    res
      .writeHead(200, { "Content-Type": "text/xml" })
      .end('<response success="true" code="" status="251658262"/>');
  });
}).listen(port, "127.0.0.1", () =>
  console.log(`fake printer on 127.0.0.1:${port}, saving to ${dir}`),
);
