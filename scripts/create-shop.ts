// Creates a real shop: an empty business and its owner, who must choose their own password at
// first sign-in. Run once on the server (inside the api container, see docs/DEPLOY.md):
//
//   tsx scripts/create-shop.ts --id city-pharmacy --owner "Ramesh Gupta" --username ramesh \
//     --shop "City Pharmacy" --address "Hospital Road, Lucknow" --gstin 09ABCDE1234F1Z5 \
//     --licence "UP-LKO-12345" --state 09 --phone 9876543210 [--out owner.json]
//
// The temporary password is printed once (or written to --out). Hand it to the owner privately.
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { auth } from "../apps/api/src/auth";
import { createBusiness, pool, readState } from "@counterwell/db";
import { emptyState } from "@counterwell/core";

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const required = (name: string) => {
  const value = argument(name);
  if (!value) {
    console.error(`--${name} is required`);
    process.exit(1);
  }
  return value;
};
const businessId = required("id");
if (!/^[a-z0-9-]{3,40}$/.test(businessId)) {
  console.error("--id: 3 to 40 lowercase letters, digits or dashes");
  process.exit(1);
}
const username = required("username");
if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
  console.error("--username: 3 to 30 letters, digits, dots or underscores");
  process.exit(1);
}
const owner = required("owner");
const gstin = argument("gstin") ?? "";
if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) {
  console.error("--gstin must be 15 characters, e.g. 09ABCDE1234F1Z5");
  process.exit(1);
}
if (await readState(businessId)) {
  console.error(`Shop ${businessId} already exists; nothing changed.`);
  await pool.end();
  process.exit(1);
}
const password = `Temp-${randomBytes(12).toString("base64url")}`;
const account = await auth.api.signUpEmail({
  body: {
    name: owner,
    email: `${businessId}@accounts.invalid`,
    username,
    password,
  },
});
const state = emptyState(businessId, {
  name: argument("shop") ?? "",
  address: argument("address") ?? "",
  gstin,
  drugLicence: argument("licence") ?? "",
  stateCode: argument("state") ?? gstin.slice(0, 2),
  phone: argument("phone") ?? "",
  upiId: argument("upi") ?? "",
  gatewayUrl: argument("gateway") ?? "",
});
state.members[account.user.id] = {
  id: account.user.id,
  name: owner,
  role: "owner",
  active: true,
  mustChangePassword: true,
  canCollect: true,
  username,
};
await createBusiness(state);
await pool.end();
const out = argument("out");
if (out) {
  await writeFile(
    out,
    JSON.stringify({ businessId, username, password }, null, 2),
    { mode: 0o600 },
  );
  console.log(`Created ${businessId}. Owner sign-in written to ${out}.`);
} else
  console.log(
    `Created ${businessId}.\nOwner username: ${username}\nTemporary password: ${password}\nThe owner chooses their own password at first sign-in.`,
  );
