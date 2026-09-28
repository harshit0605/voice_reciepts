import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { demoState, type State, type Command, type Operation } from "../src";
// Explicit opt-in. Never run migrations against the application database.
const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)("PostgreSQL and authenticated API", () => {
  let app: any,
    auth: any,
    db: any,
    ownerCookie = "",
    employeeCookie = "",
    ownerId = "",
    employeeId = "",
    businessId = "",
    otherBusinessId = "",
    deviceId = "",
    lease = "";
  let sequence = 0;
  let uploadDir = "";
  const ids: string[] = [];
  const make = (
    operation: Operation,
    at = new Date().toISOString(),
  ): Command => ({ id: randomUUID(), occurredAt: at, operation });
  async function req(
    route: string,
    body?: unknown,
    cookie = ownerCookie,
    business = businessId,
    method?: string,
  ) {
    const r = await app.request(`http://localhost:4100${route}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8081",
        Cookie: cookie,
        "X-Business-Id": business,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json(), response: r };
  }
  async function command(operation: Operation, cookie = ownerCookie) {
    return req("/api/v1/commands", make(operation), cookie);
  }
  async function order(id = randomUUID()) {
    const r = await command({
      type: "order.save",
      orderId: id,
      version: 0,
      lines: [
        { batchId: "dolo-b1", quantity: "1", unit: "tablet", confirmed: true },
      ],
      counterId: "counter-1",
    });
    expect(r.status).toBe(200);
    return id;
  }
  beforeAll(async () => {
    process.loadEnvFile(".env");
    uploadDir = await mkdtemp(path.join(tmpdir(), "counterwell-upload-test-"));
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
    const password = "Integration-password-2026";
    const owner = await auth.api.signUpEmail({
      body: {
        name: "Test owner",
        email: `owner-${suffix}@accounts.invalid`,
        username: `owner_${suffix}`,
        password,
      },
    });
    ownerId = owner.user.id;
    ids.push(ownerId);
    const employee = await auth.api.signUpEmail({
      body: {
        name: "Test employee",
        email: `employee-${suffix}@accounts.invalid`,
        username: `staff_${suffix}`,
        password,
      },
    });
    employeeId = employee.user.id;
    ids.push(employeeId);
    const signIn = async (username: string) => {
      const result = await req(
        "/api/auth/sign-in/username",
        { username, password },
        "",
        "",
      );
      expect(result.status).toBe(200);
      return result.response.headers
        .getSetCookie()
        .map((x: string) => x.split(";")[0])
        .join("; ");
    };
    ownerCookie = await signIn(`owner_${suffix}`);
    employeeCookie = await signIn(`staff_${suffix}`);
    businessId = `test-${suffix}`;
    otherBusinessId = `other-${suffix}`;
    await db.createBusiness(demoState(businessId, ownerId, employeeId));
    await db.createBusiness(
      demoState(otherBusinessId, "other-owner", "other-employee"),
    );
    deviceId = randomUUID();
    const d = await req("/api/v1/devices/register", {
      id: deviceId,
      name: "Test device",
      counterId: "counter-1",
    });
    expect(d.status).toBe(200);
    lease = d.data.lease;
  }, 30000);
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
  async function uploadInvoice(
    content: string,
    cookie = ownerCookie,
    business = businessId,
  ) {
    const form = new FormData();
    form.append("kind", "invoice");
    form.append(
      "file",
      new Blob([content], { type: "application/pdf" }),
      "synthetic.pdf",
    );
    const response = await app.request(
      "http://localhost:4100/api/v1/extractions",
      {
        method: "POST",
        headers: { Cookie: cookie, "X-Business-Id": business },
        body: form,
      },
    );
    return { status: response.status, data: await response.json() };
  }
  it("deduplicates concurrent identical document uploads and exposes resumable owner jobs", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => uploadInvoice("%PDF-synthetic-dedup")),
    );
    expect(new Set(responses.map((r) => r.data.id)).size).toBe(1);
    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    const list = await req("/api/v1/extractions");
    expect(list.data.jobs.some((j: any) => j.id === responses[0].data.id)).toBe(
      true,
    );
    expect(
      (await req("/api/v1/extractions", undefined, employeeCookie)).status,
    ).toBe(403);
    expect(
      (await uploadInvoice("employee attempt", employeeCookie)).status,
    ).toBe(403);
    expect(
      (
        await req(
          `/api/v1/extractions/${responses[0].data.id}`,
          undefined,
          ownerCookie,
          otherBusinessId,
        )
      ).status,
    ).toBe(403);
  });
  it("keeps document reuse tenant-scoped and enforces monthly quota before new jobs", async () => {
    const { enqueueExtraction } =
      await import("../../../apps/api/src/extraction-jobs");
    const first = await uploadInvoice("%PDF-synthetic-tenant");
    const second = await enqueueExtraction(
      {
        id: ownerId,
        businessId: otherBusinessId,
        role: "owner",
        canCollect: true,
      },
      "invoice",
      Buffer.from("%PDF-synthetic-tenant"),
      "application/pdf",
      "synthetic.pdf",
    );
    expect(second.id).not.toBe(first.data.id);
    const old = process.env.INVOICE_MONTHLY_LIMIT;
    process.env.INVOICE_MONTHLY_LIMIT = "0";
    try {
      expect((await uploadInvoice("%PDF-new-over-limit")).status).toBe(429);
      expect((await uploadInvoice("%PDF-synthetic-tenant")).data.id).toBe(
        first.data.id,
      );
    } finally {
      if (old === undefined) delete process.env.INVOICE_MONTHLY_LIMIT;
      else process.env.INVOICE_MONTHLY_LIMIT = old;
    }
  });
  it("rejects foreign or incomplete purchase source documents without changing inventory", async () => {
    const { buildPurchase, catalogueSignature, blankReceivingLine } =
      await import("../src");
    const state = await db.readState(businessId);
    const draft = {
      id: randomUUID(),
      supplierId: "supplier-1",
      supplierName: "",
      supplierGstin: "",
      number: randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      total: "20",
      warnings: [],
      lines: [
        {
          ...blankReceivingLine(randomUUID(), randomUUID()),
          productId: "dolo",
          code: "INTEGRATION",
          expiry: "2030-12-31",
          quantity: "1",
          bonus: "0",
          unit: "strip",
          priceUnit: "strip",
          price: "28",
          mrp: "35",
          total: "20",
          confirmed: true,
          catalogueSignature: catalogueSignature(state.products.dolo),
        },
      ],
    };
    const op = buildPurchase(draft, state);
    const pending = await uploadInvoice("%PDF-pending");
    expect((await command({ ...op, documentId: pending.data.id })).status).toBe(
      400,
    );
    expect(
      (await command({ ...op, documentId: "not-this-business" })).status,
    ).toBe(400);
    const posted = await command(op);
    expect(posted.status).toBe(200);
    expect(
      (await command({ ...op, invoiceNumber: "different-number" })).status,
    ).toBe(409);
  });
  it("allows one explicit owner retry of a failed invoice and blocks repeated enqueueing", async () => {
    const uploaded = await uploadInvoice("%PDF-retry-only-fixture");
    await db.pool.query(
      "UPDATE jobs SET status='failed',attempts=1,error='temporary fixture failure' WHERE id=$1",
      [uploaded.data.id],
    );
    expect(
      (
        await req(
          `/api/v1/extractions/${uploaded.data.id}/retry`,
          {},
          employeeCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await req(`/api/v1/extractions/${uploaded.data.id}/retry`, {})).status,
    ).toBe(200);
    expect(
      (await req(`/api/v1/extractions/${uploaded.data.id}/retry`, {})).status,
    ).toBe(409);
    await db.pool.query(
      "UPDATE jobs SET status='failed',attempts=3 WHERE id=$1",
      [uploaded.data.id],
    );
    expect(
      (await req(`/api/v1/extractions/${uploaded.data.id}/retry`, {})).status,
    ).toBe(409);
  });
  it("charges crashed-worker recovery against the attempt budget instead of retrying indefinitely", async () => {
    const a = await uploadInvoice("%PDF-interrupted-one"),
      b = await uploadInvoice("%PDF-interrupted-two");
    await db.pool.query(
      "UPDATE jobs SET status='running',attempts=1,locked_at=now()-interval '11 minutes' WHERE id=$1",
      [a.data.id],
    );
    await db.pool.query(
      "UPDATE jobs SET status='running',attempts=2,locked_at=now()-interval '11 minutes' WHERE id=$1",
      [b.data.id],
    );
    const { recoverAbandonedExtractions } =
      await import("../../../apps/api/src/extraction-jobs");
    await recoverAbandonedExtractions();
    expect((await req(`/api/v1/extractions/${a.data.id}`)).data.status).toBe(
      "pending",
    );
    expect((await req(`/api/v1/extractions/${b.data.id}`)).data.status).toBe(
      "failed",
    );
  });
  async function voiceUpload(
    content: string,
    saleId = randomUUID(),
    cookie = employeeCookie,
    seconds = "5",
  ) {
    const form = new FormData();
    form.append("kind", "voice");
    form.append("saleId", saleId);
    form.append("recordedSeconds", seconds);
    form.append("file", new Blob([content], { type: "audio/mp4" }), "sale.m4a");
    const response = await app.request(
      "http://localhost:4100/api/v1/extractions",
      {
        method: "POST",
        headers: { Cookie: cookie, "X-Business-Id": businessId },
        body: form,
      },
    );
    return { status: response.status, data: await response.json() };
  }
  async function claimed(id: string) {
    return (
      await db.pool.query(
        "UPDATE jobs SET status='running',attempts=attempts+1,locked_at=now() WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
  }
  it("scopes voice deduplication to employee and sale, and prevents employee access to another draft", async () => {
    const saleId = randomUUID();
    const a = await voiceUpload("same speech", saleId);
    const retry = await voiceUpload("same speech", saleId);
    expect(retry.data.id).toBe(a.data.id);
    const newSale = await voiceUpload("same speech", randomUUID());
    expect(newSale.data.id).not.toBe(a.data.id);
    const owner = await voiceUpload("same speech", saleId, ownerCookie);
    expect(owner.data.id).not.toBe(a.data.id);
    expect(
      (
        await req(
          `/api/v1/extractions/${owner.data.id}`,
          undefined,
          employeeCookie,
        )
      ).status,
    ).toBe(404);
    const list = await req("/api/v1/voice-jobs", undefined, employeeCookie);
    expect(list.data.jobs.some((j: any) => j.id === a.data.id)).toBe(true);
    expect(list.data.jobs.some((j: any) => j.id === owner.data.id)).toBe(false);
  });
  it("enforces speech reservations while allowing typed input and upload retry cache hits", async () => {
    const saleId = randomUUID(),
      a = await voiceUpload("allowance sample", saleId);
    const old = process.env.VOICE_MONTHLY_RESERVED_SECONDS;
    process.env.VOICE_MONTHLY_RESERVED_SECONDS = "0";
    try {
      expect((await voiceUpload("new voice")).status).toBe(429);
      expect((await voiceUpload("allowance sample", saleId)).data.id).toBe(
        a.data.id,
      );
      expect(
        (
          await req(
            "/api/v1/extractions/text",
            { text: "Dolo 650 mg 2 tablets", saleId: randomUUID() },
            employeeCookie,
          )
        ).status,
      ).toBe(202);
    } finally {
      if (old === undefined) delete process.env.VOICE_MONTHLY_RESERVED_SECONDS;
      else process.env.VOICE_MONTHLY_RESERVED_SECONDS = old;
    }
    expect(
      (await voiceUpload("too long", randomUUID(), employeeCookie, "31"))
        .status,
    ).toBe(400);
  });
  it("processes exact typed entries with no speech or structure provider call", async () => {
    const upload = await req(
      "/api/v1/extractions/text",
      { text: "Dolo 650 mg six goli", saleId: randomUUID() },
      employeeCookie,
    );
    const { processClaimedExtraction } =
      await import("../../../apps/api/src/process-extraction");
    const noProvider = async () => {
      throw new Error("A paid provider must not be called");
    };
    const result = await processClaimedExtraction(
      await claimed(upload.data.id),
      {
        transcribe: noProvider,
        structure: noProvider,
        invoice: noProvider,
        catalogue: async () =>
          Object.values((await db.readState(businessId)).products),
      } as any,
    );
    expect(result.status).toBe("completed");
    const job = await req(
      `/api/v1/extractions/${upload.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(job.data.output.provider).toBe("local");
    expect(job.data.output.draft.items[0].quantity).toBe("6");
  });
  it("checkpoints speech before structure retries and removes the audio after transcription", async () => {
    const upload = await voiceUpload("checkpoint fixture");
    const first = await claimed(upload.data.id);
    const { processClaimedExtraction } =
      await import("../../../apps/api/src/process-extraction");
    let speechCalls = 0,
      structureCalls = 0;
    const deps = {
      transcribe: async () => {
        speechCalls++;
        return "six Dolo tablets please";
      },
      structure: async () => {
        structureCalls++;
        if (structureCalls === 1)
          throw Object.assign(new Error("temporary structure failure"), {
            status: 503,
          });
        return {
          transcript: "six Dolo tablets please",
          draft: {
            items: [
              {
                name: "Dolo",
                strength: null,
                form: "tablet",
                quantity: "6",
                unit: "tablet",
                uncertain: true,
              },
            ],
            warnings: [],
          },
          requiresReview: true,
          usage: null,
        };
      },
      invoice: async () => {
        throw new Error("wrong provider");
      },
      catalogue: async () => [],
    };
    expect((await processClaimedExtraction(first, deps as any)).status).toBe(
      "pending",
    );
    await expect(access(first.input.filename)).rejects.toThrow();
    const pending = await req(
      `/api/v1/extractions/${upload.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(pending.data.transcript).toBe("six Dolo tablets please");
    expect(
      (
        await processClaimedExtraction(
          await claimed(upload.data.id),
          deps as any,
        )
      ).status,
    ).toBe("completed");
    expect(speechCalls).toBe(1);
    expect(structureCalls).toBe(2);
    const stored = (
      await db.pool.query("SELECT input FROM jobs WHERE id=$1", [
        upload.data.id,
      ])
    ).rows[0];
    expect(stored.input.speechCalls).toBe(1);
  });
  it("retains transcript for manual correction after a terminal structure failure", async () => {
    const upload = await voiceUpload("terminal fixture");
    const { processClaimedExtraction } =
      await import("../../../apps/api/src/process-extraction");
    await processClaimedExtraction(await claimed(upload.data.id), {
      transcribe: async () => "Dolo unknown amount",
      structure: async () => {
        throw new Error("Invalid structured output");
      },
      invoice: async () => {},
      catalogue: async () => [],
    } as any);
    const job = await req(
      `/api/v1/extractions/${upload.data.id}`,
      undefined,
      employeeCookie,
    );
    expect(job.data.status).toBe("failed");
    expect(job.data.transcript).toBe("Dolo unknown amount");
  });
  it("blocks public registration and unauthenticated reads", async () => {
    expect(
      (
        await req(
          "/api/auth/sign-up/email",
          { name: "x", email: "x@example.com", password: "LongPassword123!" },
          "",
        )
      ).status,
    ).toBe(403);
    expect((await req("/api/v1/state", undefined, "")).status).toBe(401);
  });
  it("replaces a temporary password and keeps the phone signed in with the new session", async () => {
    const username = `temp_${randomUUID().slice(0, 8)}`,
      temporary = "Temporary-password-2026",
      replacement = "Replacement-password-2026";
    const created = await req("/api/v1/employees", {
      name: "New cashier",
      username,
      password: temporary,
      canCollect: true,
    });
    expect(created.status).toBe(201);
    ids.push(created.data.id);
    const signedIn = await req(
      "/api/auth/sign-in/username",
      { username, password: temporary },
      "",
      "",
    );
    const cookie = (r: Response) =>
      r.headers
        .getSetCookie()
        .map((x: string) => x.split(";")[0])
        .join("; ");
    const temporaryCookie = cookie(signedIn.response);
    expect(
      (await req("/api/v1/state", undefined, temporaryCookie)).data.code,
    ).toBe("PASSWORD_CHANGE_REQUIRED");
    const wrong = await req(
      "/api/auth/change-password",
      { currentPassword: "Not-the-password-1", newPassword: replacement },
      temporaryCookie,
      "",
    );
    expect(wrong.status).toBe(400);
    expect(
      (await req("/api/v1/state", undefined, temporaryCookie)).data.code,
    ).toBe("PASSWORD_CHANGE_REQUIRED");
    // The client does not ask for other sessions to be revoked; the server does it anyway.
    const changed = await req(
      "/api/auth/change-password",
      { currentPassword: temporary, newPassword: replacement },
      temporaryCookie,
      "",
    );
    expect(changed.status).toBe(200);
    const replacementCookie = cookie(changed.response);
    expect(replacementCookie).not.toBe("");
    expect((await req("/api/v1/me", undefined, temporaryCookie)).status).toBe(
      401,
    );
    const state = await req("/api/v1/state", undefined, replacementCookie);
    expect(state.status).toBe(200);
    expect(state.data.members[created.data.id].mustChangePassword).toBe(false);
  });
  it("enforces cross-business isolation and masks employee costs", async () => {
    expect(
      (await req("/api/v1/state", undefined, ownerCookie, otherBusinessId))
        .status,
    ).toBe(403);
    const result = await req("/api/v1/state", undefined, employeeCookie);
    expect(result.status).toBe(200);
    expect(result.data.batches["dolo-b1"].costPaise).toBeUndefined();
    expect(
      (await req("/api/v1/reports", undefined, employeeCookie)).status,
    ).toBe(403);
  });
  it("prevents employee privilege escalation in commands", async () => {
    const r = await command(
      { type: "drawer.close", drawerId: "drawer-demo", countedPaise: 0 },
      employeeCookie,
    );
    expect(r.status).toBe(403);
  });
  it("handles five concurrent device checkouts without lost stock", async () => {
    const before = await db.readState(businessId);
    const orders = await Promise.all(Array.from({ length: 5 }, () => order()));
    const devices = await Promise.all(
      Array.from({ length: 5 }, () =>
        req("/api/v1/devices/register", {
          id: randomUUID(),
          name: "Concurrent device",
          counterId: "counter-1",
        }),
      ),
    );
    const results = await Promise.all(
      orders.map((id, i) =>
        command({
          type: "checkout",
          orderId: id,
          version: 1,
          deviceId: devices[i].data.device.id,
          sequence: 1,
          cashPaise: 280,
          upiPaise: 0,
          creditPaise: 0,
          discountPaise: 0,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const after = await db.readState(businessId);
    expect(Number(after.batches["dolo-b1"].quantity)).toBe(
      Number(before.batches["dolo-b1"].quantity) - 5,
    );
  });
  it("serialises competing collectors and deduplicates retries", async () => {
    const id = await order();
    const a = make({
      type: "checkout",
      orderId: id,
      version: 1,
      deviceId,
      sequence: ++sequence,
      cashPaise: 280,
      upiPaise: 0,
      creditPaise: 0,
      discountPaise: 0,
    });
    const r = await Promise.all([
      req("/api/v1/commands", a),
      req("/api/v1/commands", a),
    ]);
    expect(r.map((x) => x.status)).toEqual([200, 200]);
    expect(r[0].data.result.id).toBe(r[1].data.result.id);
    const duplicate = await command({
      ...a.operation,
      sequence: ++sequence,
    } as Operation);
    expect(duplicate.status).toBe(409);
  });
  it("runs credit, return and refund end to end as an employee, with the owner deciding", async () => {
    const employeeDevice = randomUUID();
    const registered = await req(
      "/api/v1/devices/register",
      { id: employeeDevice, name: "Cashier phone", counterId: "counter-1" },
      employeeCookie,
    );
    expect(registered.status).toBe(200);
    const asEmployee = (operation: Operation) =>
      req("/api/v1/commands", make(operation), employeeCookie);
    const orderId = randomUUID();
    expect(
      (
        await asEmployee({
          type: "order.save",
          orderId,
          version: 0,
          lines: [
            {
              batchId: "dolo-b1",
              quantity: "1",
              unit: "tablet",
              confirmed: true,
            },
          ],
          customerId: "customer-1",
          counterId: "counter-1",
        })
      ).status,
    ).toBe(200);
    const sale = {
      type: "checkout",
      orderId,
      version: 1,
      deviceId: employeeDevice,
      sequence: 1,
      cashPaise: 100,
      upiPaise: 0,
      creditPaise: 180,
      creditApprovalId: "credit-approval",
      discountPaise: 0,
    } as Operation;
    expect((await asEmployee(sale)).status).toBe(403);
    expect(
      (
        await asEmployee({
          type: "approval.request",
          approvalId: "credit-approval",
          kind: "credit",
          payload: {
            orderId,
            orderVersion: 1,
            customerId: "customer-1",
            amountPaise: 180,
          },
          reason: "Regular customer",
        })
      ).status,
    ).toBe(200);
    // The employee cannot approve their own request.
    expect(
      (
        await asEmployee({
          type: "approval.decide",
          approvalId: "credit-approval",
          approve: true,
        })
      ).status,
    ).toBe(403);
    await command({
      type: "approval.decide",
      approvalId: "credit-approval",
      approve: true,
    });
    const billed = await asEmployee(sale);
    expect(billed.status).toBe(200);
    const invoiceId = billed.data.result.id;
    const returnRequest = (approvalId: string) =>
      asEmployee({
        type: "approval.request",
        approvalId,
        kind: "refund",
        payload: { invoiceId, lines: [{ index: 0, quantity: "1" }] },
        reason: "Doctor changed the medicine",
      });
    expect((await returnRequest("return-approval")).status).toBe(200);
    expect((await returnRequest("return-again")).status).toBe(409);
    await command({
      type: "approval.decide",
      approvalId: "return-approval",
      approve: true,
    });
    const refund = await asEmployee({
      type: "refund.execute",
      approvalId: "return-approval",
      cashPaise: 100,
      upiPaise: 0,
    });
    expect(refund.status).toBe(200);
    expect(refund.data.result).toMatchObject({
      totalPaise: 280,
      creditReductionPaise: 180,
      cashRefundPaise: 100,
      executedBy: employeeId,
    });
    const state = (await req("/api/v1/state")).data as State;
    const owed = Object.values(state.ledger)
      .filter((l) => l.invoiceId === invoiceId)
      .reduce((n, l) => n + l.amountPaise, 0);
    expect(owed).toBe(0);
    expect(state.batches["dolo-b1"].quarantined).not.toBe("0");
  });
  it("imports a full catalogue chunk atomically, owner-only, with a small stored receipt", async () => {
    const products = Array.from({ length: 250 }, (_, i) => ({
      id: `imp-${randomUUID()}`,
      name: `Imported medicine ${i}`,
      generic: "Paracetamol",
      strength: `${i} mg`,
      form: "tablet",
      hsn: "3004",
      aliases: [],
      barcode: String(8900000000000 + i),
      units: { tablet: "1", strip: "10" },
      baseUnit: "tablet",
      taxBps: 500,
      reorderAt: "0",
      schedule: "OTC" as const,
      active: true,
    }));
    const op: Operation = {
      type: "catalogue.import",
      importId: "api-import",
      products,
    };
    expect((await command(op, employeeCookie)).status).toBe(403);
    const c = make(op);
    const started = performance.now();
    const first = await req("/api/v1/commands", c);
    const elapsed = performance.now() - started;
    expect(first.status).toBe(200);
    expect(first.data.result).toEqual({ importId: "api-import", created: 250 });
    const retry = await req("/api/v1/commands", c);
    expect(retry.data.result).toEqual(first.data.result);
    const s = await db.readState(businessId);
    expect(products.every((p) => s!.products[p.id]?.name === p.name)).toBe(
      true,
    );
    expect(s!.commands[c.id].fingerprint.length).toBeLessThan(60);
    expect(elapsed).toBeLessThan(15000);
  });
  it("reports an issued invoice number distinctly so the phone does not hand it back", async () => {
    const checkout = (orderId: string, n: number): Operation => ({
      type: "checkout",
      orderId,
      version: 1,
      deviceId,
      sequence: n,
      cashPaise: 280,
      upiPaise: 0,
      creditPaise: 0,
      discountPaise: 0,
    });
    const issued = ++sequence;
    expect((await command(checkout(await order(), issued))).status).toBe(200);
    const reused = await command(checkout(await order(), issued));
    expect(reused.status).toBe(409);
    expect(reused.data.code).toBe("INVOICE_NUMBER_USED");
  });
  it("accepts signed cash sync and deduplicates the same batch", async () => {
    const c = make({
      type: "offline.checkout",
      deviceId,
      sequence: ++sequence,
      orderId: randomUUID(),
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
    const a = await req("/api/v1/sync", {
      entries: [
        { command: c, lease },
        { command: c, lease },
      ],
    });
    expect(a.status).toBe(200);
    expect(a.data.results.map((r: any) => r.status)).toEqual([
      "synced",
      "synced",
    ]);
  });
  it("preserves malformed lease submissions in owner recovery without posting", async () => {
    const c = make({
      type: "offline.checkout",
      deviceId,
      sequence: ++sequence,
      orderId: randomUUID(),
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
    const r = await req("/api/v1/sync", {
      entries: [{ command: c, lease: "forged" }],
    });
    expect(r.data.results[0].status).toBe("review_required");
    const state = await db.readState(businessId);
    expect(state.invoices[`${c.id}:invoice`]).toBeUndefined();
    expect(state.quarantine[c.id]).toBeDefined();
    const recovered = await req(`/api/v1/recovery/${c.id}`, {
      accept: true,
      reason: "Verified against paper receipt and stock",
    });
    expect(recovered.status).toBe(200);
    expect(
      (await db.readState(businessId)).invoices[`${c.id}:invoice`],
    ).toBeDefined();
  });
  it("does not allow employee access to owner document jobs", async () => {
    expect(
      (await req("/api/v1/documents/nonexistent", undefined, employeeCookie))
        .status,
    ).toBe(403);
  });
  it("rejects unsigned gateway camera events", async () => {
    const r = await req("/api/v1/gateway/observations", {
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      operation: { type: "coverage.gap", source: "camera", detail: "test" },
    });
    expect(r.status).toBe(401);
  });
  it("syncs only changed records and redacts employee deltas", async () => {
    const before = await db.readState(businessId);
    const ownerOrder = await order();
    const owner = await req(`/api/v1/sync?since=${before.revision}`);
    expect(owner.data.revision).toBeGreaterThan(before.revision);
    expect(Object.keys(owner.data.changes.orders)).toHaveLength(1);
    expect(Object.keys(owner.data.changes.products)).toHaveLength(0);
    const employee = await req(
      "/api/v1/sync?since=-1",
      undefined,
      employeeCookie,
    );
    expect(employee.data.changes.batches["dolo-b1"].costPaise).toBeUndefined();
    // The owner's orders are hidden; only orders the employee is part of come through.
    expect(employee.data.changes.orders[ownerOrder]).toBeNull();
    expect(
      Object.values(employee.data.changes.orders).every(
        (v: any) =>
          v === null ||
          [v.collectorId, v.dispenserId, v.offeredTo].includes(employeeId),
      ),
    ).toBe(true);
    const unchanged = await req(`/api/v1/sync?since=${owner.data.revision}`);
    expect(unchanged.data.unchanged).toBe(true);
  });
  it("acknowledges owner-rejected offline submissions without posting them", async () => {
    const c = make({
      type: "offline.checkout",
      deviceId,
      sequence: ++sequence,
      orderId: randomUUID(),
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
    await req("/api/v1/sync", { entries: [{ command: c, lease: "invalid" }] });
    const decision = await req(`/api/v1/recovery/${c.id}`, {
      accept: false,
      reason: "Verified as an accidental duplicate of a paper receipt",
    });
    expect(decision.status).toBe(200);
    const response = await req("/api/v1/sync", {
      entries: [{ command: c, lease: "invalid" }],
    });
    expect(response.data.results[0].status).toBe("resolved_rejected");
    expect(
      (await db.readState(businessId)).invoices[`${c.id}:invoice`],
    ).toBeUndefined();
  });
  it("recovers a revoked device from a signed gateway backup", async () => {
    const registration = await req("/api/v1/devices/register", {
      id: randomUUID(),
      name: "Lost phone",
      counterId: "counter-1",
    });
    const lost = registration.data.device;
    const c = make({
      type: "offline.checkout",
      deviceId: lost.id,
      sequence: 1,
      orderId: randomUUID(),
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
    await command({ type: "device.revoke", deviceId: lost.id });
    const imported = await req("/api/v1/recovery/import", {
      entries: [{ command: c, lease: registration.data.lease }],
    });
    expect(imported.status).toBe(200);
    expect(imported.data.results[0].status).toBe("review_required");
    expect(
      (await db.readState(businessId)).invoices[`${c.id}:invoice`],
    ).toBeUndefined();
    expect(
      (
        await req(`/api/v1/recovery/${c.id}`, {
          accept: true,
          reason: "Recovered gateway backup and reconciled actual cash",
        })
      ).status,
    ).toBe(200);
    expect(
      (await db.readState(businessId)).invoices[`${c.id}:invoice`].totalPaise,
    ).toBe(280);
  });
  it("blocks duplicate UPI posting and records an owner-review exception", async () => {
    const one = await order(),
      reference = `UPI-${randomUUID()}`;
    const original = await command({
      type: "checkout",
      orderId: one,
      version: 1,
      deviceId,
      sequence: ++sequence,
      cashPaise: 0,
      upiPaise: 280,
      upiVerified: true,
      upiReference: reference,
      creditPaise: 0,
      discountPaise: 0,
    });
    expect(original.status).toBe(200);
    const second = await order();
    const before = await db.readState(businessId);
    const duplicate = await command({
      type: "checkout",
      orderId: second,
      version: 1,
      deviceId,
      sequence: ++sequence,
      cashPaise: 0,
      upiPaise: 280,
      upiVerified: true,
      upiReference: reference,
      creditPaise: 0,
      discountPaise: 0,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.data.code).toBe("PAYMENT_REFERENCE_REUSED");
    const after = await db.readState(businessId);
    expect(Object.keys(after.invoices).length).toBe(
      Object.keys(before.invoices).length,
    );
    expect(
      Object.values(after.reviews).some((r: any) => r.kind === "payment"),
    ).toBe(true);
  });
});
