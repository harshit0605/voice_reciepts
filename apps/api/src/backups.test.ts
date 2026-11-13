import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { backupRoutes, listBackups, newestBackupAgeHours } from "./backups";

// A fresh throwaway token and folder; the "backups" are random bytes, not real dumps.
const token = randomBytes(24).toString("hex");
const app = new Hono().route("/api/v1/gateway/backups", backupRoutes);
let dir = "";
const content = randomBytes(300_000);
const sha = createHash("sha256").update(content).digest("hex");
const get = (route: string, headers: Record<string, string> = {}) =>
  app.request(`http://localhost/api/v1/gateway/backups${route}`, { headers });
const auth = { "X-Gateway-Token": token };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "counterwell-backups-"));
  process.env.GATEWAY_TOKEN = token;
  process.env.BACKUP_DIR = dir;
  await writeFile(
    path.join(dir, "counterwell-2026-11-01-0300.sql.gz.age"),
    content,
  );
  await writeFile(
    path.join(dir, "counterwell-2026-11-02-0300.sql.gz.age"),
    "newer",
  );
  // Never listed or served: plain dump, half-written files, anything else.
  await writeFile(
    path.join(dir, "counterwell-2026-11-02-0300.sql.gz"),
    "PLAIN",
  );
  await writeFile(
    path.join(dir, "counterwell-2026-11-03-0300.sql.gz.age.part"),
    "x",
  );
  await writeFile(path.join(dir, "notes.txt"), "x");
});
afterAll(async () => {
  delete process.env.BACKUP_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("backup routes for the shop PC", () => {
  it("need the gateway token, exactly like the other gateway calls", async () => {
    expect((await get("")).status).toBe(401);
    expect((await get("", { "X-Gateway-Token": "wrong" })).status).toBe(401);
    expect((await get("/counterwell-2026-11-01-0300.sql.gz.age")).status).toBe(
      401,
    );
    expect((await get("", auth)).status).toBe(200);
  });
  it("lists only finished encrypted backups, newest first, with size and checksum", async () => {
    const r = await get("", auth);
    const { backups } = (await r.json()) as {
      backups: { name: string; size: number; sha256: string }[];
    };
    expect(backups.map((b) => b.name)).toEqual([
      "counterwell-2026-11-02-0300.sql.gz.age",
      "counterwell-2026-11-01-0300.sql.gz.age",
    ]);
    expect(backups[1]).toMatchObject({ size: content.length, sha256: sha });
    expect(JSON.stringify(backups)).not.toContain(dir);
  });
  it("streams one backup with its length and checksum", async () => {
    const r = await get("/counterwell-2026-11-01-0300.sql.gz.age", auth);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe(String(content.length));
    expect(r.headers.get("x-content-sha256")).toBe(sha);
    expect(Buffer.from(await r.arrayBuffer()).equals(content)).toBe(true);
  });
  it("never serves plain dumps, partial files or paths outside the folder", async () => {
    for (const name of [
      "counterwell-2026-11-02-0300.sql.gz",
      "counterwell-2026-11-03-0300.sql.gz.age.part",
      "notes.txt",
      "..%2Fetc%2Fpasswd",
      "counterwell-2026-11-09-0300.sql.gz.age", // matches the pattern but is not there
    ])
      expect((await get(`/${name}`, auth)).status).toBe(404);
  });
  it("is unavailable, not an error page, when no folder is mounted", async () => {
    delete process.env.BACKUP_DIR;
    expect((await get("", auth)).status).toBe(503);
    process.env.BACKUP_DIR = dir;
  });
});

describe("newestBackupAgeHours", () => {
  it("is left out when the folder is not set up or unreadable", async () => {
    expect(await newestBackupAgeHours(undefined)).toBeUndefined();
    expect(
      await newestBackupAgeHours(path.join(dir, "missing")),
    ).toBeUndefined();
  });
  it("is null for an empty folder", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "counterwell-empty-"));
    expect(await newestBackupAgeHours(empty)).toBeNull();
    await rm(empty, { recursive: true });
  });
  it("counts plain dumps until encrypted ones exist, then only the encrypted", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "counterwell-age-"));
    const plain = path.join(d, "counterwell-2026-11-02-0300.sql.gz");
    await writeFile(plain, "x");
    await utimes(plain, hoursAgo(5), hoursAgo(5));
    expect(await newestBackupAgeHours(d)).toBeCloseTo(5, 0);
    const sealed = path.join(d, "counterwell-2026-11-01-0300.sql.gz.age");
    await writeFile(sealed, "x");
    await utimes(sealed, hoursAgo(30), hoursAgo(30));
    expect(await newestBackupAgeHours(d)).toBeCloseTo(30, 0);
    await rm(d, { recursive: true });
  });
});

describe("listBackups", () => {
  it("rehashes nothing it has already hashed and ignores vanished files", async () => {
    const first = await listBackups(dir);
    const again = await listBackups(dir);
    expect(again).toEqual(first);
  });
});
