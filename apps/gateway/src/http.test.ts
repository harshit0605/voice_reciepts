import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { signLease } from "../../api/src/lease";
import { demoState, execute, type Invoice } from "@counterwell/core";
let child: ChildProcess,
  dir: string,
  base: string,
  lease: string,
  employeeLease: string,
  invoice: Invoice;
const secret = "gateway-test-signing-secret-32-characters";
const token = "gateway-test-operator-token-32-characters";
async function request(
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}
describe("Gateway authentication and HTTP queue", () => {
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "counterwell-http-"));
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        server.close(() => resolve(port));
      });
      server.on("error", reject);
    });
    base = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/gateway/src/index.ts"],
      {
        env: {
          ...process.env,
          GATEWAY_PORT: String(port),
          GATEWAY_DATA_DIR: dir,
          CAMERA_CLIP_DIR: path.join(dir, "clips"),
          BUSINESS_ID: "pilot-pharmacy",
          OFFLINE_SIGNING_SECRET: secret,
          GATEWAY_TOKEN: token,
          PRINTER_HOST: "",
          BETTER_AUTH_URL: "http://127.0.0.1:1",
        },
        stdio: "ignore",
      },
    );
    process.env.OFFLINE_SIGNING_SECRET = secret;
    const now = new Date().toISOString();
    const grant = {
      businessId: "pilot-pharmacy",
      userId: "demo-owner",
      deviceId: "demo-device",
      series: "D01",
      counterId: "counter-1",
      issuedAt: now,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    lease = await signLease({ ...grant, role: "owner" });
    employeeLease = await signLease({
      ...grant,
      userId: "demo-employee",
      role: "employee",
    });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        ready = (await request("/health")).status === 200;
        if (ready) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw new Error("Gateway did not start");
    const actor = {
      id: "demo-owner",
      role: "owner" as const,
      canCollect: true,
      businessId: "pilot-pharmacy",
    };
    const order = execute(
      demoState(),
      {
        id: "order",
        occurredAt: now,
        operation: {
          type: "order.save",
          orderId: "order",
          version: 0,
          counterId: "counter-1",
          lines: [
            {
              batchId: "dolo-b1",
              quantity: "1",
              unit: "tablet",
              confirmed: true,
            },
          ],
        },
      },
      actor,
    ).state;
    invoice = execute(
      order,
      {
        id: "bill",
        occurredAt: now,
        operation: {
          type: "checkout",
          orderId: "order",
          version: 1,
          deviceId: "demo-device",
          sequence: 1,
          cashPaise: 280,
          upiPaise: 0,
          creditPaise: 0,
          discountPaise: 0,
        },
      },
      actor,
    ).result as Invoice;
  }, 15000);
  afterAll(async () => {
    if (child?.pid) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  it("requires owner authority for backup export and camera clips", async () => {
    expect((await request("/backups")).status).toBe(400);
    expect(
      (
        await request("/backups", undefined, {
          Authorization: `Bearer ${employeeLease}`,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/backups", undefined, {
          Authorization: `Bearer ${lease}`,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/clips/missing", undefined, {
          Authorization: `Bearer ${employeeLease}`,
        })
      ).status,
    ).toBe(400);
  });
  it("idempotently queues print jobs and refuses premature reprints", async () => {
    const a = await request("/print", { lease, invoice });
    expect(a.status).toBe(202);
    const b = await request("/print", { lease, invoice });
    expect(b.body.id).toBe(a.body.id);
    const status = await request("/prints/status", { lease, id: a.body.id });
    expect(status.body.status).toBe("queued");
    expect(
      (
        await request("/prints/reprint", {
          lease,
          id: a.body.id,
          reason: "test reprint",
          paperChecked: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/print", { lease: employeeLease, invoice })).status,
    ).toBe(400);
  });
  it("rejects unsigned camera ingress and tampered offline backup", async () => {
    const cmd = {
      id: "camera-gap",
      occurredAt: new Date().toISOString(),
      operation: {
        type: "coverage.gap",
        source: "test-camera",
        detail: "Test camera coverage gap",
      },
    };
    expect((await request("/camera/events", cmd)).status).toBe(401);
    expect(
      (await request("/camera/events", cmd, { "X-Gateway-Token": token }))
        .status,
    ).toBe(200);
    expect(
      (await request("/backup", { lease: "forged", command: cmd })).status,
    ).toBe(400);
  });
});
