import { readFile, unlink } from "node:fs/promises";
import { pool, readState } from "@counterwell/db";
import { parseExactSaleText } from "@counterwell/core";
import { extract, transcribe, structureTranscript } from "./providers";
export type ExtractionJob = {
  id: string;
  business_id: string;
  kind: "voice" | "invoice";
  attempts: number;
  input: Record<string, any>;
};
const defaults = {
  transcribe,
  structure: structureTranscript,
  invoice: extract,
  catalogue: async (businessId: string) =>
    Object.values((await readState(businessId))?.products ?? {}),
};
export async function processClaimedExtraction(
  job: ExtractionJob,
  deps: typeof defaults = defaults,
) {
  const started = performance.now();
  try {
    let output: any;
    if (job.kind === "voice") {
      let transcript: string | undefined = job.input.transcript;
      if (transcript === undefined) {
        // Increment before calling so a lost response remains visible as an attempt.
        await pool.query(
          "UPDATE jobs SET input=jsonb_set(input,'{speechCalls}',to_jsonb(coalesce((input->>'speechCalls')::int,0)+1)) WHERE id=$1",
          [job.id],
        );
        transcript = await deps.transcribe(
          await readFile(job.input.filename),
          job.input.mimeType,
        );
        await pool.query(
          "UPDATE jobs SET input=input || $2::jsonb WHERE id=$1",
          [job.id, JSON.stringify({ transcript })],
        );
        job.input.transcript = transcript;
        // Structure retries now use the persisted transcript, not another STT call.
        await unlink(job.input.filename).catch(() => {});
      }
      if (!transcript.trim())
        throw new Error("No speech was recognised; record again or use search");
      const local = parseExactSaleText(
        transcript,
        await deps.catalogue(job.business_id),
      );
      output = local
        ? {
            transcript,
            draft: local,
            provider: "local",
            model: "exact-catalogue-v1",
            usage: null,
            requiresReview: true,
          }
        : await deps.structure(transcript, job.input.model);
    } else
      output = await deps.invoice(
        "invoice",
        await readFile(job.input.filename),
        job.input.mimeType,
        job.input.model,
      );
    await pool.query(
      "UPDATE jobs SET status='completed',output=$2,error=NULL,locked_at=NULL WHERE id=$1",
      [
        job.id,
        JSON.stringify({
          ...output,
          latencyMs: Math.round(performance.now() - started),
        }),
      ],
    );
    if (job.kind === "voice") await unlink(job.input.filename).catch(() => {});
    return { status: "completed" };
  } catch (e) {
    const status = Number((e as any).status ?? (e as any).code);
    const transient =
      status === 429 ||
      status >= 500 ||
      /timeout|fetch failed|returned (429|5\d\d)/i.test((e as Error).message);
    const terminal = job.attempts >= 2 || !transient;
    await pool.query(
      "UPDATE jobs SET status=$2,error=$3,locked_at=NULL,available_at=now()+interval '30 seconds' WHERE id=$1",
      [job.id, terminal ? "failed" : "pending", (e as Error).message],
    );
    if (terminal && job.kind === "voice")
      await unlink(job.input.filename).catch(() => {});
    return { status: terminal ? "failed" : "pending" };
  }
}
