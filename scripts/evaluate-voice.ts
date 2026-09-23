/** Scored, explicitly consented recordings only. Never treats a model's own labels as truth. */
import fs from "node:fs";
import { z } from "zod";
const item = z.object({
  productId: z.string(),
  quantity: z.string(),
  unit: z.string(),
});
const row = z.object({
  id: z.string(),
  employee: z.string(),
  noise: z.string(),
  expected: z.array(item),
  actual: z.array(item),
  latencyMs: z.number().nonnegative(),
});
const filename = process.argv[2];
if (!filename)
  throw new Error("Usage: npm run evaluate:voice -- reviewed-results.jsonl");
const rows = fs
  .readFileSync(filename, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => row.parse(JSON.parse(line)));
if (new Set(rows.map((r) => r.id)).size !== rows.length)
  throw new Error("Duplicate evaluation IDs");
const canonical = (items: z.infer<typeof item>[]) =>
  JSON.stringify(
    items
      .map((i) => ({ ...i, quantity: String(Number(i.quantity)) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
const score = (subset: typeof rows) => {
  const timings = subset.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    n: subset.length,
    exactItemAndQuantity:
      subset.filter((r) => canonical(r.expected) === canonical(r.actual))
        .length / subset.length,
    p95LatencyMs: timings[Math.ceil(timings.length * 0.95) - 1] ?? null,
  };
};
const result = score(rows);
console.log(
  JSON.stringify(
    {
      ...result,
      acceptanceDatasetSizeMet: rows.length >= 300,
      accuracyTargetMet: result.exactItemAndQuantity >= 0.95,
      latencyTargetMet: (result.p95LatencyMs ?? Infinity) <= 5000,
      byEmployee: Object.fromEntries(
        [...new Set(rows.map((r) => r.employee))].map((k) => [
          k,
          score(rows.filter((r) => r.employee === k)),
        ]),
      ),
      byNoise: Object.fromEntries(
        [...new Set(rows.map((r) => r.noise))].map((k) => [
          k,
          score(rows.filter((r) => r.noise === k)),
        ]),
      ),
    },
    null,
    2,
  ),
);
