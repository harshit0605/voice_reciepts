// Copies the server's encrypted database backups onto the shop PC, so losing the server does not
// lose the backups with it. The files are encrypted to the owner's public key: this PC can store
// them but cannot read them. Nothing here may get in the way of printing or sale backup, so every
// failure is logged and retried later, never thrown.
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { open, readdir, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { z } from "zod";

const encrypted = /^counterwell-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz\.age$/;
const listing = z.object({
  backups: z.array(
    z.object({
      name: z.string().regex(encrypted),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export const keepBackups = 30;

export type SyncResult = { copied: string[]; failed: string[] };
type SyncOptions = {
  /** The API's address, e.g. https://counterwell.example */
  apiUrl: string;
  token: string;
  dir: string;
  keep?: number;
  fetchImpl?: typeof fetch;
};

/** Downloads one backup to <name>.part, checks size and sha256, then renames it into place. */
async function download(
  o: SyncOptions,
  entry: { name: string; size: number; sha256: string },
) {
  const final = path.join(o.dir, entry.name);
  const part = final + ".part";
  const response = await (o.fetchImpl ?? fetch)(
    `${o.apiUrl}/api/v1/gateway/backups/${entry.name}`,
    {
      headers: { "X-Gateway-Token": o.token },
      signal: AbortSignal.timeout(10 * 60_000),
    },
  );
  if (!response.ok || !response.body)
    throw new Error(`download ${entry.name}: HTTP ${response.status}`);
  const hash = createHash("sha256");
  let size = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
      }),
      createWriteStream(part, { mode: 0o600 }),
    );
    if (size !== entry.size || hash.digest("hex") !== entry.sha256)
      throw new Error(`download ${entry.name}: size or checksum mismatch`);
    // Flush to disk before the name appears, so a power cut cannot leave a half file under it.
    const handle = await open(part, "r");
    await handle.sync().finally(() => handle.close());
    await rename(part, final);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
}

/** Names of the backups held here, newest first. */
export async function localBackups(dir: string) {
  return (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => encrypted.test(n))
    .sort()
    .reverse();
}

/** When the newest backup here arrived, from the file's own time (survives restarts). */
export async function lastCopiedAt(dir: string) {
  const [newest] = await localBackups(dir);
  if (!newest) return null;
  return (await stat(path.join(dir, newest))).mtime.toISOString();
}

/**
 * Fetches every listed backup not already here, then keeps only the newest `keep` files.
 * Individual download failures are collected so the others still go through.
 */
export async function syncBackups(o: SyncOptions): Promise<SyncResult> {
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  const response = await (o.fetchImpl ?? fetch)(
    `${o.apiUrl}/api/v1/gateway/backups`,
    {
      headers: { "X-Gateway-Token": o.token },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`list backups: HTTP ${response.status}`);
  const { backups } = listing.parse(await response.json());
  const have = new Set(await localBackups(o.dir));
  const result: SyncResult = { copied: [], failed: [] };
  // The server lists newest first, so the one that matters most arrives first.
  for (const entry of backups.filter((b) => !have.has(b.name))) {
    try {
      await download(o, entry);
      result.copied.push(entry.name);
    } catch (e) {
      result.failed.push(entry.name);
      console.warn(
        JSON.stringify({
          event: "backup_copy_failed",
          error: (e as Error).message,
        }),
      );
    }
  }
  for (const old of (await localBackups(o.dir)).slice(o.keep ?? keepBackups))
    await rm(path.join(o.dir, old), { force: true });
  // Stray half-downloads from a crash are removed on the next run.
  for (const name of await readdir(o.dir))
    if (name.endsWith(".part"))
      await rm(path.join(o.dir, name), { force: true });
  return result;
}

/**
 * Runs the copy now and then every few hours (sooner after a failure), forever. It runs beside
 * the print loop, never inside it, and keeps `onCopied` told when the newest backup arrived.
 */
export function startBackupSync(
  o: SyncOptions,
  onCopied: (at: string | null) => void,
  everyMs = 3 * 3_600_000,
  retryMs = 10 * 60_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const run = async () => {
    let next = everyMs;
    try {
      const r = await syncBackups(o);
      if (r.failed.length) next = retryMs;
      if (r.copied.length)
        console.log(
          JSON.stringify({ event: "backup_copied", count: r.copied.length }),
        );
    } catch (e) {
      next = retryMs;
      console.warn(
        JSON.stringify({
          event: "backup_sync_failed",
          error: (e as Error).message,
        }),
      );
    }
    onCopied(await lastCopiedAt(o.dir).catch(() => null));
    if (!stopped) timer = setTimeout(() => void run(), next);
  };
  void lastCopiedAt(o.dir).then(onCopied, () => {});
  timer = setTimeout(() => void run(), 5_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
