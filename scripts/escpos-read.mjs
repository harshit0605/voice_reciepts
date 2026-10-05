// Reads back the ESC/POS commands the gateway sends a receipt printer (ReceiptPrinterEncoder's
// output) into the picture a printer would print. Used by the printer stand-in and the tests.
// Throws on a command it does not know, so a change in what is sent shows up.

/**
 * @param {Uint8Array} b
 * @returns {{ width: number, height: number, bits: Buffer, cut: boolean }} one bit per dot,
 *   rows of width / 8 bytes, most significant bit leftmost and set for black
 */
export function readEscpos(b) {
  /** @type {Uint8Array[]} */
  const rows = [];
  let width = 0,
    cut = false;
  const row = (w) => {
    width = Math.max(width, w);
    const r = new Uint8Array(Math.ceil(w / 8));
    rows.push(r);
    return r;
  };
  for (let i = 0; i < b.length;) {
    const [a, c, d] = [b[i], b[i + 1], b[i + 2]];
    if (a === 0x0a || a === 0x0d) i += 1;
    else if (a === 0x1b && c === 0x40)
      i += 2; // initialise
    else if (a === 0x1b && c === 0x32)
      i += 2; // default line spacing
    else if (a === 0x1c && c === 0x2e)
      i += 2; // single-byte characters
    else if (a === 0x1b && [0x4d, 0x33, 0x64, 0x61, 0x74].includes(c))
      i += 3; // font, line spacing, feed, alignment, code page
    else if (a === 0x1d && c === 0x50)
      i += 4; // motion units
    else if (a === 0x1d && c === 0x76 && d === 0x30) {
      // raster picture: GS v 0 m xL xH yL yH, then rows
      const rowBytes = b[i + 4] | (b[i + 5] << 8),
        count = b[i + 6] | (b[i + 7] << 8);
      for (let y = 0; y < count; y++)
        row(rowBytes * 8).set(
          b.subarray(i + 8 + y * rowBytes, i + 8 + (y + 1) * rowBytes),
        );
      i += 8 + rowBytes * count;
    } else if (a === 0x1b && c === 0x2a) {
      // column picture: ESC * m nL nH, then columns of 8 or 24 dots, top bit first
      const dots = d === 32 || d === 33 ? 24 : 8,
        columns = b[i + 3] | (b[i + 4] << 8),
        per = dots / 8;
      const stripe = Array.from({ length: dots }, () => row(columns));
      for (let x = 0; x < columns; x++)
        for (let y = 0; y < dots; y++)
          if (b[i + 5 + x * per + (y >> 3)] & (0x80 >> (y & 7)))
            stripe[y][x >> 3] |= 0x80 >> (x & 7);
      i += 5 + columns * per;
    } else if (a === 0x1d && c === 0x56) {
      cut = true;
      i += d >= 65 ? 4 : 3;
    } else throw new Error(`unknown ESC/POS byte 0x${a.toString(16)} at ${i}`);
  }
  const rowBytes = width / 8,
    bits = Buffer.alloc(rowBytes * rows.length);
  rows.forEach((r, y) => bits.set(r, y * rowBytes));
  return { width, height: rows.length, bits, cut };
}
