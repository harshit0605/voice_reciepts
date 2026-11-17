// Restocks the demo shop "harshit-test" with a supplier delivery recorded yesterday at 08:45,
// before the drawer opens (see demo-activity.ts). harshit-test only; goes through the engine
// with `now` set to the command time. One transaction; a no-op if already done.
//   tsx scripts/demo-restock.ts [--dry-run]     (run the same way as demo-activity.ts)
import { pool, readState, transact } from "@counterwell/db";
import { execute, indiaDate, type Actor, type State } from "@counterwell/core";

const TEST_ID = "harshit-test";
const idArg = process.argv.indexOf("--id");
const id = idArg > 0 ? process.argv[idArg + 1] : TEST_ID;
const dryRun = process.argv.includes("--dry-run");
if (id !== TEST_ID) {
  console.error(`Refusing: this script only runs for "${TEST_ID}".`);
  process.exit(1);
}
const before = await readState(id);
if (!before || !before.settings.name.includes("(test)")) {
  console.error("Refusing: missing business or name lacks (test).");
  process.exit(1);
}
const Y = indiaDate(new Date(Date.now() - 86_400_000).toISOString());
const P = `demo-seed-${Y}-restock`;
if (before.commands[`${P}-purchase`]) {
  console.log("Already restocked; nothing to do.");
  await pool.end();
  process.exit(0);
}
const owner = Object.values(before.members).find(
  (m) => m.role === "owner" && m.username === "harshit",
);
if (!owner) throw new Error("owner harshit not found");
const actor: Actor = {
  id: owner.id,
  role: "owner",
  businessId: id,
  canCollect: owner.canCollect,
};

// [existing batch to copy price from, new code, expiry, quantity in base units]
const plan: [string, string, string, number][] = [
  ["dolo-b1", "DOL2603", "2028-02-29", 300],
  ["azithral-b1", "AZI2603", "2028-01-31", 60],
  ["cetirizine-b1", "CET2603", "2028-03-31", 200],
  ["ors-b1", "ORS2603", "2027-12-31", 60],
  ["betadine-b1", "BET2603", "2028-01-31", 20],
  ["bandage-b1", "BAN2603", "2028-06-30", 40],
];
const supplierId = `${P}-supplier`;
const lines = plan.map(([src, code, expiry, qty]) => {
  const old = before.batches[src];
  if (!old || old.costPaise === undefined)
    throw new Error(`${src} missing or no cost`);
  return {
    batch: {
      id: `${P}-batch-${old.productId}`,
      productId: old.productId,
      code,
      expiry,
      quantity: "0",
      quarantined: "0",
      pricePaise: old.pricePaise,
      mrpPaise: old.mrpPaise,
      costPaise: old.costPaise,
      verifiedCost: true,
    },
    quantity: String(qty),
    bonusQuantity: "0",
    lineTotalPaise: qty * old.costPaise,
  };
});
const totalPaise = lines.reduce((n, l) => n + l.lineTotalPaise, 0);

class DryRun extends Error {}
let summary: unknown;
try {
  await transact(id, (original) => {
    let st: State = structuredClone(original);
    const go = (cid: string, t: string, operation: Record<string, unknown>) => {
      const occurredAt = new Date(`${Y}T${t}+05:30`).toISOString();
      st = execute(
        st,
        { id: cid, occurredAt, operation },
        actor,
        occurredAt,
      ).state;
    };
    go(`${P}-supplier-save`, "08:40:10", {
      type: "supplier.save",
      supplier: {
        id: supplierId,
        name: "Lucknow Pharma Distributors",
        gstin: "DEMO",
        phone: "",
      },
    });
    go(`${P}-purchase`, "08:45:30", {
      type: "purchase.post",
      purchaseId: `${P}-purchase`,
      supplierId,
      invoiceNumber: "LPD/26-27/0412",
      invoiceDate: Y,
      totalPaise,
      reviewed: true,
      lines,
    });
    summary = {
      purchaseTotalRs: totalPaise / 100,
      stock: Object.values(st.products).map((p) => ({
        product: p.name,
        batches: Object.values(st.batches)
          .filter((b) => b.productId === p.id)
          .map((b) => `${b.code} ${b.quantity} exp ${b.expiry}`),
      })),
    };
    if (dryRun) throw new DryRun();
    return { state: st, result: true };
  });
} catch (e) {
  if (!(e instanceof DryRun)) throw e;
  console.log("DRY RUN (rolled back)");
}
console.log(JSON.stringify(summary, null, 1));
await pool.end();
