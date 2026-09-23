import { totals } from "./money";
import type { State } from "./types";
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
    const pending = Object.values(state.devices).some(
      (d) =>
        !d.revoked &&
        (d.pendingCount > 0 ||
          !d.lastSyncedAt ||
          d.lastSyncedAt < cutoff ||
          (latest.syncCutoffRevision !== undefined &&
            (d.lastSyncedRevision ?? -1) < latest.syncCutoffRevision)),
    );
    if (
      pending ||
      Object.values(state.quarantine).some((q) => q.status === "pending")
    )
      continue;
    const revision = latest.revision + 1,
      id = `${date}:${revision}`;
    state.eods[id] = {
      id,
      date,
      revision,
      createdAt: now,
      syncCutoffAt: cutoff,
      syncCutoffRevision: latest.syncCutoffRevision,
      totals: totals(state, date),
      provisional: false,
    };
  }
}
