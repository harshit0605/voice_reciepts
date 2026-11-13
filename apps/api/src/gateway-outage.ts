// Tells the owner's phone when the shop PC (gateway) has been silent for a long time, once per
// outage, and optionally once when it returns. The gateway reports every 30 seconds; the worker
// already opens an in-app coverage review after 90 seconds, which is too early for a phone buzz
// (a router restart would wake the owner), so the phone waits for `silentMinutes`.
//
// Shops whose gateway never reported have no gateway_health row, so they are never alerted.
// The "already told" mark lives in the row (outage_notified_at), so a worker restart cannot
// repeat a notification, and the claim is a single UPDATE so two workers cannot both send it.
import { pool, readState } from "@counterwell/db";
import { gatewayNotices } from "@counterwell/core";
import { notify } from "./notifications";

export const silentMinutes = 30;

type Sender = (
  businessId: string,
  kind: "silent" | "back",
  minutes: number,
) => Promise<void>;

async function sendToOwners(
  businessId: string,
  kind: "silent" | "back",
  minutes: number,
) {
  const state = await readState(businessId);
  if (!state) return;
  const notices = gatewayNotices(state, kind, minutes);
  if (notices.length) await notify(businessId, state, notices);
}

/**
 * One pass. `send` is replaceable so tests need no phones. Returns what it announced.
 */
export async function checkGatewayOutages(send: Sender = sendToOwners) {
  const announced: { businessId: string; kind: "silent" | "back" }[] = [];
  const silent = await pool.query(
    `UPDATE gateway_health SET outage_notified_at=now()
     WHERE last_seen < now() - make_interval(mins => $1) AND outage_notified_at IS NULL
     RETURNING business_id, extract(epoch FROM now()-last_seen)/60 AS minutes`,
    [silentMinutes],
  );
  for (const row of silent.rows) {
    announced.push({ businessId: row.business_id, kind: "silent" });
    await send(row.business_id, "silent", Number(row.minutes)).catch(
      logFailure,
    );
  }
  // A heartbeat newer than the notification means it has come back.
  const back = await pool.query(
    `UPDATE gateway_health g SET outage_notified_at=NULL
     FROM (SELECT business_id, outage_notified_at AS told, last_seen FROM gateway_health
           WHERE outage_notified_at IS NOT NULL AND last_seen > outage_notified_at FOR UPDATE) old
     WHERE g.business_id = old.business_id
     RETURNING g.business_id, extract(epoch FROM old.last_seen - old.told)/60 + $1 AS minutes`,
    [silentMinutes],
  );
  for (const row of back.rows) {
    announced.push({ businessId: row.business_id, kind: "back" });
    await send(row.business_id, "back", Number(row.minutes)).catch(logFailure);
  }
  return announced;
}
const logFailure = (e: Error) =>
  console.warn(
    JSON.stringify({ event: "gateway_alert_failed", error: e.message }),
  );
