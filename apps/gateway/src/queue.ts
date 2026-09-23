import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import type { Invoice } from "@counterwell/core";
export type PrintJob = {
  id: string;
  invoiceId: string;
  businessId: string;
  actorId: string;
  status: "queued" | "printing" | "printed" | "uncertain" | "failed";
  invoice: Invoice;
  createdAt: string;
  error?: string;
  reprintOf?: string;
};
export class GatewayQueue {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, "gateway.sqlite");
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS prints(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS camera_events(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending'); CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY,path TEXT NOT NULL,expires_at TEXT NOT NULL,preserved INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,payload TEXT NOT NULL);",
    );
    for (const job of this.list()) {
      if (job.status === "printing")
        this.update({
          ...job,
          status: "uncertain",
          error:
            "Gateway restarted during printing; inspect the paper before reprinting.",
        });
    }
  }
  list(): PrintJob[] {
    return (
      this.db
        .prepare("SELECT payload FROM prints ORDER BY rowid DESC")
        .all() as { payload: string }[]
    ).map((x) => JSON.parse(x.payload));
  }
  get(id: string): PrintJob | undefined {
    const row = this.db
      .prepare("SELECT payload FROM prints WHERE id=?")
      .get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  add(job: PrintJob) {
    const existing = this.get(job.id);
    if (existing) {
      if (JSON.stringify(existing.invoice) !== JSON.stringify(job.invoice))
        throw new Error("Print ID reused with a different invoice");
      return existing;
    }
    this.db
      .prepare("INSERT INTO prints(id,payload) VALUES(?,?)")
      .run(job.id, JSON.stringify(job));
    return job;
  }
  update(job: PrintJob) {
    this.db
      .prepare("UPDATE prints SET payload=? WHERE id=?")
      .run(JSON.stringify(job), job.id);
  }
  backup(id: string, businessId: string, payload: unknown) {
    const content = JSON.stringify(payload);
    const previous = this.db
      .prepare("SELECT payload FROM backups WHERE id=?")
      .get(id) as { payload: string } | undefined;
    if (previous && previous.payload !== content)
      throw new Error("Backup ID collision");
    this.db
      .prepare("INSERT OR IGNORE INTO backups VALUES(?,?,?)")
      .run(id, businessId, content);
  }
}
