import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { demoState, type Command, type Operation } from "../src";
// Explicit opt-in. Never run migrations against the application database.
const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)("API contract as the phones use it", () => {
  let app: any,
    auth: any,
    db: any,
    ownerCookie = "",
    employeeCookie = "",
    disabledCookie = "",
    mustChangeCookie = "",
    ownerId = "",
    employeeId = "",
    disabledId = "",
    mustChangeId = "",
    businessId = "",
    otherBusinessId = "",
    deviceId = "",
    lease = "";
  let sequence = 0;
  let uploadDir = "";
  const ids: string[] = [];
  const password = "Integration-password-2026";
  const make = (
    operation: Operation,
    at = new Date().toISOString(),
  ): Command => ({ id: randomUUID(), occurredAt: at, operation });
  async function raw(
    route: string,
    init: {
      method?: string;
      body?: BodyInit;
      headers?: Record<string, string>;
    },
  ) {
    const r = await app.request(`http://localhost:4100${route}`, init);
    const text = await r.text();
    let data: any = undefined;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: r.status, data, text, response: r };
  }
  async function req(
    route: string,
    body?: unknown,
    cookie = ownerCookie,
    business = businessId,
    method?: string,
  ) {
    return raw(route, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8081",
        Cookie: cookie,
        "X-Business-Id": business,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  const command = (operation: Operation, cookie = ownerCookie) =>
    req("/api/v1/commands", make(operation), cookie);
  async function order(id = randomUUID(), batchId = "dolo-b1") {
    const r = await command({
      type: "order.save",
      orderId: id,
      version: 0,
      lines: [{ batchId, quantity: "1", unit: "tablet", confirmed: true }],
      counterId: "counter-1",
    });
    expect(r.status).toBe(200);
    return id;
  }
  const checkout = (orderId: string, n: number, cash = 280): Operation => ({
    type: "checkout",
    orderId,
    version: 1,
    deviceId,
    sequence: n,
    cashPaise: cash,
    upiPaise: 0,
    creditPaise: 0,
    discountPaise: 0,
  });
  const offline = (sequenceNo = ++sequence, orderId = randomUUID()): Command =>
    make({
      type: "offline.checkout",
      deviceId,
      sequence: sequenceNo,
      orderId,
      counterId: "counter-1",
      dispenserId: ownerId,
      cashPaise: 280,
      lines: [
        {
          batchId: "dolo-b1",
          quantity: "1",
          unit: "tablet",
          confirmed: true,
          pricePaise: 280,
          taxBps: 1200,
        },
      ],
    });
  const claimed = async (id: string) =>
    (
      await db.pool.query(
        "UPDATE jobs SET status='running',attempts=attempts+1,locked_at=now() WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
  const stateNow = () => db.readState(businessId);
  const qty = async (batch: string) =>
    Number((await stateNow()).batches[batch].quantity);
  async function signIn(username: string) {
    // better-auth throttles sign-in to a few per 10 seconds; wait the throttle out.
    let result = await req(
      "/api/auth/sign-in/username",
      { username, password },
      "",
      "",
    );
    for (let i = 0; i < 3 && result.status === 429; i++) {
      await new Promise((r) => setTimeout(r, 11_000));
      result = await req(
        "/api/auth/sign-in/username",
        { username, password },
        "",
        "",
      );
    }
    expect(result.status).toBe(200);
    return result.response.headers
      .getSetCookie()
      .map((x: string) => x.split(";")[0])
      .join("; ");
  }
  async function signUp(name: string, username: string, email: string) {
    const u = await auth.api.signUpEmail({
      body: { name, email, username, password },
    });
    ids.push(u.user.id);
    return u.user.id as string;
  }
  beforeAll(async () => {
    process.loadEnvFile(".env");
    uploadDir = await mkdtemp(path.join(tmpdir(), "counterwell-contract-"));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL!.replace(/\/counterwell$/, "/counterwell_test");
    if (
      !new URL(process.env.DATABASE_URL!).pathname.endsWith("/counterwell_test")
    )
      throw new Error("Tests require a dedicated counterwell_test database");
    execFileSync(
      process.execPath,
      ["--import", "tsx", "packages/db/src/migrate.ts"],
      { env: process.env, stdio: "pipe" },
    );
    db = await import("@counterwell/db");
    ({ app } = await import("../../../apps/api/src/app"));
    ({ auth } = await import("../../../apps/api/src/auth"));
    const suffix = randomUUID().slice(0, 8);
    const mk = (n: string) => `${n}-${suffix}@accounts.invalid`;
    ownerId = await signUp("C owner", `cowner_${suffix}`, mk("cowner"));
    employeeId = await signUp("C staff", `cstaff_${suffix}`, mk("cstaff"));
    disabledId = await signUp("C off", `coff_${suffix}`, mk("coff"));
    mustChangeId = await signUp("C temp", `ctemp_${suffix}`, mk("ctemp"));
    ownerCookie = await signIn(`cowner_${suffix}`);
    employeeCookie = await signIn(`cstaff_${suffix}`);
    disabledCookie = await signIn(`coff_${suffix}`);
    mustChangeCookie = await signIn(`ctemp_${suffix}`);
    businessId = `contract-${suffix}`;
    otherBusinessId = `contract-other-${suffix}`;
    const state = demoState(businessId, ownerId, employeeId);
    for (const [id, name] of [
      [disabledId, "Disabled"],
      [mustChangeId, "Temporary"],
    ])
      state.members[id] = {
        id,
        name,
        role: "employee",
        active: id !== disabledId,
        mustChangePassword: id === mustChangeId,
        canCollect: true,
      };
    await db.createBusiness(state);
    await db.createBusiness(
      demoState(otherBusinessId, "other-owner", "other-employee"),
    );
    deviceId = randomUUID();
    const d = await req("/api/v1/devices/register", {
      id: deviceId,
      name: "Contract device",
      counterId: "counter-1",
    });
    expect(d.status).toBe(200);
    lease = d.data.lease;
  }, 90000);
  afterAll(async () => {
    if (!db) return;
    for (const business of [businessId, otherBusinessId])
      if (business) {
        for (const name of (await import("../src")).collections)
          await db.pool.query(
            `DELETE FROM retail_${name} WHERE business_id=$1`,
            [business],
          );
        await db.pool.query("DELETE FROM jobs WHERE business_id=$1", [
          business,
        ]);
        await db.pool.query("DELETE FROM businesses WHERE id=$1", [business]);
      }
    for (const id of ids)
      await db.pool.query("DELETE FROM auth_user WHERE id=$1", [id]);
    await db.pool.end();
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  it("command idempotency: same id and body applies once; same id with a different body is a 409 CONFLICT", async () => {
    const orderId = await order();
    const cmd = make(checkout(orderId, ++sequence));
    const stockBefore = await qty("dolo-b1");
    const first = await req("/api/v1/commands", cmd);
    expect(first.status).toBe(200);
    const afterFirst = await stateNow();
    const second = await req("/api/v1/commands", cmd);
    expect(second.status).toBe(200);
    expect(second.data).toEqual(first.data);
    const afterReplay = await stateNow();
    expect(afterReplay.revision).toBe(afterFirst.revision);
    expect(Object.keys(afterReplay.invoices)).toHaveLength(
      Object.keys(afterFirst.invoices).length,
    );
    expect(Number(afterReplay.batches["dolo-b1"].quantity)).toBe(
      stockBefore - 1,
    );
    const changed = {
      ...cmd,
      operation: { ...cmd.operation, cashPaise: 281 },
    };
    const conflict = await req("/api/v1/commands", changed);
    expect(conflict.status).toBe(409);
    expect(conflict.data.code).toBe("CONFLICT");
    expect(await qty("dolo-b1")).toBe(stockBefore - 1);
  });

  it("an employee cannot replay or hijack the owner's command id", async () => {
    const cmd = make({
      type: "order.save",
      orderId: randomUUID(),
      version: 0,
      lines: [
        { batchId: "dolo-b1", quantity: "1", unit: "tablet", confirmed: true },
      ],
      counterId: "counter-1",
    });
    expect((await req("/api/v1/commands", cmd)).status).toBe(200);
    const stolen = await req("/api/v1/commands", cmd, employeeCookie);
    expect(stolen.status).toBe(409);
    expect(stolen.data.code).toBe("CONFLICT");
  });

  it("offline sync: replaying a batch is idempotent and returns the same result", async () => {
    const c = offline();
    const stockBefore = await qty("dolo-b1");
    const a = await req("/api/v1/sync", { entries: [{ command: c, lease }] });
    expect(a.status).toBe(200);
    expect(a.data.results[0].status).toBe("synced");
    const invoices = Object.keys((await stateNow()).invoices).length;
    const b = await req("/api/v1/sync", {
      entries: [
        { command: c, lease },
        { command: c, lease },
      ],
    });
    expect(b.data.results.map((r: any) => r.status)).toEqual([
      "synced",
      "synced",
    ]);
    expect(b.data.results[0].result).toEqual(a.data.results[0].result);
    expect(Object.keys((await stateNow()).invoices)).toHaveLength(invoices);
    expect(await qty("dolo-b1")).toBe(stockBefore - 1);
  });

  it("offline sync: malformed entries come back invalid and never block later valid entries", async () => {
    const good = offline();
    const online = make(checkout(randomUUID(), ++sequence));
    const r = await req("/api/v1/sync", {
      entries: [
        {},
        { command: null, lease },
        { command: { id: "half-sent" }, lease },
        { command: good, lease: 42 },
        { command: online, lease },
        { command: good, lease },
      ],
    });
    expect(r.status).toBe(200);
    const results = r.data.results;
    expect(results).toHaveLength(6);
    expect(results[0]).toMatchObject({ id: null, status: "invalid" });
    expect(results[1]).toMatchObject({ id: null, status: "invalid" });
    expect(results[2]).toMatchObject({ id: "half-sent", status: "invalid" });
    expect(results[3]).toMatchObject({ id: good.id, status: "invalid" });
    expect(results[4]).toMatchObject({ id: online.id, status: "invalid" });
    expect(results[5]).toMatchObject({ id: good.id, status: "synced" });
    expect((await stateNow()).invoices[`${good.id}:invoice`]).toBeDefined();
  });

  it("offline sync: reused command id with a different body is reported as conflict, a bad lease goes to review", async () => {
    const c = offline();
    expect(
      (await req("/api/v1/sync", { entries: [{ command: c, lease }] })).data
        .results[0].status,
    ).toBe("synced");
    const tampered = {
      ...c,
      operation: { ...c.operation, cashPaise: 1 },
    };
    const clash = await req("/api/v1/sync", {
      entries: [
        { command: tampered, lease },
        { command: offline(), lease },
      ],
    });
    expect(clash.status).toBe(200);
    expect(clash.data.results.map((r: any) => r.status)).toEqual([
      "conflict",
      "synced",
    ]);
    const forged = offline();
    const bad = await req("/api/v1/sync", {
      entries: [{ command: forged, lease: "forged" }],
    });
    expect(bad.data.results[0].status).toBe("review_required");
    // Replay of a quarantined command stays review_required and does not post.
    const again = await req("/api/v1/sync", {
      entries: [{ command: forged, lease }],
    });
    expect(again.data.results[0].status).toBe("review_required");
    expect((await stateNow()).invoices[`${forged.id}:invoice`]).toBeUndefined();
    // Once the owner rejects it, replays report the resolved state.
    expect(
      (
        await req(`/api/v1/recovery/${forged.id}`, {
          accept: false,
          reason: "Not a real sale",
        })
      ).status,
    ).toBe(200);
    const resolved = await req("/api/v1/sync", {
      entries: [{ command: forged, lease: "forged" }],
    });
    expect(resolved.data.results[0].status).toBe("resolved_rejected");
  });

  it("offline sync: an entry signed for another device or from the future is not posted", async () => {
    const wrongDevice = make({
      ...(offline().operation as any),
      deviceId: randomUUID(),
    });
    const future = make(
      offline().operation as any,
      new Date(Date.now() + 3600_000).toISOString(),
    );
    const r = await req("/api/v1/sync", {
      entries: [
        { command: wrongDevice, lease },
        { command: future, lease },
      ],
    });
    expect(r.data.results.map((x: any) => x.status)).toEqual([
      "review_required",
      "review_required",
    ]);
    const s = await stateNow();
    expect(s.invoices[`${wrongDevice.id}:invoice`]).toBeUndefined();
    expect(s.invoices[`${future.id}:invoice`]).toBeUndefined();
  });

  it("GET /sync?since=N: delta contains the change, is unchanged when nothing changed, and revisions only grow", async () => {
    const start = await req("/api/v1/sync?since=-1");
    expect(start.status).toBe(200);
    const rev0 = start.data.revision;
    expect(start.data.changes.products.dolo).toBeDefined();
    const same = await req(`/api/v1/sync?since=${rev0}`);
    expect(same.data).toEqual({ revision: rev0, unchanged: true });
    const id = await order();
    const delta = await req(`/api/v1/sync?since=${rev0}`);
    expect(delta.data.unchanged).toBeUndefined();
    expect(delta.data.revision).toBeGreaterThan(rev0);
    expect(delta.data.changes.orders[id]).toBeDefined();
    expect(Object.keys(delta.data.changes.products)).toHaveLength(0);
    // A replayed command does not bump the revision.
    const c = make(checkout(id, ++sequence));
    const posted = await req("/api/v1/commands", c);
    expect(posted.status).toBe(200);
    const rev1 = (await req("/api/v1/sync?since=-1")).data.revision;
    expect(rev1).toBeGreaterThan(delta.data.revision);
    await req("/api/v1/commands", c);
    expect((await req("/api/v1/sync?since=-1")).data.revision).toBe(rev1);
    // A client that is ahead of the server still gets a full-looking delta, not an error.
    const ahead = await req(`/api/v1/sync?since=${rev1 + 1000}`);
    expect(ahead.status).toBe(200);
    expect(ahead.data.revision).toBe(rev1);
    // Default since is a full snapshot.
    expect((await req("/api/v1/sync")).data.changes.orders[id]).toBeDefined();
  });

  it("device registration is idempotent, renews the lease, and heartbeat with an unknown or foreign device fails cleanly", async () => {
    const id = randomUUID();
    const body = { id, name: "Renewal phone", counterId: "counter-1" };
    const one = await req("/api/v1/devices/register", body);
    expect(one.status).toBe(200);
    const devicesBefore = Object.keys((await stateNow()).devices).length;
    await new Promise((r) => setTimeout(r, 15));
    const two = await req("/api/v1/devices/register", body);
    expect(two.status).toBe(200);
    expect(two.data.device.series).toBe(one.data.device.series);
    expect(Date.parse(two.data.expiresAt)).toBeGreaterThan(
      Date.parse(one.data.expiresAt),
    );
    expect(two.data.lease).toEqual(expect.any(String));
    expect(Object.keys((await stateNow()).devices)).toHaveLength(devicesBefore);
    // The renewed lease is accepted by sync.
    const sale = offline();
    sale.operation = { ...(sale.operation as any), deviceId: id };
    const synced = await req("/api/v1/sync", {
      entries: [{ command: sale, lease: two.data.lease }],
    });
    expect(synced.data.results[0].status).toBe("synced");
    const beat = await req("/api/v1/devices/heartbeat", {
      deviceId: id,
      pendingCount: 0,
    });
    expect(beat).toMatchObject({ status: 200, data: { ok: true } });
    const unknown = await req("/api/v1/devices/heartbeat", {
      deviceId: randomUUID(),
      pendingCount: 0,
    });
    expect(unknown.status).toBe(403);
    expect(unknown.data.error).toBe("Device unavailable");
    // Another user cannot take over or beat someone else's device.
    expect(
      (await req("/api/v1/devices/register", body, employeeCookie)).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/api/v1/devices/heartbeat",
          { deviceId: id, pendingCount: 0 },
          employeeCookie,
        )
      ).status,
    ).toBe(403);
    // A revoked device can no longer renew or beat.
    expect(
      (await command({ type: "device.revoke", deviceId: id })).status,
    ).toBe(200);
    expect((await req("/api/v1/devices/register", body)).status).toBe(403);
    expect(
      (
        await req("/api/v1/devices/heartbeat", {
          deviceId: id,
          pendingCount: 0,
        })
      ).status,
    ).toBe(403);
  });

  it("auth: no cookie is a 401 JSON, wrong or missing business id is rejected", async () => {
    for (const route of ["/api/v1/state", "/api/v1/sync", "/api/v1/me"]) {
      const r = await raw(route, {
        headers: { Origin: "http://localhost:8081" },
      });
      expect(r.status).toBe(401);
      expect(r.response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(r.data.error).toBeTruthy();
    }
    const post = await raw("/api/v1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(post.status).toBe(401);
    expect(
      (await req("/api/v1/state", undefined, ownerCookie, otherBusinessId))
        .status,
    ).toBe(403);
    expect(
      (await req("/api/v1/state", undefined, ownerCookie, "does-not-exist"))
        .status,
    ).toBe(403);
    expect(
      (await req("/api/v1/state", undefined, ownerCookie, "")).status,
    ).toBe(400);
    expect((await req("/api/v1/me", undefined, ownerCookie, "")).status).toBe(
      200,
    );
  });

  it("auth: an employee gets 403 on every owner-only route", async () => {
    const calls: [string, unknown?, string?][] = [
      ["/api/v1/extractions"],
      [
        "/api/v1/employees",
        {
          name: "x",
          username: "someone_x",
          password: "long-enough-pass-1",
          canCollect: true,
        },
      ],
      [`/api/v1/employees/${employeeId}`, { active: false }, "PATCH"],
      [
        `/api/v1/employees/${ownerId}/password`,
        { password: "long-enough-pass-1" },
      ],
      ["/api/v1/reports"],
      ["/api/v1/operations"],
      ["/api/v1/documents/whatever"],
      ["/api/v1/recovery/import", { entries: [] }],
      [`/api/v1/recovery/${randomUUID()}`, { accept: true, reason: "because" }],
      [`/api/v1/extractions/${randomUUID()}/retry`, {}],
    ];
    for (const [route, body, method] of calls) {
      const r = await req(route, body, employeeCookie, businessId, method);
      expect([route, r.status]).toEqual([route, 403]);
      expect(r.data.error).toBeTruthy();
    }
    // Owner-gated engine operations too.
    const r = await command(
      {
        type: "settings.update",
        settings: {
          name: "Hack",
          address: "x",
          gstin: "09DEMOA0000A1Z5",
          drugLicence: "x",
          stateCode: "09",
          phone: "",
          upiId: "",
          gatewayUrl: "",
          readinessConfirmed: true,
        },
      },
      employeeCookie,
    );
    expect(r.status).toBe(403);
    // Employees cannot rewrite the owner's access.
    expect(
      (
        await req(
          `/api/v1/employees/${ownerId}`,
          { active: false },
          ownerCookie,
          businessId,
          "PATCH",
        )
      ).status,
    ).toBe(400);
  });

  it("auth: a disabled member gets 'Account disabled'; /sync is the one recovery ingress", async () => {
    const state = await req("/api/v1/state", undefined, disabledCookie);
    expect(state.status).toBe(403);
    expect(state.data.error).toBe("Account disabled");
    const cmd = await command(
      {
        type: "customer.create",
        customer: { id: randomUUID(), name: "N", phone: "", address: "" },
      },
      disabledCookie,
    );
    expect(cmd.status).toBe(403);
    expect(cmd.data.error).toBe("Account disabled");
    // Delta pull is refused with a clean 403, not a 500.
    const delta = await req("/api/v1/sync", undefined, disabledCookie);
    expect(delta.status).toBe(403);
    expect(delta.data.error).toBe("Account disabled");
    // Offline sales queued before the account was disabled are preserved for review, never posted.
    const sale = offline();
    const posted = await req(
      "/api/v1/sync",
      { entries: [{ command: sale, lease }] },
      disabledCookie,
    );
    expect(posted.status).toBe(200);
    expect(posted.data.results[0].status).toBe("review_required");
    expect((await stateNow()).invoices[`${sale.id}:invoice`]).toBeUndefined();
  });

  it("auth: a temporary password blocks business routes with PASSWORD_CHANGE_REQUIRED until changed", async () => {
    for (const route of ["/api/v1/state", "/api/v1/sync"]) {
      const r = await req(route, undefined, mustChangeCookie);
      expect(r.status).toBe(403);
      expect(r.data.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    const blocked = await command(
      {
        type: "customer.create",
        customer: { id: randomUUID(), name: "N", phone: "", address: "" },
      },
      mustChangeCookie,
    );
    expect(blocked.data.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(
      (await req("/api/v1/me", undefined, mustChangeCookie, "")).status,
    ).toBe(200);
    const change = await req(
      "/api/auth/change-password",
      {
        currentPassword: password,
        newPassword: "Another-password-2027",
        revokeOtherSessions: false,
      },
      mustChangeCookie,
      "",
    );
    expect(change.status).toBe(200);
    expect((await stateNow()).members[mustChangeId].mustChangePassword).toBe(
      false,
    );
    const fresh = change.response.headers
      .getSetCookie()
      .map((x: string) => x.split(";")[0])
      .join("; ");
    expect(
      (await req("/api/v1/state", undefined, fresh || mustChangeCookie)).status,
    ).toBe(200);
  });

  it("public sign-up is blocked", async () => {
    const r = await req(
      "/api/auth/sign-up/email",
      {
        name: "x",
        email: "x@accounts.invalid",
        password,
        username: "nobody_x",
      },
      "",
      "",
    );
    expect(r.status).toBe(403);
  });

  it("unknown API routes answer with a JSON body, never an HTML or text page", async () => {
    const unauth = await raw("/api/v1/nope", {
      headers: { Origin: "http://localhost:8081" },
    });
    expect(unauth.response.headers.get("content-type")).toContain(
      "application/json",
    );
    expect([401, 404]).toContain(unauth.status);
    const auth1 = await req("/api/v1/does-not-exist");
    expect(auth1.status).toBe(404);
    expect(auth1.response.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(auth1.data).toEqual({ error: "Not found" });
    const outside = await raw("/nothing-here", {});
    expect(outside.status).toBe(404);
    expect(outside.response.headers.get("content-type")).toContain(
      "application/json",
    );
    // Wrong method on a real route is also JSON.
    const wrongMethod = await req("/api/v1/commands", undefined);
    expect(wrongMethod.status).toBe(404);
    expect(wrongMethod.data).toBeDefined();
  });

  it("input validation: bad bodies are 400 JSON, never 500", async () => {
    const bad: [string, unknown, string?][] = [
      ["/api/v1/commands", {}],
      [
        "/api/v1/commands",
        { id: "x y", occurredAt: "yesterday", operation: {} },
      ],
      [
        "/api/v1/commands",
        {
          id: "a",
          occurredAt: new Date().toISOString(),
          operation: { type: "nope" },
        },
      ],
      [
        "/api/v1/commands",
        make({
          type: "order.save",
          orderId: "o",
          version: 0,
          lines: [],
          counterId: "c",
        }),
      ],
      [
        "/api/v1/commands",
        { ...make({ type: "eod.close", date: "2026-02-31" }) },
      ],
      ["/api/v1/commands", [] as unknown],
      ["/api/v1/commands", null],
      ["/api/v1/commands", "text"],
      [
        "/api/v1/devices/register",
        { id: "not-a-uuid", name: "x", counterId: "c" },
      ],
      [
        "/api/v1/devices/register",
        { id: randomUUID(), name: "", counterId: "bad id!" },
      ],
      ["/api/v1/devices/heartbeat", { deviceId: "x", pendingCount: -1 }],
      ["/api/v1/devices/heartbeat", { deviceId: 5, pendingCount: 1 }],
      [
        "/api/v1/devices/push",
        { deviceId: "x", token: "short", platform: "ios", language: "en" },
      ],
      ["/api/v1/sync", { entries: "nope" }],
      ["/api/v1/sync", {}],
      ["/api/v1/sync", { entries: Array.from({ length: 101 }, () => ({})) }],
      ["/api/v1/extractions/text", { text: "", saleId: randomUUID() }],
      ["/api/v1/extractions/text", { text: "ok", saleId: "nope" }],
      [
        "/api/v1/extractions/text",
        { text: "ok", saleId: randomUUID(), extra: 1 },
      ],
      [
        "/api/v1/extractions/text",
        { text: "x".repeat(4001), saleId: randomUUID() },
      ],
      [
        "/api/v1/employees",
        { name: "x", username: "a", password: "short", canCollect: true },
      ],
      [`/api/v1/employees/${employeeId}`, { name: 5 }, "PATCH"],
      [`/api/v1/employees/${employeeId}/password`, { password: "short" }],
      [
        `/api/v1/employees/${randomUUID()}/password`,
        { password: "long-enough-pass-1" },
      ],
      [`/api/v1/employees/${randomUUID()}`, { active: false }, "PATCH"],
      ["/api/v1/recovery/import", { entries: [{ lease: 1 }] }],
      [`/api/v1/recovery/${randomUUID()}`, { accept: "yes" }],
      [
        `/api/v1/recovery/${randomUUID()}`,
        { accept: true, reason: "long enough" },
      ],
    ];
    for (const [route, body, method] of bad) {
      const r = await req(
        route,
        body,
        ownerCookie,
        businessId,
        method ?? "POST",
      );
      const label = `${method ?? "POST"} ${route} ${JSON.stringify(body)?.slice(0, 60)}`;
      expect([label, r.status]).toEqual([label, 400]);
      expect(r.response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(r.data.error).toBeTruthy();
    }
    // Zod failures carry issues.
    const issues = await req("/api/v1/commands", {});
    expect(Array.isArray(issues.data.issues)).toBe(true);
    expect(issues.data.issues.length).toBeGreaterThan(0);
    // Unparseable JSON.
    for (const route of [
      "/api/v1/commands",
      "/api/v1/sync",
      "/api/v1/devices/register",
    ]) {
      const r = await raw(route, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: ownerCookie,
          "X-Business-Id": businessId,
        },
        body: "{not json",
      });
      expect([route, r.status]).toEqual([route, 400]);
      expect(r.data.error).toBeTruthy();
    }
    // Bad query string.
    for (const since of ["abc", "-5", "1.5"]) {
      const r = await req(`/api/v1/sync?since=${since}`);
      expect([since, r.status]).toEqual([since, 400]);
    }
  });

  it("input validation: multipart uploads reject missing kind, file, and unsupported types with 400", async () => {
    const send = async (build: (f: FormData) => void, cookie = ownerCookie) => {
      const form = new FormData();
      build(form);
      return raw("/api/v1/extractions", {
        method: "POST",
        headers: { Cookie: cookie, "X-Business-Id": businessId },
        body: form,
      });
    };
    expect((await send(() => {})).status).toBe(400);
    expect((await send((f) => f.append("kind", "other"))).status).toBe(400);
    expect((await send((f) => f.append("kind", "invoice"))).status).toBe(400);
    expect(
      (
        await send((f) => {
          f.append("kind", "invoice");
          f.append("file", new Blob(["x"], { type: "text/html" }), "a.html");
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send((f) => {
          f.append("kind", "invoice");
          f.append("file", new Blob([], { type: "application/pdf" }), "a.pdf");
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send((f) => {
          f.append("kind", "voice");
          f.append("saleId", "nope");
          f.append("recordedSeconds", "5");
          f.append("file", new Blob(["x"], { type: "audio/mp4" }), "a.m4a");
        }, employeeCookie)
      ).status,
    ).toBe(400);
    expect(
      (
        await send((f) => {
          f.append("kind", "voice");
          f.append("saleId", randomUUID());
          f.append("file", new Blob(["x"], { type: "audio/mp4" }), "a.m4a");
        }, employeeCookie)
      ).status,
    ).toBe(400);
    // Non-multipart body to an upload route is a client error, not a 500.
    const notForm = await req("/api/v1/extractions", { kind: "invoice" });
    expect(notForm.status).toBe(400);
    expect(notForm.data.error).toBeTruthy();
  });

  it("semantically invalid commands are 4xx with a message, never 500", async () => {
    const cases: Operation[] = [
      checkout(randomUUID(), ++sequence),
      { type: "order.accept", orderId: randomUUID(), version: 1 },
      {
        type: "order.cancel",
        orderId: randomUUID(),
        version: 1,
        reason: "no such",
      },
      {
        type: "order.save",
        orderId: randomUUID(),
        version: 0,
        counterId: "counter-1",
        lines: [
          {
            batchId: "no-such-batch",
            quantity: "1",
            unit: "tablet",
            confirmed: true,
          },
        ],
      },
      {
        type: "order.save",
        orderId: randomUUID(),
        version: 0,
        counterId: "counter-1",
        lines: [
          {
            batchId: "dolo-b1",
            quantity: "1",
            unit: "bottle",
            confirmed: true,
          },
        ],
      },
      {
        type: "order.save",
        orderId: randomUUID(),
        version: 0,
        counterId: "counter-1",
        customerId: "ghost",
        lines: [
          {
            batchId: "dolo-b1",
            quantity: "1",
            unit: "tablet",
            confirmed: true,
          },
        ],
      },
      { type: "approval.decide", approvalId: "ghost", approve: true },
      {
        type: "refund.execute",
        approvalId: "ghost",
        cashPaise: 1,
        upiPaise: 0,
      },
      { type: "stock.execute", approvalId: "ghost" },
      { type: "device.revoke", deviceId: "ghost" },
      { type: "review.resolve", reviewId: "ghost", resolution: "whatever" },
      { type: "drawer.close", drawerId: "ghost", countedPaise: 0 },
      {
        type: "credit.repay",
        customerId: "ghost",
        amountPaise: 10,
        method: "cash",
      },
      {
        type: "batch.price",
        batchId: "ghost",
        pricePaise: 10,
        reason: "because",
      },
    ];
    for (const op of cases) {
      const r = await command(op);
      const label = `${op.type} ${r.status} ${r.text.slice(0, 120)}`;
      expect([label, r.status >= 400 && r.status < 500]).toEqual([label, true]);
      expect(r.data.error).toBeTruthy();
    }
    // Gateway-only and offline-only operations are fenced off from /commands.
    const obs = await command({
      type: "coverage.gap",
      source: "camera",
      detail: "x",
    });
    expect(obs.status).toBe(403);
    const off = await req("/api/v1/commands", offline());
    expect(off.status).toBe(400);
  });

  it("text extraction lifecycle: queued, deduplicated, completed, then readable by its author only", async () => {
    const saleId = randomUUID();
    const text = `Zzyzx tonic ${randomUUID()} two bottles`;
    const queued = await req(
      "/api/v1/extractions/text",
      { text, saleId },
      employeeCookie,
    );
    expect(queued.status).toBe(202);
    const again = await req(
      "/api/v1/extractions/text",
      { text, saleId },
      employeeCookie,
    );
    expect(again.status).toBe(200);
    expect(again.data.id).toBe(queued.data.id);
    const pending = await req(
      `/api/v1/extractions/${queued.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(pending.data).toMatchObject({ status: "pending", transcript: text });
    const { processClaimedExtraction } =
      await import("../../../apps/api/src/process-extraction");
    const structure = async (t: string) => ({
      transcript: t,
      draft: { items: [] },
      provider: "test",
      model: "test",
      usage: null,
      requiresReview: true,
    });
    const done = await processClaimedExtraction(await claimed(queued.data.id), {
      structure,
      catalogue: async () => [],
    } as any);
    expect(done.status).toBe("completed");
    const job = await req(
      `/api/v1/extractions/${queued.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(job.data).toMatchObject({ status: "completed", error: null });
    expect(job.data.output.provider).toBe("test");
    expect(job.data.output.latencyMs).toEqual(expect.any(Number));
    // A re-post after completion returns the finished job instead of a second paid call.
    const reuse = await req(
      "/api/v1/extractions/text",
      { text, saleId },
      employeeCookie,
    );
    expect(reuse.data.id).toBe(queued.data.id);
    // Not visible to a different employee-level actor or another business; owner may read it.
    expect(
      (
        await req(
          `/api/v1/extractions/${queued.data.id}`,
          undefined,
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await req(
          `/api/v1/extractions/${queued.data.id}`,
          undefined,
          ownerCookie,
          otherBusinessId,
        )
      ).status,
    ).toBe(403);
    expect(
      (await req(`/api/v1/extractions/${randomUUID()}`, undefined, ownerCookie))
        .status,
    ).toBe(404);
    expect(
      (await req("/api/v1/extractions/not-a-uuid", undefined, ownerCookie))
        .status,
    ).toBe(404);
  });

  it("text extraction: provider account problems fail with the staff-facing message", async () => {
    const queued = await req(
      "/api/v1/extractions/text",
      { text: `Quux syrup ${randomUUID()}`, saleId: randomUUID() },
      employeeCookie,
    );
    const { processClaimedExtraction } =
      await import("../../../apps/api/src/process-extraction");
    for (const code of [401, 402, 403]) {
      await db.pool.query(
        "UPDATE jobs SET status='pending',attempts=0,error=NULL WHERE id=$1",
        [queued.data.id],
      );
      const outcome = await processClaimedExtraction(
        await claimed(queued.data.id),
        {
          structure: async () => {
            throw new Error(
              `Structure provider returned ${code}: out of credit`,
            );
          },
          catalogue: async () => [],
        } as any,
      );
      expect(outcome.status).toBe("failed");
      const job = await req(
        `/api/v1/extractions/${queued.data.id}`,
        undefined,
        employeeCookie,
      );
      expect(job.data.status).toBe("failed");
      expect(job.data.error).toBe(
        "Voice entry is unavailable right now. Type exact catalogue names, or use search.",
      );
    }
  });

  it("text extraction: a transient 503 leaves the job pending for retry, and the retry can still complete it", async () => {
    const queued = await req(
      "/api/v1/extractions/text",
      { text: `Blorp drops ${randomUUID()}`, saleId: randomUUID() },
      employeeCookie,
    );
    const { processClaimedExtraction } =
      await import("../../../apps/api/src/process-extraction");
    const outage = async () => {
      throw Object.assign(
        new Error("Structure provider returned 503: overloaded"),
        { status: 503 },
      );
    };
    const first = await processClaimedExtraction(
      await claimed(queued.data.id),
      {
        structure: outage,
        catalogue: async () => [],
      } as any,
    );
    expect(first.status).toBe("pending");
    const mid = await req(
      `/api/v1/extractions/${queued.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(mid.data.status).toBe("pending");
    expect(mid.data.attempts).toBe(1);
    const second = await processClaimedExtraction(
      await claimed(queued.data.id),
      {
        structure: async (t: string) => ({
          transcript: t,
          draft: { items: [] },
          provider: "test",
          model: "m",
          usage: null,
          requiresReview: true,
        }),
        catalogue: async () => [],
      } as any,
    );
    expect(second.status).toBe("completed");
    const end = await req(
      `/api/v1/extractions/${queued.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(end.data).toMatchObject({ status: "completed", error: null });
    // A second consecutive outage is the last attempt: it fails with a plain message, not provider text.
    const other = await req(
      "/api/v1/extractions/text",
      { text: `Blorp two ${randomUUID()}`, saleId: randomUUID() },
      employeeCookie,
    );
    await processClaimedExtraction(await claimed(other.data.id), {
      structure: outage,
      catalogue: async () => [],
    } as any);
    const last = await processClaimedExtraction(await claimed(other.data.id), {
      structure: outage,
      catalogue: async () => [],
    } as any);
    expect(last.status).toBe("failed");
    const failed = await req(
      `/api/v1/extractions/${other.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(failed.data.error).not.toMatch(/503|provider/i);
  });

  it("concurrency: two simultaneous checkouts of one order post exactly once", async () => {
    const id = await order();
    const before = await stateNow();
    const results = await Promise.all([
      command(checkout(id, ++sequence)),
      command(checkout(id, ++sequence)),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBeGreaterThanOrEqual(400);
    expect(codes[1]).toBeLessThan(500);
    const after = await stateNow();
    expect(
      Object.values(after.invoices).filter((i: any) => i.orderId === id),
    ).toHaveLength(1);
    expect(Number(after.batches["dolo-b1"].quantity)).toBe(
      Number(before.batches["dolo-b1"].quantity) - 1,
    );
  });

  it("concurrency: two orders racing for the last unit of a batch never oversell", async () => {
    const batchId = `race-${randomUUID().slice(0, 8)}`;
    const opened = await command({
      type: "stock.opening",
      reason: "Contract test stock",
      batch: {
        id: batchId,
        productId: "ors",
        code: "RACE1",
        expiry: new Date(Date.now() + 300 * 86400000)
          .toISOString()
          .slice(0, 10),
        quantity: "1",
        quarantined: "0",
        pricePaise: 280,
        mrpPaise: 280,
        costPaise: 200,
        verifiedCost: true,
      },
    });
    expect(opened.status).toBe(200);
    const saves = await Promise.all([
      command({
        type: "order.save",
        orderId: randomUUID(),
        version: 0,
        counterId: "counter-1",
        lines: [{ batchId, quantity: "1", unit: "sachet", confirmed: true }],
      }),
      command({
        type: "order.save",
        orderId: randomUUID(),
        version: 0,
        counterId: "counter-1",
        lines: [{ batchId, quantity: "1", unit: "sachet", confirmed: true }],
      }),
    ]);
    const orderIds =
      (await stateNow()) &&
      Object.values((await stateNow()).orders as Record<string, any>)
        .filter((o: any) => o.lines.some((l: any) => l.batchId === batchId))
        .map((o: any) => o.id);
    saves.forEach((s) => expect(s.status).toBeLessThan(500));
    const sales = await Promise.all(
      orderIds.map((id: string) => command(checkout(id, ++sequence))),
    );
    sales.forEach((s) => expect(s.status).toBeLessThan(500));
    expect(sales.filter((s) => s.status === 200).length).toBeLessThanOrEqual(1);
    expect(await qty(batchId)).toBeGreaterThanOrEqual(0);
  });

  it("concurrent offline sync batches with the same entries post each sale once", async () => {
    const sales = [offline(), offline(), offline()];
    const before = await qty("dolo-b1");
    const entries = sales.map((command) => ({ command, lease }));
    const [a, b] = await Promise.all([
      req("/api/v1/sync", { entries }),
      req("/api/v1/sync", { entries }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    for (const r of [a, b])
      expect(r.data.results.map((x: any) => x.status)).toEqual([
        "synced",
        "synced",
        "synced",
      ]);
    expect(await qty("dolo-b1")).toBe(before - 3);
  });

  it("payment references cannot be reused, case-insensitively, and the blocked attempt leaves no invoice", async () => {
    const reference = `utr-${randomUUID()}`;
    const upi = (orderId: string, ref: string): Operation => ({
      type: "checkout",
      orderId,
      version: 1,
      deviceId,
      sequence: ++sequence,
      cashPaise: 0,
      upiPaise: 280,
      upiVerified: true,
      upiReference: ref,
      creditPaise: 0,
      discountPaise: 0,
    });
    const a = await order();
    expect((await command(upi(a, reference))).status).toBe(200);
    const b = await order();
    const stock = await qty("dolo-b1");
    const reused = await command(upi(b, reference.toUpperCase()));
    expect(reused.status).toBe(409);
    expect(reused.data.code).toBe("PAYMENT_REFERENCE_REUSED");
    expect(await qty("dolo-b1")).toBe(stock);
    // The same blocked command resent records only one review.
    const reviews = () =>
      Promise.resolve(stateNow()).then(
        (s: any) =>
          Object.values(s.reviews).filter((r: any) => r.kind === "payment")
            .length,
      );
    const n = await reviews();
    const dup = make(upi(b, ` ${reference} `));
    await req("/api/v1/commands", dup);
    await req("/api/v1/commands", dup);
    expect(await reviews()).toBe(n + 1);
    // A fresh reference works for the same order afterwards.
    expect((await command(upi(b, `utr-${randomUUID()}`))).status).toBe(200);
    // Blank references are rejected, not recorded.
    const c = await order();
    const blank = await command({
      ...upi(c, " "),
      upiReference: " ",
    } as Operation);
    expect(blank.status).toBe(400);
  });

  it("invoice numbers are unique per device sequence and across concurrent checkouts", async () => {
    const n = ++sequence;
    const a = await order(),
      b = await order();
    const results = await Promise.all([
      command(checkout(a, n)),
      command(checkout(b, n)),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.data.code).toBe("INVOICE_NUMBER_USED");
    const numbers = Object.values((await stateNow()).invoices).map(
      (i: any) => i.number,
    );
    expect(new Set(numbers).size).toBe(numbers.length);
    // Offline sync with an already used sequence is quarantined, not double-numbered.
    const dup = offline(n);
    const r = await req("/api/v1/sync", { entries: [{ command: dup, lease }] });
    expect(r.data.results[0].status).toBe("review_required");
    const after = Object.values((await stateNow()).invoices).map(
      (i: any) => i.number,
    );
    expect(new Set(after).size).toBe(after.length);
  });

  it("an order for more than is in stock cannot be sold and stock never goes negative", async () => {
    const id = randomUUID();
    const saved = await command({
      type: "order.save",
      orderId: id,
      version: 0,
      counterId: "counter-1",
      lines: [
        {
          batchId: "dolo-b1",
          quantity: "99999999",
          unit: "tablet",
          confirmed: true,
        },
      ],
    });
    const before = await qty("dolo-b1");
    if (saved.status === 200) {
      const r = await command(checkout(id, ++sequence, 1));
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    } else expect(saved.status).toBeLessThan(500);
    expect(await qty("dolo-b1")).toBe(before);
  });

  it("a stale order version cannot be checked out and stock is untouched", async () => {
    const id = await order();
    const before = await qty("dolo-b1");
    const r = await command({
      ...checkout(id, ++sequence),
      version: 7,
    } as Operation);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(await qty("dolo-b1")).toBe(before);
  });
});
