import { pool, transact } from "@counterwell/db";
import { execute } from "@counterwell/core";
import { randomUUID } from "node:crypto";
import { processClaimedExtraction } from "./process-extraction";
import { recoverAbandonedExtractions } from "./extraction-jobs";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
let lastHealthCheck = 0;
async function monitorGateway() {
  if (Date.now() - lastHealthCheck < 30000) return;
  lastHealthCheck = Date.now();
  const stale = await pool.query(
    "SELECT business_id,last_seen FROM gateway_health WHERE last_seen < now()-interval '90 seconds' AND gap_reported=false",
  );
  for (const row of stale.rows) {
    await transact(row.business_id, (s) => {
      const next = structuredClone(s);
      next.members["service:gateway"] = {
        id: "service:gateway",
        name: "Shop gateway",
        role: "owner",
        active: true,
        mustChangePassword: false,
        canCollect: false,
      };
      return execute(
        next,
        {
          id: `gateway-gap:${row.business_id}:${row.last_seen.toISOString()}`,
          occurredAt: new Date(row.last_seen.getTime() + 90000).toISOString(),
          operation: {
            type: "coverage.gap",
            source: "gateway",
            detail: `No gateway heartbeat since ${row.last_seen.toISOString()}; backup, printing and camera coverage are uncertain.`,
          },
        },
        {
          id: "service:gateway",
          businessId: row.business_id,
          role: "owner",
          canCollect: false,
        },
      );
    });
    await pool.query(
      "UPDATE gateway_health SET gap_reported=true WHERE business_id=$1 AND last_seen=$2",
      [row.business_id, row.last_seen],
    );
  }
}
async function run() {
  await monitorGateway();
  // Recover crashed jobs. Voice files are deleted only after success or terminal failure.
  await recoverAbandonedExtractions();
  const claimed = await pool.query(
    "UPDATE jobs SET status='running',locked_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='pending' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
  );
  const job = claimed.rows[0];
  if (!job) return false;
  const result = await processClaimedExtraction(job);
  console.log(
    JSON.stringify({
      event: "extraction_attempt",
      id: job.id,
      kind: job.kind,
      attempt: job.attempts,
      status: result.status,
    }),
  );
  return true;
}
while (!stopping) {
  if (!(await run())) await new Promise((r) => setTimeout(r, 1000));
}
await pool.end();
