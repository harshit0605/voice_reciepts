import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  execute,
  confirmEodSynchronisation,
  commandSchema,
  employeeView,
  DomainError,
  totals,
  receiptHtml,
  sameFingerprint,
  type Actor,
  type State,
} from "@counterwell/core";
import {
  db,
  pool,
  readState,
  transact,
  changes,
  membershipsFor,
  jobs,
} from "@counterwell/db";
import { auth } from "./auth";
import {
  enqueueExtraction,
  extractionLimit,
  voiceAudioLimit,
} from "./extraction-jobs";
import { signLease, verifyLease } from "./lease";
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const app = new Hono<{
  Variables: { actor: Actor; state: State; userId: string };
}>();
app.use(
  "*",
  cors({
    origin: (origin) =>
      (process.env.TRUSTED_ORIGINS ?? "http://localhost:8081")
        .split(",")
        .includes(origin)
        ? origin
        : "",
    credentials: true,
    allowHeaders: [
      "Content-Type",
      "X-Business-Id",
      "Authorization",
      "Expo-Origin",
      "Cookie",
      "X-Gateway-Token",
    ],
    exposeHeaders: ["set-cookie"],
  }),
);
app.use(
  "*",
  bodyLimit({
    maxSize: 12 * 1024 * 1024,
    onError: (c) => c.json({ error: "Upload exceeds 12 MB" }, 413),
  }),
);
app.onError((e, c) => {
  if (e instanceof ZodError)
    return c.json({ error: "Invalid input", issues: e.issues }, 400);
  if (e instanceof DomainError)
    return c.json(
      { error: e.message, code: e.code },
      e.code === "LIMIT"
        ? 429
        : e.code === "FORBIDDEN"
          ? 403
          : e.code === "NOT_FOUND"
            ? 404
            : e.code === "CONFLICT" ||
                e.code === "PAYMENT_REFERENCE_REUSED" ||
                e.code === "INVOICE_NUMBER_USED"
              ? 409
              : 400,
    );
  console.error(
    JSON.stringify({
      event: "request_failed",
      path: c.req.path,
      error: e.message,
    }),
  );
  return c.json({ error: "Request could not be completed" }, 500);
});
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  console.log(
    JSON.stringify({
      event: "http_request",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latencyMs: Math.round(performance.now() - start),
    }),
  );
});
app.get("/health", async (c) => {
  await pool.query("SELECT 1");
  return c.json({ ok: true, service: "counterwell-api" });
});
// Provisioning calls auth.api internally. Public account creation is always blocked.
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  if (c.req.path.includes("/sign-up"))
    return c.json({ error: "Accounts are created by your shop owner" }, 403);
  return auth.handler(c.req.raw);
});
app.use("/api/v1/*", async (c, next) => {
  if (c.req.path.startsWith("/api/v1/gateway/")) {
    await next();
    return;
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Sign in required" }, 401);
  c.set("userId", session.user.id);
  if (
    c.req.path === "/api/v1/me" ||
    c.req.path === "/api/v1/account/password"
  ) {
    await next();
    return;
  }
  const businessId = c.req.header("X-Business-Id");
  if (!businessId) return c.json({ error: "Select a business" }, 400);
  const state = await readState(businessId);
  const member = state?.members[session.user.id];
  if (!state || !member)
    return c.json({ error: "Business access denied" }, 403);
  const recoveryIngress = c.req.path === "/api/v1/sync";
  if (!member.active && !recoveryIngress)
    return c.json({ error: "Account disabled" }, 403);
  if (member.mustChangePassword)
    return c.json(
      { error: "Change temporary password", code: "PASSWORD_CHANGE_REQUIRED" },
      403,
    );
  c.set("actor", {
    id: session.user.id,
    businessId,
    role: member.role,
    canCollect: member.canCollect,
  });
  c.set("state", state);
  await next();
});
app.get("/api/v1/me", async (c) =>
  c.json({
    userId: c.get("userId"),
    memberships: await membershipsFor(c.get("userId")),
  }),
);
app.post("/api/v1/account/password", async (c) => {
  const data = z
    .object({ currentPassword: z.string(), newPassword: z.string().min(12) })
    .parse(await c.req.json());
  await auth.api.changePassword({
    body: { ...data, revokeOtherSessions: true },
    headers: c.req.raw.headers,
  });
  for (const membership of await membershipsFor(c.get("userId")))
    await transact(membership.businessId, (s) => {
      const next = structuredClone(s);
      next.members[c.get("userId")].mustChangePassword = false;
      return { state: next, result: true };
    });
  return c.json({ ok: true });
});
app.get("/api/v1/state", (c) =>
  c.json(
    c.get("actor").role === "owner"
      ? c.get("state")
      : employeeView(c.get("state"), c.get("actor").id),
  ),
);
app.get("/api/v1/sync", async (c) => {
  const since = z.coerce
    .number()
    .int()
    .min(-1)
    .parse(c.req.query("since") ?? -1);
  const actor = c.get("actor");
  return c.json(
    await changes(actor.businessId, since, (state) => {
      const member = state.members[actor.id];
      if (!member?.active)
        throw new DomainError("FORBIDDEN", "Account disabled");
      return member.role === "owner" ? state : employeeView(state, actor.id);
    }),
  );
});
app.post("/api/v1/commands", async (c) => {
  const cmd = commandSchema.parse(await c.req.json());
  if (cmd.operation.type === "offline.checkout")
    return c.json({ error: "Use signed offline sync" }, 400);
  if (
    cmd.operation.type === "camera.observe" ||
    cmd.operation.type === "coverage.gap"
  )
    return c.json({ error: "Use authenticated gateway ingestion" }, 403);
  const actor = c.get("actor");
  if (cmd.operation.type === "purchase.post" && cmd.operation.documentId) {
    const document = await pool.query(
      "SELECT id FROM jobs WHERE id=$1 AND business_id=$2 AND kind='invoice' AND status='completed'",
      [cmd.operation.documentId, actor.businessId],
    );
    if (!document.rowCount)
      return c.json(
        { error: "Use a completed invoice document from this business" },
        400,
      );
  }
  let result: unknown;
  try {
    result = await transact(actor.businessId, (s) => {
      const current = s.members[actor.id];
      if (!current?.active)
        throw new DomainError("FORBIDDEN", "Account disabled");
      return execute(s, cmd, {
        ...actor,
        role: current.role,
        canCollect: current.canCollect,
      });
    });
  } catch (e) {
    if (e instanceof DomainError && e.code === "PAYMENT_REFERENCE_REUSED")
      await transact(actor.businessId, (s) => {
        const id = `payment-review:${cmd.id}`;
        if (s.reviews[id]) return { state: s, result: true };
        const next = structuredClone(s);
        next.reviews[id] = {
          id,
          kind: "payment",
          referenceId: cmd.id,
          title: "Duplicate UPI reference was blocked",
          detail: `${s.members[actor.id]?.name ?? "Employee"} attempted to reuse a UPI reference. No new invoice or collection was posted; check the merchant records.`,
          createdAt: new Date().toISOString(),
          status: "open",
        };
        next.audit[id] = {
          id,
          actorId: actor.id,
          action: "payment.duplicate_reference",
          referenceId: cmd.id,
          detail: JSON.stringify(cmd.operation),
          occurredAt: cmd.occurredAt,
        };
        return { state: next, result: true };
      });
    throw e;
  }
  return c.json({ result });
});
app.post("/api/v1/devices/register", async (c) => {
  const data = z
    .object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100),
      counterId: z.string().regex(/^[\w-]+$/),
    })
    .parse(await c.req.json());
  const actor = c.get("actor");
  const device = await transact(actor.businessId, (s) => {
    const next = structuredClone(s);
    const existing = next.devices[data.id];
    if (existing) {
      if (existing.userId !== actor.id || existing.revoked)
        throw new DomainError("FORBIDDEN", "Device unavailable");
      existing.lastSeen = new Date().toISOString();
      existing.counterId = data.counterId;
      return { state: next, result: existing };
    }
    const n = Object.keys(next.devices).length + 1;
    if (n > 999) throw new DomainError("INVALID", "Device series exhausted");
    const device = {
      ...data,
      userId: actor.id,
      series: String(n).padStart(3, "0"),
      revoked: false,
      lastSeen: new Date().toISOString(),
      pendingCount: 0,
    };
    next.devices[data.id] = device;
    return { state: next, result: device };
  });
  const issuedAt = new Date().toISOString(),
    expiresAt = new Date(Date.now() + 86400000).toISOString();
  return c.json({
    device,
    lease: await signLease({
      businessId: actor.businessId,
      userId: actor.id,
      deviceId: device.id,
      series: device.series,
      counterId: device.counterId,
      role: actor.role,
      issuedAt,
      expiresAt,
    }),
    issuedAt,
    expiresAt,
  });
});
app.post("/api/v1/devices/heartbeat", async (c) => {
  const data = z
    .object({
      deviceId: z.string(),
      pendingCount: z.number().int().min(0).max(100000),
      acknowledgedRevision: z.number().int().nonnegative().optional(),
    })
    .parse(await c.req.json());
  const a = c.get("actor");
  await transact(a.businessId, (s) => {
    const next = structuredClone(s);
    const d = next.devices[data.deviceId];
    if (!d || d.userId !== a.id || d.revoked)
      throw new DomainError("FORBIDDEN", "Device unavailable");
    d.pendingCount = data.pendingCount;
    d.lastSeen = new Date().toISOString();
    if (data.pendingCount === 0) {
      d.lastSyncedAt = d.lastSeen;
      if (
        data.acknowledgedRevision !== undefined &&
        data.acknowledgedRevision <= s.revision
      )
        d.lastSyncedRevision = data.acknowledgedRevision;
    }
    confirmEodSynchronisation(next, d.lastSeen);
    return { state: next, result: true };
  });
  return c.json({ ok: true });
});
app.post("/api/v1/sync", async (c) => {
  const data = z
    .object({
      entries: z
        .array(z.object({ command: commandSchema, lease: z.string() }))
        .max(100),
    })
    .parse(await c.req.json());
  const actor = c.get("actor");
  const results = [];
  for (const entry of data.entries) {
    const cmd = entry.command;
    if (cmd.operation.type !== "offline.checkout") {
      results.push({
        id: cmd.id,
        status: "invalid",
        error: "Only cash sales can be queued offline",
      });
      continue;
    }
    let reason = "";
    try {
      const lease = await verifyLease(entry.lease);
      if (
        lease.businessId !== actor.businessId ||
        lease.userId !== actor.id ||
        lease.deviceId !== cmd.operation.deviceId
      )
        throw new Error("Offline identity mismatch");
      if (
        cmd.occurredAt < lease.issuedAt ||
        cmd.occurredAt > lease.expiresAt ||
        Date.parse(cmd.occurredAt) > Date.now() + 120000
      )
        throw new Error("Sale outside authorised offline window");
    } catch (e) {
      reason = (e as Error).message;
    }
    const result = await transact<Record<string, unknown>>(
      actor.businessId,
      (s) => {
        const existing = s.commands[cmd.id];
        if (existing) {
          if (
            existing.actorId !== actor.id ||
            !sameFingerprint(existing.fingerprint, JSON.stringify(cmd))
          )
            throw new DomainError("CONFLICT", "Command ID already used");
          return {
            state: s,
            result: { id: cmd.id, status: "synced", result: existing.result },
          };
        }
        if (s.quarantine[cmd.id])
          return {
            state: s,
            result: {
              id: cmd.id,
              status:
                s.quarantine[cmd.id].status === "rejected"
                  ? "resolved_rejected"
                  : "review_required",
              reason:
                s.reviews[cmd.id]?.resolution ?? s.quarantine[cmd.id].reason,
            },
          };
        const device =
          s.devices[(cmd.operation as { deviceId: string }).deviceId];
        if (!device || device.revoked || !s.members[actor.id]?.active)
          reason = "Device or employee access was revoked";
        if (!reason) {
          try {
            const current = s.members[actor.id];
            const posted = execute(s, cmd, {
              ...actor,
              role: current.role,
              canCollect: current.canCollect,
              offlineAuthorized: true,
            });
            return {
              state: posted.state,
              result: { id: cmd.id, status: "synced", result: posted.result },
            };
          } catch (e) {
            reason = (e as Error).message;
          }
        }
        const next = structuredClone(s);
        next.quarantine[cmd.id] = {
          id: cmd.id,
          actorId: actor.id,
          command: cmd,
          reason,
          status: "pending",
        };
        next.reviews[cmd.id] = {
          id: cmd.id,
          kind: "quarantined_command",
          referenceId: cmd.id,
          title: "Offline sale requires recovery",
          detail: reason,
          createdAt: new Date().toISOString(),
          status: "open",
        };
        return {
          state: next,
          result: { id: cmd.id, status: "review_required", reason },
        };
      },
    );
    results.push(result);
  }
  return c.json({ results });
});
app.post("/api/v1/recovery/import", async (c) => {
  const owner = c.get("actor");
  if (owner.role !== "owner") return c.json({ error: "Owner only" }, 403);
  const data = z
    .object({
      entries: z
        .array(z.object({ lease: z.string(), command: commandSchema }))
        .max(100),
    })
    .parse(await c.req.json());
  const imported = [];
  for (const entry of data.entries) {
    const lease = await verifyLease(entry.lease);
    const cmd = entry.command;
    if (
      lease.businessId !== owner.businessId ||
      cmd.operation.type !== "offline.checkout" ||
      cmd.operation.deviceId !== lease.deviceId ||
      cmd.operation.dispenserId !== lease.userId
    )
      throw new DomainError("FORBIDDEN", "Backup identity mismatch");
    const result = await transact(owner.businessId, (s) => {
      if (s.commands[cmd.id] || s.quarantine[cmd.id])
        return { state: s, result: { id: cmd.id, status: "already_present" } };
      const next = structuredClone(s);
      const reason =
        "Recovered from shop gateway backup; verify original bill and collection before posting";
      next.quarantine[cmd.id] = {
        id: cmd.id,
        actorId: lease.userId,
        command: cmd,
        reason,
        status: "pending",
      };
      next.reviews[cmd.id] = {
        id: cmd.id,
        kind: "quarantined_command",
        referenceId: cmd.id,
        title: "Gateway backup requires recovery",
        detail: reason,
        createdAt: new Date().toISOString(),
        status: "open",
      };
      const id = randomUUID();
      next.audit[id] = {
        id,
        actorId: owner.id,
        action: "recovery.import",
        referenceId: cmd.id,
        detail: "Imported a signed gateway backup",
        occurredAt: new Date().toISOString(),
      };
      return { state: next, result: { id: cmd.id, status: "review_required" } };
    });
    imported.push(result);
  }
  return c.json({ results: imported });
});
app.post("/api/v1/recovery/:id", async (c) => {
  const actor = c.get("actor");
  if (actor.role !== "owner") return c.json({ error: "Owner only" }, 403);
  const body = z
    .object({ accept: z.boolean(), reason: z.string().min(3) })
    .parse(await c.req.json());
  const result = await transact(actor.businessId, (s) => {
    const q = s.quarantine[c.req.param("id")];
    if (!q || q.status !== "pending")
      throw new DomainError("INVALID", "Recovery is not pending");
    let next = structuredClone(s);
    if (body.accept) {
      const original = next.members[q.actorId];
      const posted = execute(next, q.command, {
        id: q.actorId,
        businessId: actor.businessId,
        role: original?.role ?? "employee",
        canCollect: true,
        recovery: true,
        offlineAuthorized: true,
      });
      next = posted.state;
    }
    next.quarantine[q.id].status = body.accept ? "accepted" : "rejected";
    next.reviews[q.id].status = "resolved";
    next.reviews[q.id].resolution = body.reason;
    next.reviews[q.id].resolvedBy = actor.id;
    const id = randomUUID();
    next.audit[id] = {
      id,
      actorId: actor.id,
      action: "recovery.decide",
      referenceId: q.id,
      detail: body.reason,
      occurredAt: new Date().toISOString(),
    };
    return { state: next, result: { ok: true } };
  });
  return c.json(result);
});
app.get("/api/v1/reports", (c) => {
  if (c.get("actor").role !== "owner")
    return c.json({ error: "Owner only" }, 403);
  return c.json({
    totals: totals(c.get("state"), c.req.query("date")),
    eods: Object.values(c.get("state").eods),
  });
});
app.get("/api/v1/invoices/:id/receipt", (c) => {
  const invoice = c.get("state").invoices[c.req.param("id")];
  const actor = c.get("actor");
  if (
    !invoice ||
    (actor.role !== "owner" &&
      invoice.collectorId !== actor.id &&
      invoice.dispenserId !== actor.id)
  )
    return c.json({ error: "Invoice not found" }, 404);
  return c.html(receiptHtml(invoice));
});
app.post("/api/v1/employees", async (c) => {
  const actor = c.get("actor");
  if (actor.role !== "owner") return c.json({ error: "Owner only" }, 403);
  const b = z
    .object({
      name: z.string().min(1),
      username: z.string().regex(/^[a-zA-Z0-9_.]{3,30}$/),
      password: z.string().min(12),
      canCollect: z.boolean(),
    })
    .parse(await c.req.json());
  const account = await auth.api.signUpEmail({
    body: {
      name: b.name,
      email: `${randomUUID()}@accounts.invalid`,
      username: b.username,
      password: b.password,
    },
  });
  await transact(actor.businessId, (s) => {
    const next = structuredClone(s);
    next.members[account.user.id] = {
      id: account.user.id,
      name: b.name,
      role: "employee",
      active: true,
      mustChangePassword: true,
      canCollect: b.canCollect,
    };
    return { state: next, result: true };
  });
  return c.json({ id: account.user.id, username: b.username }, 201);
});
app.patch("/api/v1/employees/:id", async (c) => {
  const a = c.get("actor");
  if (a.role !== "owner") return c.json({ error: "Owner only" }, 403);
  const b = z
    .object({ active: z.boolean(), canCollect: z.boolean() })
    .parse(await c.req.json());
  await transact(a.businessId, (s) => {
    const next = structuredClone(s);
    const member = next.members[c.req.param("id")];
    if (!member || member.role === "owner")
      throw new DomainError("INVALID", "Employee missing");
    Object.assign(member, b);
    return { state: next, result: true };
  });
  return c.json({ ok: true });
});
app.post("/api/v1/extractions", async (c) => {
  const form = await c.req.formData();
  const kind = z.enum(["voice", "invoice"]).parse(form.get("kind"));
  const actor = c.get("actor");
  if (kind === "invoice" && actor.role !== "owner")
    return c.json({ error: "Owner only" }, 403);
  const file = form.get("file");
  if (!(file instanceof File))
    return c.json({ error: "File is required" }, 400);
  if (file.size > 10 * 1024 * 1024 || file.size === 0)
    return c.json({ error: "File must be between 1 byte and 10 MB" }, 400);
  const allowed =
    kind === "voice"
      ? [
          "audio/mp4",
          "audio/m4a",
          "audio/x-m4a",
          "audio/wav",
          "audio/webm",
          "audio/mpeg",
          "audio/ogg",
        ]
      : ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type.split(";")[0]))
    return c.json({ error: "Unsupported file format" }, 400);
  const saleId =
    kind === "voice" ? z.string().uuid().parse(form.get("saleId")) : undefined;
  const recordedSeconds =
    kind === "voice"
      ? z.coerce.number().positive().max(30).parse(form.get("recordedSeconds"))
      : undefined;
  const result = await enqueueExtraction(
    actor,
    kind,
    Buffer.from(await file.arrayBuffer()),
    file.type.split(";")[0],
    file.name,
    { recordedSeconds, saleId },
  );
  return c.json(result, result.reused ? 200 : 202);
});
app.post("/api/v1/extractions/text", async (c) => {
  const body = z
    .object({
      text: z.string().trim().min(1).max(4000),
      saleId: z.string().uuid(),
    })
    .strict()
    .parse(await c.req.json());
  const result = await enqueueExtraction(
    c.get("actor"),
    "voice",
    Buffer.from(body.text),
    "text/plain",
    "Typed sale items",
    { transcript: body.text, saleId: body.saleId },
  );
  return c.json(result, result.reused ? 200 : 202);
});
app.get("/api/v1/voice-jobs", async (c) => {
  const actor = c.get("actor");
  const result = await pool.query(
    "SELECT id,status,attempts,error,created_at,coalesce(input->>'transcript',output->>'transcript') AS transcript FROM jobs WHERE business_id=$1 AND actor_id=$2 AND kind='voice' ORDER BY created_at DESC LIMIT 20",
    [actor.businessId, actor.id],
  );
  return c.json({ jobs: result.rows });
});
app.get("/api/v1/extractions", async (c) => {
  const actor = c.get("actor");
  if (actor.role !== "owner") return c.json({ error: "Owner only" }, 403);
  const result = await pool.query(
    "SELECT id,kind,status,input->>'name' AS name,attempts,error,created_at FROM jobs WHERE business_id=$1 AND kind='invoice' ORDER BY created_at DESC LIMIT 30",
    [actor.businessId],
  );
  const usage = await pool.query(
    "SELECT kind,count(*)::int AS jobs,coalesce(sum(attempts),0)::int AS attempts FROM jobs WHERE business_id=$1 AND created_at >= date_trunc('month',timezone('Asia/Kolkata',now())) AT TIME ZONE 'Asia/Kolkata' GROUP BY kind",
    [actor.businessId],
  );
  const audio = await pool.query(
    "SELECT coalesce(sum((input->>'reservedSeconds')::int),0)::int AS reserved_seconds,coalesce(sum((input->>'speechCalls')::int),0)::int AS speech_calls FROM jobs WHERE business_id=$1 AND kind='voice' AND created_at >= date_trunc('month',timezone('Asia/Kolkata',now())) AT TIME ZONE 'Asia/Kolkata'",
    [actor.businessId],
  );
  return c.json({
    audio: { ...audio.rows[0], limit_seconds: voiceAudioLimit() },
    jobs: result.rows,
    usage: usage.rows,
    limits: {
      invoice: extractionLimit("invoice"),
      voice: extractionLimit("voice"),
    },
  });
});
app.post("/api/v1/extractions/:id/retry", async (c) => {
  const actor = c.get("actor");
  if (actor.role !== "owner") return c.json({ error: "Owner only" }, 403);
  const result = await pool.query(
    "UPDATE jobs SET status='pending',error=NULL,available_at=now(),locked_at=NULL WHERE id=$1 AND business_id=$2 AND kind='invoice' AND status='failed' AND attempts<3 RETURNING id,status",
    [c.req.param("id"), actor.businessId],
  );
  if (!result.rowCount)
    return c.json(
      {
        error:
          "Only failed invoices with fewer than three attempts can be retried. Manual entry remains available.",
      },
      409,
    );
  return c.json(result.rows[0]);
});
app.get("/api/v1/extractions/:id", async (c) => {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, c.req.param("id")));
  const actor = c.get("actor");
  if (
    !job ||
    job.businessId !== actor.businessId ||
    (job.actorId !== actor.id && actor.role !== "owner")
  )
    return c.json({ error: "Job not found" }, 404);
  return c.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    output: job.output,
    error: job.error,
    attempts: job.attempts,
    transcript: job.input.transcript ?? null,
  });
});
app.get("/api/v1/documents/:id", async (c) => {
  if (c.get("actor").role !== "owner")
    return c.json({ error: "Owner only" }, 403);
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, c.req.param("id")));
  if (
    !job ||
    job.businessId !== c.get("actor").businessId ||
    job.kind !== "invoice"
  )
    return c.json({ error: "Document not found" }, 404);
  const bytes = await readFile(String(job.input.filename));
  return new Response(bytes, {
    headers: {
      "Content-Type": String(job.input.mimeType),
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
app.post("/api/v1/gateway/heartbeat", async (c) => {
  const expected = process.env.GATEWAY_TOKEN;
  const supplied = c.req.header("X-Gateway-Token") ?? "";
  if (!expected || expected.length < 32 || !safeEqual(expected, supplied))
    return c.json({ error: "Gateway authentication required" }, 401);
  const data = z
    .object({
      printerConfigured: z.boolean(),
      printBacklog: z.number().int().nonnegative(),
      uncertainPrints: z.number().int().nonnegative(),
      cameraBacklog: z.number().int().nonnegative(),
    })
    .parse(await c.req.json());
  await pool.query(
    "INSERT INTO gateway_health(business_id,last_seen,details) VALUES($1,now(),$2) ON CONFLICT(business_id) DO UPDATE SET last_seen=now(),details=$2,gap_reported=false",
    [process.env.BUSINESS_ID, JSON.stringify(data)],
  );
  return c.json({ ok: true });
});
app.get("/api/v1/operations", async (c) => {
  const a = c.get("actor");
  if (a.role !== "owner") return c.json({ error: "Owner only" }, 403);
  const jobs = await pool.query(
    "SELECT kind,status,count(*)::int AS count,min(created_at) AS oldest FROM jobs WHERE business_id=$1 GROUP BY kind,status",
    [a.businessId],
  );
  const health = await pool.query(
    "SELECT last_seen,details FROM gateway_health WHERE business_id=$1",
    [a.businessId],
  );
  const gateway = health.rows[0];
  return c.json({
    jobs: jobs.rows,
    gateway: gateway
      ? {
          ...gateway,
          reachableRecently:
            Date.now() - new Date(gateway.last_seen).getTime() < 90000,
        }
      : null,
    devices: Object.values(c.get("state").devices)
      .filter((d) => !d.revoked)
      .map((d) => ({
        id: d.id,
        name: d.name,
        lastSeen: d.lastSeen,
        pendingCount: d.pendingCount,
        stale: Date.now() - Date.parse(d.lastSeen) > 120000,
      })),
  });
});
app.post("/api/v1/gateway/observations", async (c) => {
  const expected = process.env.GATEWAY_TOKEN;
  const supplied = c.req.header("X-Gateway-Token") ?? "";
  if (!expected || expected.length < 32 || !safeEqual(expected, supplied))
    return c.json({ error: "Gateway authentication required" }, 401);
  const cmd = commandSchema.parse(await c.req.json());
  if (!["camera.observe", "coverage.gap"].includes(cmd.operation.type))
    return c.json({ error: "Unsupported gateway event" }, 400);
  const businessId = process.env.BUSINESS_ID!;
  const result = await transact(businessId, (s) => {
    const next = structuredClone(s);
    next.members["service:gateway"] = {
      id: "service:gateway",
      name: "Shop gateway",
      role: "owner",
      active: true,
      mustChangePassword: false,
      canCollect: false,
    };
    return execute(next, cmd, {
      id: "service:gateway",
      businessId,
      role: "owner",
      canCollect: false,
    });
  });
  return c.json({ result });
});
