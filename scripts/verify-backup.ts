import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
process.umask(0o077);
const source = new URL(process.env.DATABASE_URL!);
if (!source.hostname) throw new Error("DATABASE_URL required");
const restoreName = `counterwell_restore_${randomBytes(6).toString("hex")}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const admin = new Pool({ connectionString: adminUrl.toString() });
const directory = path.resolve(".data/backups");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const file = path.join(directory, `backup-${Date.now()}.dump`);
const env = {
  ...process.env,
  PGHOST: source.hostname,
  PGPORT: source.port || "5432",
  PGUSER: decodeURIComponent(source.username),
  PGPASSWORD: decodeURIComponent(source.password),
  PGDATABASE: source.pathname.slice(1),
};
const bin = (name: string) =>
  process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name;
const sourceDb = new Pool({ connectionString: source.toString() });
const snapshotClient = await sourceDb.connect();
let target: Pool | undefined;
try {
  await snapshotClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (
    await snapshotClient.query("SELECT pg_export_snapshot() AS id")
  ).rows[0].id;
  const major =
    (Number(
      (await snapshotClient.query("SHOW server_version_num")).rows[0]
        .server_version_num,
    ) /
      10000) |
    0;
  for (const name of ["pg_dump", "pg_restore"]) {
    const version = execFileSync(bin(name), ["--version"], {
      encoding: "utf8",
    });
    if (Number(version.match(/PostgreSQL\) (\d+)/)?.[1]) !== major)
      throw new Error(`Use PostgreSQL ${major} client tools via PG_BIN`);
  }
  execFileSync(
    bin("pg_dump"),
    ["--snapshot", snapshot, "--format=custom", "--no-owner", "--file", file],
    { env, stdio: "pipe" },
  );
  await admin.query(`CREATE DATABASE ${restoreName}`);
  execFileSync(
    bin("pg_restore"),
    ["--no-owner", "--exit-on-error", "--dbname", restoreName, file],
    { env, stdio: "pipe" },
  );
  const targetUrl = new URL(source);
  targetUrl.pathname = "/" + restoreName;
  target = new Pool({ connectionString: targetUrl.toString() });
  const tables = (
    await snapshotClient.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const counts: Record<string, number> = {};
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table name");
    const query = `SELECT count(*)::int AS n FROM "${table}"`;
    const before = (await snapshotClient.query(query)).rows[0].n;
    const restored = (await target.query(query)).rows[0].n;
    if (before !== restored) throw new Error(`Count mismatch: ${table}.`);
    counts[table] = restored;
  }
  const result = {
    verifiedAt: new Date().toISOString(),
    backup: file,
    verifiedTables: counts,
    method:
      "Full pg_dump restore into a fresh isolated database, followed by row-count comparison against the same exported PostgreSQL snapshot.",
  };
  writeFileSync(
    path.join(directory, "latest-verification.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({ ok: true, tables: tables.length, backup: file }),
  );
} finally {
  await target?.end();
  await snapshotClient.query("ROLLBACK");
  snapshotClient.release();
  await sourceDb.end();
  await admin.query(`DROP DATABASE IF EXISTS ${restoreName}`);
  await admin.end();
}
