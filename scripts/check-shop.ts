// A throwaway shop with the demo catalogue, for checking a release build against a real server
// without touching the real shop. Run inside the server's api container:
//
//   tsx scripts/check-shop.ts create   prints {"businessId","username","password"} as JSON
//   tsx scripts/check-shop.ts delete   removes the shop, all its records and its owner account
import { randomBytes } from "node:crypto";
import { auth } from "../apps/api/src/auth";
import { createBusiness, pool, readState } from "@counterwell/db";
import { collections, demoState } from "@counterwell/core";

const id = "check-shop";
const username = "checkowner";
const action = process.argv[2];
if (action === "create") {
  if (await readState(id)) {
    console.error(`${id} already exists; delete it first.`);
    process.exit(1);
  }
  const password = `Check-${randomBytes(12).toString("base64url")}`;
  const account = await auth.api.signUpEmail({
    body: {
      name: "Check owner",
      email: `${id}@accounts.invalid`,
      username,
      password,
    },
  });
  const state = demoState(id, account.user.id);
  state.members[account.user.id] = {
    id: account.user.id,
    name: "Check owner",
    role: "owner",
    active: true,
    mustChangePassword: false,
    canCollect: true,
    username,
  };
  delete state.members["demo-employee"];
  state.settings.name = "Counterwell check shop (test)";
  await createBusiness(state);
  console.log(JSON.stringify({ businessId: id, username, password }));
} else if (action === "delete") {
  // Staff added while checking are accounts of this shop too.
  const members = Object.keys((await readState(id))?.members ?? {});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const name of collections)
      await client.query(`DELETE FROM retail_${name} WHERE business_id=$1`, [
        id,
      ]);
    await client.query("DELETE FROM jobs WHERE business_id=$1", [id]);
    await client.query("DELETE FROM gateway_health WHERE business_id=$1", [id]);
    await client.query("DELETE FROM businesses WHERE id=$1", [id]);
    // Sessions and the password record go with each account.
    const removed = await client.query(
      "DELETE FROM auth_user WHERE (username=$1 AND email=$2) OR (id = ANY($3::text[]) AND email LIKE '%@accounts.invalid')",
      [username, `${id}@accounts.invalid`, members],
    );
    await client.query("COMMIT");
    console.log(`Deleted ${id} and ${removed.rowCount} member accounts.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
} else {
  console.error("Use: tsx scripts/check-shop.ts create | delete");
  process.exit(1);
}
await pool.end();
