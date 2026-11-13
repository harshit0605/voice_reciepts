import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Opt-in like the other database tests; uses only the dedicated counterwell_test database.
const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)("API health, heartbeat and backup routes", () => {
  let app: Awaited<typeof import("./app")>["app"];
  let pool: {
    query: (sql: string, values?: unknown[]) => Promise<any>;
    end(): Promise<void>;
  };
  let dir = "";
  const shop = `health-test-${Date.now()}`;
  const token = randomBytes(24).toString("hex");
  const call = (route: string, init: RequestInit = {}) =>
    app.request(`http://localhost:4100${route}`, init);

  beforeAll(async () => {
    process.loadEnvFile(".env");
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL!.replace(/\/counterwell$/, "/counterwell_test");
    if (
      !new URL(process.env.DATABASE_URL).pathname.endsWith("/counterwell_test")
    )
      throw new Error("Tests require a dedicated counterwell_test database");
    dir = await mkdtemp(path.join(tmpdir(), "counterwell-health-"));
    Object.assign(process.env, {
      GATEWAY_TOKEN: token,
      BUSINESS_ID: shop,
      BACKUP_DIR: dir,
    });
    execFileSync(
      process.execPath,
      ["--import", "tsx", "packages/db/src/migrate.ts"],
      {
        env: process.env,
        stdio: "pipe",
      },
    );
    pool = (await import("@counterwell/db")).pool;
    ({ app } = await import("./app"));
    await pool.query("INSERT INTO businesses(id,settings) VALUES($1,'{}')", [
      shop,
    ]);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM gateway_health WHERE business_id=$1", [shop]);
    await pool.query("DELETE FROM businesses WHERE id=$1", [shop]);
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });

  it("/health reports the newest backup's age in hours, and no names or paths", async () => {
    let body = await (await call("/health")).json();
    expect(body.backupAgeHours).toBeNull();
    const file = path.join(dir, "counterwell-2026-11-12-0300.sql.gz.age");
    await writeFile(file, "x");
    const eightHours = new Date(Date.now() - 8 * 3_600_000);
    await utimes(file, eightHours, eightHours);
    body = await (await call("/health")).json();
    expect(body.ok).toBe(true);
    expect(body.backupAgeHours).toBeCloseTo(8, 0);
    expect(JSON.stringify(body)).not.toMatch(/counterwell-2026|\/tmp|\/var/);
  });
  it("/health leaves the age out when no backup folder is mounted", async () => {
    delete process.env.BACKUP_DIR;
    const body = await (await call("/health")).json();
    expect(body).toEqual({ ok: true, service: "counterwell-api" });
    process.env.BACKUP_DIR = dir;
  });
  it("the backup list uses the same token check as the heartbeat", async () => {
    const route = "/api/v1/gateway/backups";
    expect((await call(route)).status).toBe(401);
    expect(
      (await call(route, { headers: { "X-Gateway-Token": "x" } })).status,
    ).toBe(401);
    const ok = await call(route, { headers: { "X-Gateway-Token": token } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).backups).toHaveLength(1);
  });
  it("the heartbeat stores when the newest backup was copied to the shop PC", async () => {
    const at = new Date().toISOString();
    const r = await call("/api/v1/gateway/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gateway-Token": token },
      body: JSON.stringify({
        printerConfigured: true,
        printBacklog: 0,
        uncertainPrints: 0,
        cameraBacklog: 0,
        lastBackupCopiedAt: at,
      }),
    });
    expect(r.status).toBe(200);
    const row = await pool.query(
      "SELECT details FROM gateway_health WHERE business_id=$1",
      [shop],
    );
    expect(row.rows[0].details.lastBackupCopiedAt).toBe(at);
  });
});
