import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GatewayQueue, type PrintJob } from "./queue";
import { demoState, execute, type Invoice } from "@counterwell/core";
function invoice() {
  const now = new Date().toISOString();
  let s = demoState();
  const a = {
    id: "demo-owner",
    businessId: s.businessId,
    role: "owner" as const,
    canCollect: true,
    offlineAuthorized: true,
  };
  return execute(
    s,
    {
      id: "sale",
      occurredAt: now,
      operation: {
        type: "offline.checkout",
        orderId: "o",
        deviceId: "demo-device",
        sequence: 1,
        dispenserId: a.id,
        counterId: "counter-1",
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
        cashPaise: 280,
      },
    },
    a,
  ).result as Invoice;
}
describe("durable gateway", () => {
  it("survives restart and marks interrupted prints uncertain instead of retrying", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "counterwell-"));
    try {
      const q = new GatewayQueue(dir);
      const i = invoice();
      const job: PrintJob = {
        id: "print1",
        invoiceId: i.id,
        businessId: "pilot-pharmacy",
        actorId: "demo-owner",
        invoice: i,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      q.add(job);
      q.update({ ...job, status: "printing" });
      q.db.close();
      const restored = new GatewayQueue(dir);
      expect(restored.get(job.id)?.status).toBe("uncertain");
      restored.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("deduplicates print and backup IDs and detects collisions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "counterwell-"));
    try {
      const q = new GatewayQueue(dir);
      const i = invoice();
      const j: PrintJob = {
        id: "p",
        invoiceId: i.id,
        businessId: "pilot-pharmacy",
        actorId: "owner",
        invoice: i,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      q.add(j);
      q.add(j);
      expect(q.list()).toHaveLength(1);
      q.backup("a", "b", { test: 1 });
      q.backup("a", "b", { test: 1 });
      expect(() => q.backup("a", "b", { test: 2 })).toThrow("collision");
      q.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("treats the synced copy of an offline bill as the same print", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "counterwell-"));
    try {
      const q = new GatewayQueue(dir);
      const phone = invoice();
      const job: PrintJob = {
        id: phone.id,
        invoiceId: phone.id,
        businessId: "pilot-pharmacy",
        actorId: "demo-owner",
        invoice: phone,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      q.add(job);
      const synced: Invoice = {
        ...phone,
        postedAt: "2026-09-24T10:00:00.000Z",
        business: { ...phone.business, gatewayUrl: "http://10.0.0.9:4101" },
        lines: phone.lines.map(({ costPaise, ...l }) => l as typeof l),
      };
      expect(q.add({ ...job, invoice: synced }).invoice.postedAt).toBe(
        phone.postedAt,
      );
      expect(() =>
        q.add({ ...job, invoice: { ...synced, totalPaise: 1 } }),
      ).toThrow("different invoice");
      q.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
