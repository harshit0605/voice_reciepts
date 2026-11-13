// Encrypted database backups, offered to the shop PC so a copy lives off the server.
// The backup service writes counterwell-<date>-<time>.sql.gz (plain, stays on the server) and,
// when BACKUP_AGE_RECIPIENT is set, a .sql.gz.age next to it that only the owner's private key can
// open. Only the .age files are ever listed or served here. BACKUP_DIR is the folder, mounted
// read-only into the API; without it none of this is available.
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { gatewayAuthorised } from "./gateway-auth";

const encrypted = /^counterwell-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz\.age$/;
const anyDump = /^counterwell-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz(\.age)?$/;

export type BackupInfo = {
  name: string;
  size: number;
  modifiedAt: string;
  sha256: string;
};

// A finished backup never changes, so its hash is worked out once per (name, size, mtime).
const hashes = new Map<string, string>();
async function sha256Of(file: string, key: string) {
  const known = hashes.get(key);
  if (known) return known;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const digest = hash.digest("hex");
  hashes.set(key, digest);
  return digest;
}

/** The encrypted backups, newest first. */
export async function listBackups(dir: string): Promise<BackupInfo[]> {
  const names = (await readdir(dir)).filter((n) => encrypted.test(n));
  const rows: BackupInfo[] = [];
  for (const name of names.sort().reverse()) {
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) continue;
    rows.push({
      name,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      sha256: await sha256Of(file, `${name}:${info.size}:${info.mtimeMs}`),
    });
  }
  return rows;
}

/**
 * Hours since the newest finished backup, or null if the folder has none. Once encrypted copies
 * exist, only they count: if encrypting breaks, the plain dumps keep coming but the shop PC gets
 * nothing, and that must show as a stale backup. Undefined when the folder is not set up or not
 * readable, so /health can leave the field out.
 */
export async function newestBackupAgeHours(
  dir: string | undefined,
  now = Date.now(),
): Promise<number | null | undefined> {
  if (!dir) return undefined;
  try {
    const names = (await readdir(dir)).filter((n) => anyDump.test(n));
    const sealed = names.filter((n) => encrypted.test(n));
    let newest = 0;
    for (const name of sealed.length ? sealed : names) {
      const info = await stat(path.join(dir, name)).catch(() => undefined);
      if (info?.isFile()) newest = Math.max(newest, info.mtimeMs);
    }
    return newest ? Math.round(((now - newest) / 3_600_000) * 10) / 10 : null;
  } catch {
    return undefined;
  }
}

export const backupRoutes = new Hono();
backupRoutes.use("*", async (c, next) => {
  if (!gatewayAuthorised(c.req.header("X-Gateway-Token")))
    return c.json({ error: "Gateway authentication required" }, 401);
  if (!process.env.BACKUP_DIR)
    return c.json({ error: "Backups are not available" }, 503);
  await next();
});
backupRoutes.get("/", async (c) => {
  try {
    return c.json({ backups: await listBackups(process.env.BACKUP_DIR!) });
  } catch {
    return c.json({ error: "Backups are not available" }, 503);
  }
});
// The name must match the backup pattern exactly, so it can never point outside the folder or
// at a plain (unencrypted) dump. The file is streamed, never loaded into memory.
backupRoutes.get("/:name", async (c) => {
  const name = c.req.param("name");
  if (!encrypted.test(name)) return c.json({ error: "Backup not found" }, 404);
  const file = path.join(process.env.BACKUP_DIR!, name);
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) return c.json({ error: "Backup not found" }, 404);
  const sha256 = await sha256Of(file, `${name}:${info.size}:${info.mtimeMs}`);
  return new Response(
    Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
    {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(info.size),
        "X-Content-SHA256": sha256,
        "Cache-Control": "no-store",
      },
    },
  );
});
