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
async function db() {
  if (!connection)
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
  return connection;
}
export async function get<T>(key: string): Promise<T | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>("SELECT value FROM kv WHERE key=?", key);
  return row ? JSON.parse(row.value) : null;
}
export async function set(key: string, value: unknown) {
  await (
    await db()
  ).runAsync(
    "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    JSON.stringify(value),
  );
}
export async function remove(key: string) {
  await (await db()).runAsync("DELETE FROM kv WHERE key=?", key);
}
export async function nextSequence(key: string) {
  let value = 0;
  await (
    await db()
  ).withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM kv WHERE key=?",
      `sequence:${key}`,
    );
    value = Number(row?.value ?? 0) + 1;
    await tx.runAsync(
      "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      `sequence:${key}`,
      String(value),
    );
  });
  return value;
}
export async function commitCash(
  scope: string,
  sequenceKey: string,
  build: (sequence: number) => { entry: Queued; state: State },
) {
  let result!: ReturnType<typeof build>;
  await (
    await db()
  ).withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM kv WHERE key=?",
      `sequence:${sequenceKey}`,
    );
    const n = Number(row?.value ?? 0) + 1;
    result = build(n);
    const queued = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM kv WHERE key=?",
      `outbox:${scope}`,
    );
    const entries: Queued[] = queued ? JSON.parse(queued.value) : [];
    entries.push(result.entry);
    for (const [key, value] of [
      [`sequence:${sequenceKey}`, n],
      [`outbox:${scope}`, entries],
      [`state:${scope}`, result.state],
    ] as const)
      await tx.runAsync(
        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        key,
        JSON.stringify(value),
      );
  });
  return result;
}
export const durableOffline = true;
export async function updateQueue(
  scope: string,
  update: (entries: Queued[]) => Queued[],
) {
  let result: Queued[] = [];
  await (
    await db()
  ).withExclusiveTransactionAsync(async (tx) => {
    const key = `outbox:${scope}`;
    const row = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM kv WHERE key=?",
      key,
    );
    result = update(row ? JSON.parse(row.value) : []);
    await tx.runAsync(
      "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(result),
    );
  });
  return result;
}
