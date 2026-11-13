import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

// Opt-in like the other database tests; uses only the dedicated counterwell_test database.
const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)("gateway outage phone alerts", () => {
  let pool: {
    query: (sql: string, values?: unknown[]) => Promise<any>;
    end(): Promise<void>;
  };
  let checkGatewayOutages: typeof import("./gateway-outage").checkGatewayOutages;
  const shop = `outage-test-${Date.now()}`;
  const never = `${shop}-never`;
  const sent: string[] = [];
  const send = async (b: string, kind: string, minutes: number) => {
    sent.push(`${b}:${kind}:${Math.round(minutes)}`);
  };
  const seen = (minutesAgo: number) =>
    pool.query(
      "UPDATE gateway_health SET last_seen=now()-make_interval(mins => $2) WHERE business_id=$1",
      [shop, minutesAgo],
    );
  const heartbeat = () =>
    pool.query(
      "INSERT INTO gateway_health(business_id,last_seen,details) VALUES($1,now(),'{}') ON CONFLICT(business_id) DO UPDATE SET last_seen=now()",
      [shop],
    );

  beforeAll(async () => {
    process.loadEnvFile(".env");
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL!.replace(/\/counterwell$/, "/counterwell_test");
    if (
      !new URL(process.env.DATABASE_URL).pathname.endsWith("/counterwell_test")
    )
      throw new Error("Tests require a dedicated counterwell_test database");
    execFileSync(
      process.execPath,
      ["--import", "tsx", "packages/db/src/migrate.ts"],
      {
        env: process.env,
        stdio: "pipe",
      },
    );
    pool = (await import("@counterwell/db")).pool;
    ({ checkGatewayOutages } = await import("./gateway-outage"));
    for (const id of [shop, never])
      await pool.query("INSERT INTO businesses(id,settings) VALUES($1,'{}')", [
        id,
      ]);
    await heartbeat();
  });
  afterAll(async () => {
    await pool.query("DELETE FROM gateway_health WHERE business_id = ANY($1)", [
      [shop, never],
    ]);
    await pool.query("DELETE FROM businesses WHERE id = ANY($1)", [
      [shop, never],
    ]);
    await pool.end();
  });
  const mine = () => sent.filter((s) => s.startsWith(shop));

  it("says nothing while the gateway is reporting, or for a shop that never had one", async () => {
    await checkGatewayOutages(send);
    expect(mine()).toEqual([]);
    expect(sent.some((s) => s.startsWith(never))).toBe(false);
  });
  it("says nothing for a gap shorter than 30 minutes", async () => {
    await seen(29);
    await checkGatewayOutages(send);
    expect(mine()).toEqual([]);
  });
  it("sends one notification when it passes 30 minutes, and none on later checks or restarts", async () => {
    await seen(31);
    await checkGatewayOutages(send);
    expect(mine()).toEqual([`${shop}:silent:31`]);
    await seen(200);
    await checkGatewayOutages(send);
    await checkGatewayOutages(send); // a second worker or a restarted one
    expect(mine()).toHaveLength(1);
  });
  it("sends one 'back' when it reports again, then re-arms for the next outage", async () => {
    await heartbeat();
    await checkGatewayOutages(send);
    await checkGatewayOutages(send);
    expect(mine().filter((s) => s.includes(":back:"))).toHaveLength(1);
    await seen(45);
    await checkGatewayOutages(send);
    expect(mine().filter((s) => s.includes(":silent:"))).toHaveLength(2);
  });
  it("does not let a failing send stop the pass or repeat the alert", async () => {
    await heartbeat();
    await checkGatewayOutages(send);
    await seen(40);
    const failing = async () => {
      throw new Error("push provider down");
    };
    await expect(checkGatewayOutages(failing)).resolves.toBeDefined();
    const before = mine().length;
    await checkGatewayOutages(send);
    expect(mine()).toHaveLength(before);
  });
});
