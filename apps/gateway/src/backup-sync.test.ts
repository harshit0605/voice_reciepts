import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lastCopiedAt, syncBackups } from "./backup-sync";

// A stand-in for the API's two backup routes, serving random bytes (not real dumps).
const token = randomBytes(24).toString("hex");
const name = (day: number) =>
  `counterwell-2026-10-${String(day).padStart(2, "0")}-0300.sql.gz.age`;
let dir = "";
let files: Record<string, Buffer> = {};
let broken = new Set<string>();
let requests: string[] = [];
let wrongHash = new Set<string>();
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const fakeFetch = (async (url: string, init?: RequestInit) => {
  requests.push(url.replace("http://api.test", ""));
  const headers = init?.headers as Record<string, string>;
  if (headers["X-Gateway-Token"] !== token)
    return new Response("{}", { status: 401 });
  if (url.endsWith("/gateway/backups"))
    return Response.json({
      backups: Object.entries(files)
        .sort()
        .reverse()
        .map(([n, b]) => ({
          name: n,
          size: b.length,
          sha256: wrongHash.has(n) ? "0".repeat(64) : sha(b),
        })),
    });
  const n = url.split("/").pop()!;
  if (broken.has(n)) return new Response("boom", { status: 500 });
  return new Response(new Uint8Array(files[n]));
}) as typeof fetch;
const options = () => ({
  apiUrl: "http://api.test",
  token,
  dir,
  fetchImpl: fakeFetch,
});

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "counterwell-sync-")), "b");
  files = { [name(1)]: randomBytes(70_000), [name(2)]: randomBytes(10) };
  broken = new Set();
  wrongHash = new Set();
  requests = [];
});
afterEach(() => rm(path.dirname(dir), { recursive: true, force: true }));

describe("copying encrypted backups to the shop PC", () => {
  it("downloads what is missing, byte for byte, and leaves no partial files", async () => {
    const r = await syncBackups(options());
    expect(r.copied.sort()).toEqual([name(1), name(2)]);
    expect((await readdir(dir)).sort()).toEqual([name(1), name(2)]);
    expect(
      (await readFile(path.join(dir, name(1)))).equals(files[name(1)]),
    ).toBe(true);
    expect((await stat(path.join(dir, name(1)))).mode & 0o077).toBe(0);
  });
  it("skips backups it already has", async () => {
    await syncBackups(options());
    requests = [];
    const r = await syncBackups(options());
    expect(r.copied).toEqual([]);
    expect(requests).toEqual(["/api/v1/gateway/backups"]);
  });
  it("rejects a download whose checksum is wrong and keeps nothing of it", async () => {
    wrongHash.add(name(1));
    const r = await syncBackups(options());
    expect(r.failed).toEqual([name(1)]);
    expect(r.copied).toEqual([name(2)]);
    expect(await readdir(dir)).toEqual([name(2)]);
    wrongHash.clear();
    expect((await syncBackups(options())).copied).toEqual([name(1)]);
  });
  it("carries on past a failed download and reports it", async () => {
    broken.add(name(2));
    const r = await syncBackups(options());
    expect(r).toEqual({ copied: [name(1)], failed: [name(2)] });
  });
  it("throws (for the caller to log and retry) when the API refuses or is down", async () => {
    await expect(
      syncBackups({ ...options(), token: "wrong-token" }),
    ).rejects.toThrow(/401/);
    await expect(
      syncBackups({
        ...options(),
        fetchImpl: (async () => {
          throw new Error("offline");
        }) as typeof fetch,
      }),
    ).rejects.toThrow("offline");
  });
  it("keeps only the newest 30 and removes stray half-downloads", async () => {
    files = {};
    for (let d = 1; d <= 33; d++) files[name(d)] = Buffer.from(`dump ${d}`);
    await syncBackups({ ...options(), dir });
    await writeFile(path.join(dir, name(40) + ".part"), "half");
    await syncBackups(options());
    const kept = (await readdir(dir)).sort();
    expect(kept).toHaveLength(30);
    expect(kept[0]).toBe(name(4));
    expect(kept.at(-1)).toBe(name(33));
  });
  it("ignores a listing entry with a name that could escape the folder", async () => {
    const evil = (async (url: string) =>
      url.endsWith("/backups")
        ? Response.json({
            backups: [{ name: "../../evil", size: 1, sha256: "a".repeat(64) }],
          })
        : new Response("x")) as typeof fetch;
    await expect(
      syncBackups({ ...options(), fetchImpl: evil }),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
  it("reports when the newest copy arrived, from the file itself", async () => {
    expect(await lastCopiedAt(dir)).toBeNull();
    await syncBackups(options());
    const at = await lastCopiedAt(dir);
    expect(Math.abs(Date.now() - Date.parse(at!))).toBeLessThan(10_000);
  });
});
