import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repositoryRoot = fileURLToPath(
  new URL("../../../", import.meta.url).href,
);
import { z } from "zod";
import { commandSchema, type Invoice } from "@counterwell/core";
import { verifyLease } from "../../api/src/lease";
import { GatewayQueue } from "./queue";
import { printInvoice } from "./printer";
const queue = new GatewayQueue(
  path.resolve(repositoryRoot, process.env.GATEWAY_DATA_DIR ?? ".data/gateway"),
);
const app = new Hono();
const businessId = process.env.BUSINESS_ID;
app.use(
  "*",
  cors({
    origin: (o) =>
      (process.env.TRUSTED_ORIGINS ?? "http://localhost:8081")
        .split(",")
        .includes(o)
        ? o
        : "",
  }),
);
app.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
app.onError((e, c) => c.json({ error: e.message }, 400));
async function authorise(token: string, current = true) {
  const l = await verifyLease(token);
  if (l.businessId !== businessId) throw new Error("Wrong shop");
  if (current && Date.now() > Date.parse(l.expiresAt))
    throw new Error("Reconnect and renew device authorisation");
  return l;
}
function ownerToken(value: string | undefined) {
  const expected = process.env.GATEWAY_TOKEN ?? "";
  return (
    expected.length >= 32 &&
    value?.length === expected.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
app.get("/health", (c) =>
  c.json({
    ok: true,
    printerConfigured: !!process.env.PRINTER_HOST,
    queued: queue.list().filter((j) => j.status === "queued").length,
  }),
);
app.post("/backup", async (c) => {
  const b = z
    .object({ lease: z.string(), command: commandSchema })
    .parse(await c.req.json());
  const l = await authorise(b.lease, false);
  if (
    b.command.operation.type !== "offline.checkout" ||
    b.command.operation.deviceId !== l.deviceId ||
    b.command.operation.dispenserId !== l.userId ||
    b.command.occurredAt < l.issuedAt ||
    b.command.occurredAt > l.expiresAt
  )
    throw new Error("Invalid offline backup");
  queue.backup(b.command.id, l.businessId, b);
  return c.json({ id: b.command.id, status: "gateway-backed" });
});
app.get("/backups", async (c) => {
  if (!ownerToken(c.req.header("X-Gateway-Token")))
    await clipOwner(c.req.header("Authorization"));
  const rows = queue.db
    .prepare("SELECT payload FROM backups WHERE business_id=?")
    .all(businessId ?? "") as { payload: string }[];
  return c.json({ entries: rows.map((r) => JSON.parse(r.payload)) });
});
app.post("/print", async (c) => {
  const b = z
    .object({
      lease: z.string(),
      invoice: z
        .object({
          id: z.string(),
          number: z.string(),
          collectorId: z.string(),
          dispenserId: z.string(),
          lines: z.array(z.unknown()).min(1).max(100),
          business: z.object({ name: z.string() }).passthrough(),
        })
        .passthrough(),
    })
    .parse(await c.req.json());
  const l = await authorise(b.lease);
  if (
    l.role !== "owner" &&
    b.invoice.collectorId !== l.userId &&
    b.invoice.dispenserId !== l.userId
  )
    throw new Error("Invoice is not associated with this employee");
  const job = queue.add({
    id: b.invoice.id,
    invoiceId: b.invoice.id,
    businessId: l.businessId,
    actorId: l.userId,
    status: "queued",
    invoice: b.invoice as Invoice,
    createdAt: new Date().toISOString(),
  });
  return c.json({ id: job.id, status: job.status }, 202);
});
app.post("/prints/status", async (c) => {
  const b = z
    .object({ lease: z.string(), id: z.string() })
    .parse(await c.req.json());
  const l = await authorise(b.lease);
  const j = queue.get(b.id);
  if (
    !j ||
    j.businessId !== l.businessId ||
    (j.actorId !== l.userId && l.role !== "owner")
  )
    return c.json({ error: "Print job unavailable" }, 404);
  return c.json(j);
});
app.post("/prints/reprint", async (c) => {
  const b = z
    .object({
      lease: z.string(),
      id: z.string(),
      reason: z.string().min(3),
      paperChecked: z.literal(true),
    })
    .parse(await c.req.json());
  const l = await authorise(b.lease);
  const previous = queue.get(b.id);
  if (
    !previous ||
    (previous.actorId !== l.userId && l.role !== "owner") ||
    previous.businessId !== l.businessId
  )
    throw new Error("Print job unavailable");
  if (["queued", "printing"].includes(previous.status))
    throw new Error("Original print job is still active");
  const id = randomUUID();
  const job = queue.add({
    ...previous,
    id,
    status: "queued",
    createdAt: new Date().toISOString(),
    error: undefined,
    reprintOf: previous.id,
  });
  queue.db.prepare("INSERT INTO audit VALUES(?,?)").run(
    id,
    JSON.stringify({
      actorId: l.userId,
      action: "print.reprint",
      reason: b.reason,
      originalId: previous.id,
      at: job.createdAt,
    }),
  );
  return c.json({ id, status: job.status }, 202);
});
app.post("/camera/events", async (c) => {
  if (!ownerToken(c.req.header("X-Gateway-Token")))
    return c.json({ error: "Gateway authentication required" }, 401);
  const cmd = commandSchema.parse(await c.req.json());
  if (!["camera.observe", "coverage.gap"].includes(cmd.operation.type))
    throw new Error("Unsupported camera event");
  queue.db
    .prepare("INSERT OR IGNORE INTO camera_events(id,payload) VALUES(?,?)")
    .run(cmd.id, JSON.stringify(cmd));
  return c.json({ ok: true });
});
// Clip filenames are fixed IDs in an operator-configured local directory, never client-supplied paths.
app.post("/camera/clips", async (c) => {
  if (!ownerToken(c.req.header("X-Gateway-Token")))
    return c.json({ error: "Operator token required" }, 401);
  const b = z
    .object({ id: z.string().regex(/^[a-f0-9]{32}$/) })
    .parse(await c.req.json());
  const filename = path.resolve(
    repositoryRoot,
    process.env.CAMERA_CLIP_DIR ?? ".data/gateway/clips",
    b.id + ".mp4",
  );
  const info = await stat(filename);
  if (!info.isFile() || info.size > 25 * 1024 * 1024)
    throw new Error("Invalid local clip");
  queue.db
    .prepare("INSERT OR IGNORE INTO clips(id,path,expires_at) VALUES(?,?,?)")
    .run(b.id, filename, new Date(Date.now() + 7 * 86400000).toISOString());
  return c.json({ ok: true });
});
async function clipOwner(header: string | undefined) {
  const l = await authorise((header ?? "").replace(/^Bearer /, ""));
  if (l.role !== "owner") throw new Error("Owner access required");
  return l;
}
app.get("/clips/:id", async (c) => {
  await clipOwner(c.req.header("Authorization"));
  const clip = queue.db
    .prepare("SELECT * FROM clips WHERE id=?")
    .get(c.req.param("id")) as
    { path: string; expires_at: string; preserved: number } | undefined;
  if (!clip || (!clip.preserved && Date.parse(clip.expires_at) < Date.now()))
    return c.json({ error: "Clip unavailable" }, 404);
  return new Response(await readFile(clip.path), {
    headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" },
  });
});
app.post("/clips/:id/preserve", async (c) => {
  const l = await clipOwner(c.req.header("Authorization"));
  const b = z
    .object({ preserve: z.boolean(), reason: z.string().min(3) })
    .parse(await c.req.json());
  const existing = queue.db
    .prepare("SELECT id FROM clips WHERE id=?")
    .get(c.req.param("id"));
  if (!existing) return c.json({ error: "Clip unavailable" }, 404);
  queue.db
    .prepare("UPDATE clips SET preserved=? WHERE id=?")
    .run(b.preserve ? 1 : 0, c.req.param("id"));
  queue.db.prepare("INSERT INTO audit VALUES(?,?)").run(
    randomUUID(),
    JSON.stringify({
      actorId: l.userId,
      action: "clip.preserve",
      clipId: c.req.param("id"),
      ...b,
      at: new Date().toISOString(),
    }),
  );
  return c.json({ ok: true });
});
let lastHeartbeat = 0;
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    if (Date.now() - lastHeartbeat >= 30000) {
      lastHeartbeat = Date.now();
      const jobs = queue.list();
      const pending = queue.db
        .prepare(
          "SELECT count(*) AS n FROM camera_events WHERE status='pending'",
        )
        .get() as { n: number };
      try {
        await fetch(`${process.env.BETTER_AUTH_URL}/api/v1/gateway/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Gateway-Token": process.env.GATEWAY_TOKEN ?? "",
          },
          body: JSON.stringify({
            printerConfigured: !!process.env.PRINTER_HOST,
            printBacklog: jobs.filter((j) => j.status === "queued").length,
            uncertainPrints: jobs.filter((j) => j.status === "uncertain")
              .length,
            cameraBacklog: pending.n,
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        /* the API worker reports missed gateway heartbeats */
      }
    }
    const job = queue
      .list()
      .reverse()
      .find((j) => j.status === "queued");
    if (job && process.env.PRINTER_HOST) {
      queue.update({ ...job, status: "printing" });
      try {
        await printInvoice(job.invoice, !!job.reprintOf);
        queue.update({ ...job, status: "printed" });
      } catch (e) {
        queue.update({
          ...job,
          status: "uncertain",
          error: (e as Error).message,
        });
      }
    }
    const events = queue.db
      .prepare(
        "SELECT id,payload FROM camera_events WHERE status='pending' LIMIT 20",
      )
      .all() as { id: string; payload: string }[];
    for (const e of events) {
      try {
        const r = await fetch(
          `${process.env.BETTER_AUTH_URL}/api/v1/gateway/observations`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Gateway-Token": process.env.GATEWAY_TOKEN ?? "",
            },
            body: e.payload,
            signal: AbortSignal.timeout(5000),
          },
        );
        if (r.ok)
          queue.db
            .prepare("UPDATE camera_events SET status='sent' WHERE id=?")
            .run(e.id);
      } catch {
        break;
      }
    }
    for (const clip of queue.db
      .prepare("SELECT id,path FROM clips WHERE preserved=0 AND expires_at<?")
      .all(new Date().toISOString()) as { id: string; path: string }[]) {
      await unlink(clip.path).catch(() => {});
      queue.db.prepare("DELETE FROM clips WHERE id=?").run(clip.id);
    }
  } finally {
    running = false;
  }
}
setInterval(() => void tick(), 1000);
serve(
  {
    fetch: app.fetch,
    port: Number(process.env.GATEWAY_PORT ?? 4101),
    hostname: "0.0.0.0",
  },
  (i) => console.log(`Shop gateway listening on ${i.port}`),
);
