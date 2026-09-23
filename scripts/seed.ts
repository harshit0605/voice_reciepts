import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { auth } from "../apps/api/src/auth";
import { createBusiness, pool, readState } from "@counterwell/db";
import { demoState, emptyState } from "@counterwell/core";
const demo = process.argv.includes("--demo");
const businessId = process.env.BUSINESS_ID ?? "pilot-pharmacy";
if (await readState(businessId)) {
  console.log("Business already exists; no data changed.");
  await pool.end();
  process.exit(0);
}
const password =
  process.env.SEED_OWNER_PASSWORD ?? randomBytes(18).toString("base64url");
const username = process.env.SEED_OWNER_USERNAME ?? "shopowner";
const result = await auth.api.signUpEmail({
  body: {
    name: demo ? "Demo owner" : "Shop owner",
    email: `${businessId}@accounts.invalid`,
    username,
    password,
  },
});
const state = demo
  ? demoState(businessId, result.user.id)
  : emptyState(businessId);
state.members[result.user.id] = {
  id: result.user.id,
  name: "Shop owner",
  role: "owner",
  active: true,
  mustChangePassword: false,
  canCollect: true,
};
if (demo) delete state.members["demo-employee"];
await createBusiness(state);
await mkdir(".data", { recursive: true, mode: 0o700 });
await writeFile(
  ".data/local-access.json",
  JSON.stringify({ businessId, username, password }, null, 2),
  { mode: 0o600 },
);
console.log(
  `Created ${demo ? "synthetic demonstration" : "empty"} business. Local credentials: .data/local-access.json`,
);
await pool.end();
