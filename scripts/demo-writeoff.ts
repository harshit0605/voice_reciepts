// Writes off the last 7 Dolo tablets of batch DOL2401 on the demo shop "harshit-test", yesterday
// at about 08:50 (after the restock, before the drawer opens), so the till's first Dolo batch is
// the new one. Same path as the Stock screen: approval.request (kind "stock"), approval.decide,
// stock.execute, all by the owner. harshit-test only; one transaction; a no-op if already done.
//   tsx scripts/demo-writeoff.ts [--dry-run]
import { pool, readState, transact } from "@counterwell/db";
import {
  D,
  execute,
  indiaDate,
  type Actor,
  type State,
} from "@counterwell/core";

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
const P = `demo-seed-${Y}-writeoff`;
if (before.commands[`${P}-ask`]) {
  console.log("Already written off; nothing to do.");
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
const batch = Object.values(before.batches).find((b) => b.code === "DOL2401");
if (!batch) throw new Error("DOL2401 not found");

class DryRun extends Error {}
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
    const quantity = `-${st.batches[batch.id].quantity}`;
    const reason = "Damaged strip, written off";
    go(`${P}-ask`, "08:50:10", {
      type: "approval.request",
      approvalId: `${P}-approval`,
      kind: "stock",
      payload: { batchId: batch.id, quantity, kind: "damage", reason },
      reason,
    });
    go(`${P}-decide`, "08:50:40", {
      type: "approval.decide",
      approvalId: `${P}-approval`,
      approve: true,
    });
    go(`${P}-execute`, "08:51:05", {
      type: "stock.execute",
      approvalId: `${P}-approval`,
    });
    const today = indiaDate(new Date().toISOString());
    console.log(
      `${dryRun ? "DRY RUN (rolled back)\n" : ""}Written off ${quantity} of DOL2401`,
    );
    for (const p of Object.values(st.products)) {
      const list = Object.values(st.batches)
        .filter((b) => b.productId === p.id)
        .sort((a, b) => a.expiry.localeCompare(b.expiry));
      const first = list.find((b) => D(b.quantity).gt(0) && b.expiry >= today);
      console.log(
        `${p.name}: ${list.map((b) => `${b.code}=${b.quantity}`).join(", ")} | first in-date: ${first?.code} (${first?.quantity}) | strip=${p.units.strip ?? "-"}`,
      );
    }
    if (dryRun) throw new DryRun();
    return { state: st, result: true };
  });
} catch (e) {
  if (!(e instanceof DryRun)) throw e;
}
await pool.end();
