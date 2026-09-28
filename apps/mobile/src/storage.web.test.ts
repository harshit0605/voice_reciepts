import { describe, it, expect } from "vitest";
import * as storage from "./storage.web";
const entry = (id: string) =>
  ({
    command: { id, occurredAt: "2026-09-23T09:00:00.000Z", operation: {} },
    lease: "lease",
    status: "local",
  }) as unknown as storage.Queued;
describe("local cash commit", () => {
  it("never queues the same sale twice or spends another invoice number", async () => {
    const scope = "shop:recommit";
    const first = await storage.commitCash(scope, "seq", "sale-1", () => ({
      entry: entry("sale-1"),
      state: {} as any,
    }));
    expect(first).not.toBeNull();
    let rebuilt = false;
    const again = await storage.commitCash(scope, "seq", "sale-1", () => {
      rebuilt = true;
      return { entry: entry("sale-1"), state: {} as any };
    });
    expect(again).toBeNull();
    expect(rebuilt).toBe(false);
    expect(await storage.get(`outbox:${scope}`)).toHaveLength(1);
    expect(await storage.get("sequence:seq")).toBe(1);
  });
});
describe("invoice number release", () => {
  it("returns an unused number only while it is still the latest", async () => {
    const key = "device:2627";
    expect(await storage.nextSequence(key)).toBe(1);
    await storage.releaseSequence(key, 1);
    expect(await storage.nextSequence(key)).toBe(1);
    expect(await storage.nextSequence(key)).toBe(2);
    await storage.releaseSequence(key, 1);
    expect(await storage.nextSequence(key)).toBe(3);
  });
});
