import { deviceExpected, eodSnapshot } from "./drawer";
import type { Device, Eod, State } from "./types";
/** Each live phone must acknowledge a completed sync after the report cutoff.
 * A recent heartbeat before close cannot prove the phone has no queued cash sale.
 * Confirmation appends a revision rather than rewriting a previously shown report.
 */
export function confirmEodSynchronisation(state: State, now: string) {
  const dates = new Set(Object.values(state.eods).map((e) => e.date));
  for (const date of dates) {
    const latest = Object.values(state.eods)
      .filter((e) => e.date === date)
      .sort((a, b) => b.revision - a.revision)[0];
    if (!latest.provisional) continue;
    const cutoff = latest.syncCutoffAt ?? latest.createdAt;
    if (
      phonesHoldingReport(state, latest).length ||
      Object.values(state.quarantine).some((q) => q.status === "pending")
    )
      continue;
    const eod = eodSnapshot(state, date, now, {
      syncCutoffAt: cutoff,
      syncCutoffRevision: latest.syncCutoffRevision,
      provisional: false,
    });
    state.eods[eod.id] = eod;
  }
}
/** The phones a provisional report still waits for: each must sync with nothing unsent after the report was made. */
export function phonesHoldingReport(state: State, eod: Eod) {
  const cutoff = eod.syncCutoffAt ?? eod.createdAt;
  return Object.values(state.devices).filter(
    (d) =>
      deviceExpected(d, cutoff) &&
      (d.pendingCount > 0 ||
        !d.lastSyncedAt ||
        d.lastSyncedAt < cutoff ||
        (eod.syncCutoffRevision !== undefined &&
          (d.lastSyncedRevision ?? -1) < eod.syncCutoffRevision)),
  );
}
/** "Aarav · iPhone · bills 004": whose phone, and the series in its bill numbers, rather than an ID. */
export function deviceLabel(state: State, device: Device) {
  const kind = /ios|iphone/i.test(device.name)
    ? "iPhone"
    : /android/i.test(device.name)
      ? "Android phone"
      : device.name;
  return `${state.members[device.userId]?.name ?? "Unknown"} · ${kind} · bills ${device.series}`;
}

/** How far a phone clock may drift from the server's and still sign sales on a lease. */
export const LEASE_SKEW_MS = 5 * 60 * 1000;
/** Is `at` inside a lease's validity, allowing for clock drift at either end? Used by the phone before signing and by the server when a sale syncs. */
export function withinLeaseWindow(
  at: string,
  issuedAt: string,
  expiresAt: string,
) {
  const t = Date.parse(at);
  return (
    Number.isFinite(t) &&
    t >= Date.parse(issuedAt) - LEASE_SKEW_MS &&
    t <= Date.parse(expiresAt) + LEASE_SKEW_MS
  );
}
