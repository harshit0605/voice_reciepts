import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  demoState,
  type Command,
  type Operation,
  type State,
} from "@counterwell/core";

/**
 * QA edge cases for the HTTP API: role gating, idempotent replays, concurrency, and the offline
 * sync / quarantine path. Opt-in like the other database tests (RUN_DB_TESTS=1) and restricted to
 * the dedicated counterwell_test database.
 */
const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)(
  "QA: API permissions, replays, concurrency and offline sync",
  () => {
    let app: Awaited<typeof import("./app")>["app"];
    let db: typeof import("@counterwell/db");
    let ownerCookie = "";
    let employeeCookie = "";
    let ownerId = "";
    let employeeId = "";
    let businessId = "";
    let otherBusinessId = "";
    let ownerDevice = "";
    let ownerLease = "";
    let employeeDevice = "";
    let employeeLease = "";
    let sequence = 700;
    const userIds: string[] = [];

    const make = (
      operation: Operation,
      at = new Date().toISOString(),
    ): Command => ({
      id: randomUUID(),
      occurredAt: at,
      operation,
    });
    async function req(
      route: string,
      body?: unknown,
      cookie = ownerCookie,
      business: string | null = businessId,
      method?: string,
    ) {
      const r = await app.request(`http://localhost:4100${route}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:8081",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(business ? { "X-Business-Id": business } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await r.text();
      let data: any = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* html receipt */
      }
      return { status: r.status, data, response: r };
    }
    const command = (operation: Operation, cookie = ownerCookie) =>
      req("/api/v1/commands", make(operation), cookie);
    async function heldOrder(
      cookie = ownerCookie,
      quantity = "1",
      unit = "tablet",
      batchId = "dolo-b1",
    ) {
      const orderId = randomUUID();
      const r = await req(
        "/api/v1/commands",
        make({
          type: "order.save",
          orderId,
          version: 0,
          lines: [{ batchId, quantity, unit, confirmed: true }],
          counterId: "counter-1",
        }),
        cookie,
      );
      expect(r.status).toBe(200);
      return orderId;
    }
    const checkout = (
      orderId: string,
      extra: Partial<Record<string, unknown>> = {},
    ): Operation =>
      ({
        type: "checkout",
        orderId,
        version: 1,
        deviceId: ownerDevice,
        sequence: ++sequence,
        cashPaise: 280,
        upiPaise: 0,
        creditPaise: 0,
        discountPaise: 0,
        ...extra,
      }) as Operation;
    const offlineCommand = (
      o: { by?: "owner" | "employee"; at?: string; sequence?: number } = {},
    ) => {
      const by = o.by ?? "owner";
      return make(
        {
          type: "offline.checkout",
          deviceId: by === "owner" ? ownerDevice : employeeDevice,
          sequence: o.sequence ?? ++sequence,
          orderId: randomUUID(),
          counterId: "counter-1",
          dispenserId: by === "owner" ? ownerId : employeeId,
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
        },
        o.at,
      );
    };
    const state = async () => (await db.readState(businessId)) as State;
    const stock = async (batch = "dolo-b1") =>
      Number((await state()).batches[batch].quantity);

    beforeAll(async () => {
      process.loadEnvFile(".env");
      process.env.DATABASE_URL =
        process.env.TEST_DATABASE_URL ??
        process.env.DATABASE_URL!.replace(
          /\/counterwell$/,
          "/counterwell_test",
        );
      if (
        !new URL(process.env.DATABASE_URL).pathname.endsWith(
          "/counterwell_test",
        )
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
      db = await import("@counterwell/db");
      ({ app } = await import("./app"));
      const { auth } = await import("./auth");
      const suffix = randomUUID().slice(0, 8);
      const password = "Integration-password-2026";
      const owner = await auth.api.signUpEmail({
        body: {
          name: "QA owner",
          email: `qa-owner-${suffix}@accounts.invalid`,
          username: `qa_owner_${suffix}`,
          password,
        },
      });
      const employee = await auth.api.signUpEmail({
        body: {
          name: "QA staff",
          email: `qa-staff-${suffix}@accounts.invalid`,
          username: `qa_staff_${suffix}`,
          password,
        },
      });
      ownerId = owner.user.id;
      employeeId = employee.user.id;
      userIds.push(ownerId, employeeId);
      const signIn = async (username: string) => {
        const r = await req(
          "/api/auth/sign-in/username",
          { username, password },
          "",
          null,
        );
        expect(r.status).toBe(200);
        return r.response.headers
          .getSetCookie()
          .map((x: string) => x.split(";")[0])
          .join("; ");
      };
      ownerCookie = await signIn(`qa_owner_${suffix}`);
      employeeCookie = await signIn(`qa_staff_${suffix}`);
      businessId = `qa-${suffix}`;
      otherBusinessId = `qa-other-${suffix}`;
      await db.createBusiness(demoState(businessId, ownerId, employeeId));
      await db.createBusiness(
        demoState(otherBusinessId, "other-owner", "other-employee"),
      );
      ownerDevice = randomUUID();
      const od = await req("/api/v1/devices/register", {
        id: ownerDevice,
        name: "Owner phone",
        counterId: "counter-1",
      });
      expect(od.status).toBe(200);
      ownerLease = od.data.lease;
      employeeDevice = randomUUID();
      const ed = await req(
        "/api/v1/devices/register",
        { id: employeeDevice, name: "Staff phone", counterId: "counter-1" },
        employeeCookie,
      );
      expect(ed.status).toBe(200);
      employeeLease = ed.data.lease;
    }, 60000);

    afterAll(async () => {
      if (!db) return;
      const { collections } = await import("@counterwell/core");
      for (const business of [businessId, otherBusinessId])
        if (business) {
          for (const name of collections)
            await db.pool.query(
              `DELETE FROM retail_${name} WHERE business_id=$1`,
              [business],
            );
          await db.pool.query("DELETE FROM businesses WHERE id=$1", [business]);
        }
      for (const id of userIds)
        await db.pool.query("DELETE FROM auth_user WHERE id=$1", [id]);
      await db.pool.end();
    });

    describe("authentication and role gating", () => {
      it("rejects a missing session (401), a missing business (400) and a business the user is not in (403)", async () => {
        expect((await req("/api/v1/state", undefined, "")).status).toBe(401);
        expect(
          (await req("/api/v1/state", undefined, ownerCookie, null)).status,
        ).toBe(400);
        expect(
          (await req("/api/v1/state", undefined, ownerCookie, otherBusinessId))
            .status,
        ).toBe(403);
        expect(
          (
            await req(
              "/api/v1/state",
              undefined,
              ownerCookie,
              "no-such-business",
            )
          ).status,
        ).toBe(403);
      });
      it("owner-only HTTP routes return 403 to an employee", async () => {
        const id = randomUUID();
        const calls = await Promise.all([
          req("/api/v1/reports?date=2026-01-01", undefined, employeeCookie),
          req("/api/v1/operations", undefined, employeeCookie),
          req(
            "/api/v1/employees",
            {
              name: "X",
              username: "newstaff1",
              password: "long-enough-password-1",
              canCollect: true,
            },
            employeeCookie,
          ),
          req(
            `/api/v1/employees/${employeeId}`,
            { canCollect: true },
            employeeCookie,
            businessId,
            "PATCH",
          ),
          req(
            `/api/v1/employees/${ownerId}/password`,
            { password: "another-long-password-1" },
            employeeCookie,
          ),
          req("/api/v1/recovery/import", { entries: [] }, employeeCookie),
          req(
            `/api/v1/recovery/${id}`,
            { accept: true, reason: "because" },
            employeeCookie,
          ),
        ]);
        expect(calls.map((c) => c.status)).toEqual([
          403, 403, 403, 403, 403, 403, 403,
        ]);
      });
      it("owner-only commands are 403 for an employee over HTTP and nothing is written", async () => {
        const before = (await state()).revision;
        const ops: Operation[] = [
          {
            type: "batch.price",
            batchId: "dolo-b1",
            pricePaise: 1,
            reason: "steal",
          },
          { type: "device.revoke", deviceId: ownerDevice },
          { type: "eod.close", date: "2026-09-23" },
          {
            type: "supplier.save",
            supplier: { id: "s-x", name: "X", gstin: "", phone: "" },
          },
          { type: "approval.decide", approvalId: "none", approve: true },
          { type: "stock.execute", approvalId: "none" },
        ];
        for (const op of ops)
          expect((await command(op, employeeCookie)).status, op.type).toBe(403);
        expect((await state()).revision).toBe(before);
      });
      it("camera and offline commands cannot be sent through /commands", async () => {
        expect(
          (await command({ type: "coverage.gap", source: "cam", detail: "x" }))
            .status,
        ).toBe(403);
        expect((await req("/api/v1/commands", offlineCommand())).status).toBe(
          400,
        );
      });
      it("an employee's state never contains costs, suppliers or other people's bills", async () => {
        const orderId = await heldOrder(ownerCookie);
        expect((await command(checkout(orderId))).status).toBe(200);
        const owner = await req("/api/v1/state");
        const staff = await req("/api/v1/state", undefined, employeeCookie);
        expect(JSON.stringify(owner.data)).toContain("costPaise");
        expect(JSON.stringify(staff.data)).not.toContain("costPaise");
        expect(Object.keys(staff.data.suppliers)).toHaveLength(0);
        expect(
          Object.values(staff.data.invoices).filter(
            (i: any) => i.collectorId === ownerId,
          ),
        ).toHaveLength(0);
        const sync = await req(
          "/api/v1/sync?since=-1",
          undefined,
          employeeCookie,
        );
        expect(JSON.stringify(sync.data)).not.toContain("costPaise");
      });
      it("an employee cannot read the receipt of another person's bill", async () => {
        const orderId = await heldOrder(ownerCookie);
        const done = await command(checkout(orderId));
        const invoiceId = done.data.result.id;
        expect(
          (await req(`/api/v1/invoices/${invoiceId}/receipt`)).status,
        ).toBe(200);
        expect(
          (
            await req(
              `/api/v1/invoices/${invoiceId}/receipt`,
              undefined,
              employeeCookie,
            )
          ).status,
        ).toBe(404);
      });
      it("an employee cannot register or heartbeat the owner's device", async () => {
        const r = await req(
          "/api/v1/devices/register",
          { id: ownerDevice, name: "stolen", counterId: "counter-1" },
          employeeCookie,
        );
        expect(r.status).toBe(403);
        const hb = await req(
          "/api/v1/devices/heartbeat",
          { deviceId: ownerDevice, pendingCount: 0 },
          employeeCookie,
        );
        expect(hb.status).toBe(403);
      });
      it("the owner cannot switch off their own access", async () => {
        const r = await req(
          `/api/v1/employees/${ownerId}`,
          { active: false },
          ownerCookie,
          businessId,
          "PATCH",
        );
        expect(r.status).toBe(400);
      });
    });

    describe("idempotency and concurrency", () => {
      it("the same checkout command sent five times at once bills exactly once", async () => {
        const orderId = await heldOrder(ownerCookie);
        const c = make(checkout(orderId));
        const stockBefore = await stock();
        const results = await Promise.all(
          Array.from({ length: 5 }, () => req("/api/v1/commands", c)),
        );
        expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
        expect(new Set(results.map((r) => r.data.result.id)).size).toBe(1);
        expect(await stock()).toBe(stockBefore - 1);
        const s = await state();
        expect(
          Object.values(s.payments).filter(
            (p) => p.invoiceId === results[0].data.result.id,
          ),
        ).toHaveLength(1);
      });
      it("different commands racing for one order produce one invoice and one 4xx", async () => {
        const orderId = await heldOrder(ownerCookie);
        const stockBefore = await stock();
        const racers = await Promise.all([
          req(
            "/api/v1/commands",
            make(checkout(orderId, { sequence: ++sequence })),
          ),
          req(
            "/api/v1/commands",
            make(checkout(orderId, { sequence: ++sequence })),
          ),
          req(
            "/api/v1/commands",
            make(checkout(orderId, { sequence: ++sequence })),
          ),
        ]);
        expect(racers.filter((r) => r.status === 200)).toHaveLength(1);
        expect(racers.filter((r) => r.status >= 500)).toHaveLength(0);
        expect(await stock()).toBe(stockBefore - 1);
      });
      it("two shoppers racing for the last strip: one wins, stock never goes negative", async () => {
        const s = await state();
        const product = {
          ...s.products.dolo,
          id: "qa-last",
          name: "QA last",
          barcode: "QA-LAST",
        };
        expect((await command({ type: "product.save", product })).status).toBe(
          200,
        );
        expect(
          (
            await command({
              type: "stock.opening",
              batch: {
                id: "qa-last-b1",
                productId: "qa-last",
                code: "LAST1",
                expiry: "2027-12-31",
                quantity: "10",
                quarantined: "0",
                pricePaise: 280,
                mrpPaise: 280,
                verifiedCost: false,
              },
              reason: "QA last unit",
            })
          ).status,
        ).toBe(200);
        const a = await heldOrder(ownerCookie, "1", "strip", "qa-last-b1");
        const b = await heldOrder(ownerCookie, "1", "strip", "qa-last-b1");
        const [ra, rb] = await Promise.all([
          req("/api/v1/commands", make(checkout(a, { cashPaise: 2800 }))),
          req("/api/v1/commands", make(checkout(b, { cashPaise: 2800 }))),
        ]);
        expect([ra.status, rb.status].sort()).toEqual([200, 400]);
        expect(await stock("qa-last-b1")).toBe(0);
      });
      it("rejects a stale online command and a command id reused with other data", async () => {
        const old = make(
          {
            type: "customer.create",
            customer: { id: randomUUID(), name: "Old", phone: "", address: "" },
          },
          new Date(Date.now() - 6 * 60_000).toISOString(),
        );
        expect((await req("/api/v1/commands", old)).status).toBe(400);
        const c = make({
          type: "customer.create",
          customer: {
            id: `cu-${randomUUID()}`,
            name: "A",
            phone: "",
            address: "",
          },
        });
        expect((await req("/api/v1/commands", c)).status).toBe(200);
        expect((await req("/api/v1/commands", c)).status).toBe(200);
        const changed = {
          ...c,
          operation: {
            type: "customer.create",
            customer: {
              id: `cu-${randomUUID()}`,
              name: "B",
              phone: "",
              address: "",
            },
          },
        };
        expect((await req("/api/v1/commands", changed)).status).toBe(409);
      });
      it("a reused UPI reference is blocked with 409 and raises a review for the owner", async () => {
        const ref = `UTR${randomUUID().slice(0, 8)}`;
        const upi = (orderId: string) =>
          checkout(orderId, {
            cashPaise: 0,
            upiPaise: 280,
            upiReference: ref,
            upiVerified: true,
          });
        expect((await command(upi(await heldOrder()))).status).toBe(200);
        const dup = make(upi(await heldOrder()));
        const r = await req("/api/v1/commands", dup);
        expect(r.status).toBe(409);
        expect(r.data.code).toBe("PAYMENT_REFERENCE_REUSED");
        const s = await state();
        expect(s.reviews[`payment-review:${dup.id}`]?.kind).toBe("payment");
        expect(
          Object.values(s.payments).filter(
            (p) => p.reference === ref.toUpperCase(),
          ),
        ).toHaveLength(1);
      });
    });

    describe("offline sync and quarantine", () => {
      it("syncs a signed cash sale once and replays are 'synced' without a second invoice", async () => {
        const c = offlineCommand();
        const before = await stock();
        const first = await req("/api/v1/sync", {
          entries: [{ command: c, lease: ownerLease }],
        });
        expect(first.data.results[0].status).toBe("synced");
        const again = await req("/api/v1/sync", {
          entries: [{ command: c, lease: ownerLease }],
        });
        expect(again.data.results[0].status).toBe("synced");
        expect(await stock()).toBe(before - 1);
      });
      it("quarantines a sale with a forged lease, keeps it quarantined on replay and posts nothing", async () => {
        const c = offlineCommand();
        const before = await stock();
        for (let i = 0; i < 3; i++) {
          const r = await req("/api/v1/sync", {
            entries: [{ command: c, lease: "forged" }],
          });
          expect(r.data.results[0].status).toBe("review_required");
        }
        const s = await state();
        expect(
          Object.values(s.reviews).filter((r) => r.referenceId === c.id),
        ).toHaveLength(1);
        expect(await stock()).toBe(before);
        // Even a valid lease on a later replay of the same id stays in review (needs the owner).
        const withLease = await req("/api/v1/sync", {
          entries: [{ command: c, lease: ownerLease }],
        });
        expect(withLease.data.results[0].status).toBe("review_required");
      });
      it("owner accepts a quarantined sale once; the phone's replay then reports 'synced', and a second accept fails", async () => {
        const c = offlineCommand();
        await req("/api/v1/sync", {
          entries: [{ command: c, lease: "forged" }],
        });
        const before = await stock();
        const ok = await req(`/api/v1/recovery/${c.id}`, {
          accept: true,
          reason: "Checked paper bill",
        });
        expect(ok.status).toBe(200);
        expect(await stock()).toBe(before - 1);
        const replay = await req("/api/v1/sync", {
          entries: [{ command: c, lease: ownerLease }],
        });
        expect(replay.data.results[0].status).toBe("synced");
        const twice = await req(`/api/v1/recovery/${c.id}`, {
          accept: true,
          reason: "Again please",
        });
        expect(twice.status).toBe(400);
        expect(await stock()).toBe(before - 1);
      });
      it("a rejected quarantined sale is reported as resolved_rejected and never posts", async () => {
        const c = offlineCommand();
        await req("/api/v1/sync", {
          entries: [{ command: c, lease: "forged" }],
        });
        const before = await stock();
        expect(
          (
            await req(`/api/v1/recovery/${c.id}`, {
              accept: false,
              reason: "Not our bill",
            })
          ).status,
        ).toBe(200);
        const replay = await req("/api/v1/sync", {
          entries: [{ command: c, lease: ownerLease }],
        });
        expect(replay.data.results[0].status).toBe("resolved_rejected");
        expect(await stock()).toBe(before);
      });
      it("quarantines a sale presented with somebody else's lease or another device's lease", async () => {
        const c = offlineCommand({ by: "owner" });
        const r = await req("/api/v1/sync", {
          entries: [{ command: c, lease: employeeLease }],
        });
        expect(r.data.results[0].status).toBe("review_required");
        const mine = offlineCommand({ by: "employee" });
        const wrong = await req(
          "/api/v1/sync",
          { entries: [{ command: mine, lease: ownerLease }] },
          employeeCookie,
        );
        expect(wrong.data.results[0].status).toBe("review_required");
        expect(wrong.data.results[0].reason).toMatch(/identity/i);
      });
      it("quarantines a sale dated before the lease was issued or more than 2 minutes in the future", async () => {
        const past = offlineCommand({
          at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        });
        const future = offlineCommand({
          at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        const r = await req("/api/v1/sync", {
          entries: [
            { command: past, lease: ownerLease },
            { command: future, lease: ownerLease },
          ],
        });
        expect(r.data.results.map((x: any) => x.status)).toEqual([
          "review_required",
          "review_required",
        ]);
      });
      it("a duplicate invoice number sent by a different command is quarantined, not posted twice", async () => {
        const n = ++sequence;
        const a = offlineCommand({ sequence: n });
        const b = offlineCommand({ sequence: n });
        const r = await req("/api/v1/sync", {
          entries: [
            { command: a, lease: ownerLease },
            { command: b, lease: ownerLease },
          ],
        });
        expect(r.data.results.map((x: any) => x.status)).toEqual([
          "synced",
          "review_required",
        ]);
      });
      it("accepts sequence gaps and out-of-order batches", async () => {
        const hi = offlineCommand({ sequence: sequence + 50 });
        const lo = offlineCommand({ sequence: sequence + 20 });
        sequence += 60;
        const r = await req("/api/v1/sync", {
          entries: [
            { command: hi, lease: ownerLease },
            { command: lo, lease: ownerLease },
          ],
        });
        expect(r.data.results.map((x: any) => x.status)).toEqual([
          "synced",
          "synced",
        ]);
      });
      it("refuses non-cash or non-offline commands in the queue per entry without blocking the rest", async () => {
        const bad = make({
          type: "customer.create",
          customer: { id: randomUUID(), name: "Q", phone: "", address: "" },
        });
        const good = offlineCommand();
        const r = await req("/api/v1/sync", {
          entries: [
            { command: bad, lease: ownerLease },
            { command: good, lease: ownerLease },
          ],
        });
        expect(r.data.results.map((x: any) => x.status)).toEqual([
          "invalid",
          "synced",
        ]);
      });
      it("one bad entry (command id reused with other data) must not block the valid sales behind it", async () => {
        const a = offlineCommand();
        expect(
          (
            await req("/api/v1/sync", {
              entries: [{ command: a, lease: ownerLease }],
            })
          ).data.results[0].status,
        ).toBe("synced");
        const tampered = {
          ...a,
          operation: { ...a.operation, cashPaise: 1 },
        } as Command;
        const behind = offlineCommand();
        const before = await stock();
        const r = await req("/api/v1/sync", {
          entries: [
            { command: tampered, lease: ownerLease },
            { command: behind, lease: ownerLease },
          ],
        });
        // Expected: 200 with per-entry results, and the valid sale behind the bad one is posted.
        expect(r.status).toBe(200);
        expect(r.data.results.at(-1).status).toBe("synced");
        expect(await stock()).toBe(before - 1);
      });
      it("one schema-invalid entry must not reject the whole batch of otherwise valid sales", async () => {
        const bad = offlineCommand();
        (bad.operation as any).cashPaise = -5;
        const good = offlineCommand();
        const before = await stock();
        const r = await req("/api/v1/sync", {
          entries: [
            { command: good, lease: ownerLease },
            { command: bad, lease: ownerLease },
          ],
        });
        expect(r.status).toBe(200);
        expect(r.data.results[0].status).toBe("synced");
        expect(await stock()).toBe(before - 1);
      });
      it("a disabled employee's queued sale is quarantined for the owner instead of posting", async () => {
        const mine = offlineCommand({ by: "employee" });
        const off = await req(
          `/api/v1/employees/${employeeId}`,
          { active: false },
          ownerCookie,
          businessId,
          "PATCH",
        );
        expect(off.status).toBe(200);
        try {
          // Their session is gone, so the phone must sign in again; the account is still disabled.
          const stale = await req(
            "/api/v1/sync",
            { entries: [{ command: mine, lease: employeeLease }] },
            employeeCookie,
          );
          expect([401, 403]).toContain(stale.status);
          expect(
            (await state()).invoices[`${mine.id}:invoice`],
          ).toBeUndefined();
        } finally {
          await req(
            `/api/v1/employees/${employeeId}`,
            { active: true },
            ownerCookie,
            businessId,
            "PATCH",
          );
        }
      });
    });

    describe("API hardening fixes", () => {
      const raw = (body: string, type: string) =>
        app.request("http://localhost:4100/api/v1/commands", {
          method: "POST",
          headers: {
            "Content-Type": type,
            Origin: "http://localhost:8081",
            Cookie: ownerCookie,
            "X-Business-Id": businessId,
          },
          body,
        });
      it("malformed, empty and form-encoded bodies are 400, not 500", async () => {
        for (const [body, type] of [
          ["{not json", "application/json"],
          ["", "application/json"],
          ["a=1&b=2", "application/x-www-form-urlencoded"],
        ] as const) {
          const r = await raw(body, type);
          expect(r.status).toBe(400);
          expect((await r.json()).error).toBe("Request body must be JSON");
        }
      });
      it("a duplicate employee username is 409 with a clear message", async () => {
        const username = `dup_${randomUUID().slice(0, 8)}`;
        const body = {
          name: "Dup",
          username,
          password: "Integration-password-2026",
          canCollect: false,
        };
        const first = await req("/api/v1/employees", body);
        expect(first.status).toBe(201);
        userIds.push(first.data.id);
        const second = await req("/api/v1/employees", body);
        expect(second.status).toBe(409);
        expect(second.data.error).toBe(
          "That username is taken. Choose another.",
        );
      });
      it("staff sync lists no ids from collections they cannot see", async () => {
        const owner = await req(
          "/api/v1/commands",
          make({
            type: "eod.close",
            date: new Date(Date.now() + 330 * 60_000)
              .toISOString()
              .slice(0, 10),
          }),
        );
        expect(owner.status).toBe(200);
        const ownerSync = await req("/api/v1/sync?since=-1");
        expect(Object.keys(ownerSync.data.changes.eods).length).toBeGreaterThan(
          0,
        );
        // An earlier test revoked the staff session, so sign in again.
        const { rows: users } = await db.pool.query(
          "SELECT username FROM auth_user WHERE id=$1",
          [employeeId],
        );
        const login = await req(
          "/api/auth/sign-in/username",
          {
            username: users[0].username,
            password: "Integration-password-2026",
          },
          "",
          null,
        );
        expect(login.status).toBe(200);
        const staffCookie = login.response.headers
          .getSetCookie()
          .map((x: string) => x.split(";")[0])
          .join("; ");
        const sync = await req("/api/v1/sync?since=-1", undefined, staffCookie);
        expect(sync.status).toBe(200);
        for (const name of [
          "eods",
          "purchases",
          "suppliers",
          "audit",
          "commands",
          "stock",
        ])
          expect(Object.keys(sync.data.changes[name])).toHaveLength(0);
        for (const rows of Object.values(sync.data.changes) as any[])
          for (const [id, row] of Object.entries(rows))
            if (row === null)
              expect(["eods", "purchases", "audit", "commands"]).not.toContain(
                id,
              );
      });
    });

    describe("reports", () => {
      it("the owner's report for today adds up cash, UPI and invoice count from the ledger", async () => {
        const s = await state();
        const today = new Date(Date.now() + 330 * 60_000)
          .toISOString()
          .slice(0, 10);
        const r = await req(`/api/v1/reports?date=${today}`);
        expect(r.status).toBe(200);
        const invoices = Object.values(s.invoices).filter(
          (i) =>
            new Date(Date.parse(i.occurredAt) + 330 * 60_000)
              .toISOString()
              .slice(0, 10) === today,
        );
        expect(r.data.totals.invoiceCount).toBe(invoices.length);
        expect(r.data.totals.netSalesPaise).toBe(
          invoices.reduce((n, i) => n + i.totalPaise, 0),
        );
      });
    });
  },
);
