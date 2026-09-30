import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "@counterwell/db";
import { DomainError, type Actor } from "@counterwell/core";
export const EXTRACTION_VERSION = "receiving-v3";
export function voiceAudioLimit() {
  const n = Number(process.env.VOICE_MONTHLY_RESERVED_SECONDS ?? 18000);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("Invalid audio allowance");
  return n;
}
export function extractionLimit(kind: string) {
  const limit = Number(
    process.env[
      kind === "invoice" ? "INVOICE_MONTHLY_LIMIT" : "VOICE_MONTHLY_LIMIT"
    ] ?? (kind === "invoice" ? 100 : 3000),
  );
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error("Invalid extraction limit configuration");
  return limit;
}
export async function enqueueExtraction(
  actor: Actor,
  kind: "voice" | "invoice",
  bytes: Buffer,
  mimeType: string,
  name: string,
  options: {
    transcript?: string;
    recordedSeconds?: number;
    saleId?: string;
  } = {},
) {
  const hash = createHash("sha256")
    .update(kind === "voice" ? "voice-v5" : EXTRACTION_VERSION)
    .update(kind === "voice" ? (options.saleId ?? "legacy") : "")
    .update(mimeType)
    .update(bytes)
    .digest("hex");
  const client = await pool.connect();
  let filename: string | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `extraction:${actor.businessId}`,
    ]);
    const prior = await client.query(
      "SELECT id,status FROM jobs WHERE business_id=$1 AND kind=$2 AND input->>'hash'=$3 AND ($2='invoice' OR actor_id=$4) ORDER BY created_at DESC LIMIT 1",
      [actor.businessId, kind, hash, actor.id],
    );
    if (prior.rows[0]) {
      await client.query("COMMIT");
      return { ...prior.rows[0], reused: true };
    }
    const count = await client.query(
      "SELECT count(*)::int AS n FROM jobs WHERE business_id=$1 AND kind=$2 AND created_at >= date_trunc('month',timezone('Asia/Kolkata',now())) AT TIME ZONE 'Asia/Kolkata'",
      [actor.businessId, kind],
    );
    if (count.rows[0].n >= extractionLimit(kind))
      throw new DomainError(
        "LIMIT",
        "Monthly AI allowance reached. Manual entry remains available.",
      );
    const reservedSeconds =
      kind === "voice" && mimeType !== "text/plain" ? 60 : 0;
    if (reservedSeconds) {
      const used = await client.query(
        "SELECT coalesce(sum((input->>'reservedSeconds')::int),0)::int AS seconds FROM jobs WHERE business_id=$1 AND kind='voice' AND created_at >= date_trunc('month',timezone('Asia/Kolkata',now())) AT TIME ZONE 'Asia/Kolkata'",
        [actor.businessId],
      );
      if (used.rows[0].seconds + reservedSeconds > voiceAudioLimit())
        throw new DomainError(
          "LIMIT",
          "Monthly speech allowance reached. Type the items or use search.",
        );
    }
    const id = randomUUID();
    const dir = path.resolve(
      fileURLToPath(new URL("../../../", import.meta.url).href),
      process.env.UPLOAD_DIR ?? ".data/uploads",
      actor.businessId,
    );
    await mkdir(dir, { recursive: true, mode: 0o700 });
    filename = path.join(dir, id);
    await writeFile(filename, bytes, { mode: 0o600 });
    const model =
      (kind === "invoice"
        ? process.env.INVOICE_MODEL
        : process.env.STRUCTURE_MODEL) ??
      process.env.GEMINI_MODEL ??
      "gemini-2.5-flash-lite";
    await client.query(
      "INSERT INTO jobs(id,business_id,actor_id,kind,input) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        actor.businessId,
        actor.id,
        kind,
        JSON.stringify({
          filename,
          mimeType,
          name,
          hash,
          version: kind === "voice" ? "voice-v5" : EXTRACTION_VERSION,
          model,
          reservedSeconds,
          ...(options.saleId ? { saleId: options.saleId } : {}),
          ...(options.transcript !== undefined
            ? { transcript: options.transcript }
            : {}),
          ...(options.recordedSeconds !== undefined
            ? { recordedSeconds: options.recordedSeconds }
            : {}),
        }),
      ],
    );
    await client.query("COMMIT");
    filename = undefined;
    return { id, status: "pending", reused: false };
  } catch (e) {
    await client.query("ROLLBACK");
    if (filename) await unlink(filename).catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// A crash after a provider call may still have incurred cost. Recovery consumes the
// same attempt budget instead of retrying abandoned jobs forever.
export async function recoverAbandonedExtractions() {
  const recovered = await pool.query(
    "UPDATE jobs SET status=CASE WHEN attempts>=2 THEN 'failed' ELSE 'pending' END,error='Worker interrupted; provider billing may be uncertain',locked_at=NULL WHERE status='running' AND locked_at < now()-interval '10 minutes' RETURNING kind,status,input",
  );
  for (const job of recovered.rows)
    if (job.status === "failed" && job.kind === "voice")
      await unlink(job.input.filename).catch(() => {});
}
