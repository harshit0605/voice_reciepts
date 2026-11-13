// Proves an encrypted backup can really be restored: decrypts it, loads it into a scratch
// database and counts the sales bills (retail_invoices), then removes the scratch database.
//   node scripts/restore-check.mjs --backup <file.sql.gz.age> --key <private-key-file>
// It needs a PostgreSQL server you can create databases on (the local development one is fine),
// given as RESTORE_ADMIN_URL=postgres://user:password@host:port (falls back to DATABASE_URL from
// the environment). Never point it at the live production database. Uses psql on the PATH, of
// the same major version as the server that made the dump or newer.
import { Decrypter } from "age-encryption";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const backup = arg("--backup");
const keyFile = arg("--key");
const adminUrl = process.env.RESTORE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!backup || !keyFile || !adminUrl) {
  console.error(
    "Usage: RESTORE_ADMIN_URL=postgres://user:password@host:port node scripts/restore-check.mjs --backup <file.sql.gz.age> --key <private-key-file>",
  );
  process.exit(1);
}
const url = new URL(adminUrl);
const scratch = `counterwell_restorecheck_${randomBytes(5).toString("hex")}`;
// The password goes to psql through the environment, never on a command line.
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
};
const psql = (database, args, input) =>
  spawnSync(
    "psql",
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", database, ...args],
    {
      env,
      input,
      encoding: "utf8",
    },
  );

const identity = readFileSync(keyFile, "utf8")
  .split("\n")
  .find((line) => line.startsWith("AGE-SECRET-KEY-"));
if (!identity) {
  console.error("No age private key found in the key file.");
  process.exit(1);
}
const decrypter = new Decrypter();
decrypter.addIdentity(identity.trim());

let created = false;
let failure;
try {
  const made = psql("postgres", ["-c", `CREATE DATABASE ${scratch}`]);
  if (made.status !== 0)
    throw new Error(`Could not create a scratch database: ${made.stderr}`);
  created = true;
  // Decrypt, unzip and feed psql as a stream, so a large backup never sits in memory.
  const plain = await decrypter.decrypt(
    Readable.toWeb(createReadStream(backup)),
  );
  const load = spawn(
    "psql",
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", scratch],
    { env, stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  load.stderr.on("data", (d) => (stderr += d));
  const finished = new Promise((resolve) => load.on("close", resolve));
  // If psql stops early (a bad statement), the broken pipe is a symptom; its own message is the cause.
  const fed = pipeline(
    Readable.fromWeb(plain),
    createGunzip(),
    load.stdin,
  ).catch((e) => e);
  const status = await finished;
  const feedError = await fed;
  if (status !== 0)
    throw new Error(`Loading the dump failed: ${stderr.trim()}`);
  if (feedError) throw feedError; // for example a wrong key or a damaged file
  const counted = psql(scratch, [
    "-tA",
    "-c",
    "SELECT count(*) FROM retail_invoices",
  ]);
  if (counted.status !== 0)
    throw new Error(`Could not count bills: ${counted.stderr}`);
  console.log(
    `Restore check passed: ${counted.stdout.trim()} sales bills (retail_invoices) in the backup.`,
  );
} catch (e) {
  failure = e;
} finally {
  if (created) {
    const dropped = psql("postgres", [
      "-c",
      `DROP DATABASE IF EXISTS ${scratch}`,
    ]);
    if (dropped.status !== 0)
      console.error(
        `Could not remove scratch database ${scratch}: ${dropped.stderr}`,
      );
  }
}
if (failure) {
  console.error(`Restore check FAILED: ${failure.message}`);
  process.exit(1);
}
