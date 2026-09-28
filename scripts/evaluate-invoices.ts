// Reads supplier invoices with the configured provider and prints what came back, for checking by eye.
//   npx tsx scripts/evaluate-invoices.ts [--model gemini-2.5-flash-lite] bill1.jpg bill2.pdf ...
// Uses GEMINI_API_KEY, or OPENROUTER_API_KEY when that is the only key in .env. Every file is one paid
// call; nothing is stored or posted.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { extract } from "../apps/api/src/providers";

process.loadEnvFile(".env");
const args = process.argv.slice(2);
const at = args.indexOf("--model");
const model = at >= 0 ? args.splice(at, 2)[1] : undefined;
const types: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
if (!args.length) {
  console.log("Give one or more invoice files (PDF, JPEG, PNG or WebP).");
  process.exit(1);
}
const show = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
let cost = 0;
for (const file of args) {
  const type = types[extname(file).toLowerCase()];
  if (!type) {
    console.log(`\n== ${file}: skipped, not a PDF or image`);
    continue;
  }
  const started = Date.now();
  try {
    const out = await extract("invoice", readFileSync(file), type, model);
    const d = out.draft as import("@counterwell/core").InvoiceDraft;
    const usage = out.usage as { cost?: number } | null;
    cost += usage?.cost ?? 0;
    console.log(
      `\n== ${file}: ${out.provider} ${out.model}, ${Date.now() - started} ms${usage?.cost ? `, $${usage.cost.toFixed(5)}` : ""}`,
    );
    console.log(
      `   ${d.supplierName} · GSTIN ${show(d.supplierGstin)} · no. ${d.invoiceNumber} · ${show(d.invoiceDate)} · total ${show(d.totalPaise)} paise`,
    );
    for (const l of d.lines)
      console.log(
        `   - ${l.name.replace(/\s+/g, " ")} ${l.strength ?? ""} | batch ${show(l.batchCode)} | exp ${show(l.expiry)} | qty ${show(l.quantity)} + free ${show(l.bonusQuantity)} | pack ${show(l.packSize)} | MRP ${show(l.mrpPaise)} | line ${show(l.lineTotalPaise)} | GST ${show(l.taxBps)}`,
      );
    for (const w of d.warnings) console.log(`   ! ${w}`);
  } catch (e) {
    console.log(`\n== ${file}: FAILED ${(e as Error).message}`);
  }
}
if (cost) console.log(`\nProvider cost: $${cost.toFixed(4)}`);
