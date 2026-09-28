import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { Command, State } from "@counterwell/core";
export type Queued = {
  command: Command;
  lease: string;
  status: "local" | "gateway" | "review";
  error?: string;
};
let connection: Promise<SQLite.SQLiteDatabase> | undefined;
function db() {
  if (!connection) {
    connection = (async () => {
      let key = await SecureStore.getItemAsync("counterwell.database.key");
      if (!key) {
        key = Array.from(await Crypto.getRandomBytesAsync(32))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        await SecureStore.setItemAsync("counterwell.database.key", key);
      }
      const db = await SQLite.openDatabaseAsync("counterwell.db");
      await db.execAsync(`PRAGMA key = \"x'${key}'\";`);
      const cipher = await db.getFirstAsync("PRAGMA cipher_version");
      if (!cipher)
        throw new Error(
          "Encrypted storage needs a development build; Expo Go is not supported",
        );
      await db.execAsync(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
      );
      return db;
    })();
    // Let a later call retry, for example after the keychain becomes available.
    connection.catch(() => (connection = undefined));
  }
  return connection;
}
// expo-sqlite's withExclusiveTransactionAsync opens a second connection that never
// receives the SQLCipher key ("file is not a database"). Everything therefore runs on
// the one keyed connection, one operation at a time, so nothing can interleave with an
// open transaction.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>) {
  const run = queue.then(async () => task(await db()));
  queue = run.catch(() => {});
  return run;
}
function transaction<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>) {
  return serial(async (d) => {
    await d.execAsync("BEGIN IMMEDIATE");
    try {
      const out = await task(d);
      await d.execAsync("COMMIT");
      return out;
    } catch (e) {
      await d.execAsync("ROLLBACK");
      throw e;
    }
  });
}
const read = async <T>(d: SQLite.SQLiteDatabase, key: string) => {
  const row = await d.getFirstAsync<{ value: string }>(
    "SELECT value FROM kv WHERE key=?",
    key,
  );
  return row ? (JSON.parse(row.value) as T) : null;
};
const write = (d: SQLite.SQLiteDatabase, key: string, value: unknown) =>
  d.runAsync(
    "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    JSON.stringify(value),
  );
export function get<T>(key: string): Promise<T | null> {
  return serial((d) => read<T>(d, key));
}
export async function set(key: string, value: unknown) {
  await serial((d) => write(d, key, value));
}
export async function remove(key: string) {
  await serial((d) => d.runAsync("DELETE FROM kv WHERE key=?", key));
}
export function nextSequence(key: string) {
  return transaction(async (d) => {
    const value = Number((await read<number>(d, `sequence:${key}`)) ?? 0) + 1;
    await write(d, `sequence:${key}`, value);
    return value;
  });
}
/** Give back a number the server definitely did not use, unless a later one was already taken. */
export async function releaseSequence(key: string, sequence: number) {
  await transaction(async (d) => {
    if (Number((await read<number>(d, `sequence:${key}`)) ?? 0) === sequence)
      await write(d, `sequence:${key}`, sequence - 1);
  });
}
/** Returns null, writing nothing, when `commandId` is already queued. */
export function commitCash(
  scope: string,
  sequenceKey: string,
  commandId: string,
  build: (sequence: number) => { entry: Queued; state: State },
) {
  return transaction(async (d) => {
    const entries = (await read<Queued[]>(d, `outbox:${scope}`)) ?? [];
    if (entries.some((e) => e.command.id === commandId)) return null;
    const n =
      Number((await read<number>(d, `sequence:${sequenceKey}`)) ?? 0) + 1;
    const built = build(n);
    await write(d, `sequence:${sequenceKey}`, n);
    await write(d, `outbox:${scope}`, [...entries, built.entry]);
    await write(d, `state:${scope}`, built.state);
    return built;
  });
}
export const durableOffline = true;
export function updateQueue(
  scope: string,
  update: (entries: Queued[]) => Queued[],
) {
  return transaction(async (d) => {
    const result = update((await read<Queued[]>(d, `outbox:${scope}`)) ?? []);
    await write(d, `outbox:${scope}`, result);
    return result;
  });
}
