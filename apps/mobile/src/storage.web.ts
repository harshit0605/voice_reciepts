import type { Command, State } from "@counterwell/core";
export type Queued = {
  command: Command;
  lease: string;
  status: "local" | "gateway" | "review";
  error?: string;
};
const memory = new Map<string, string>();
// Browser preview deliberately does not persist real shop data in unencrypted storage.
export async function get<T>(key: string): Promise<T | null> {
  const v = memory.get(key);
  return v ? JSON.parse(v) : null;
}
export async function set(key: string, value: unknown) {
  memory.set(key, JSON.stringify(value));
}
export async function remove(key: string) {
  memory.delete(key);
}
export async function nextSequence(key: string) {
  const n = ((await get<number>(`sequence:${key}`)) ?? 0) + 1;
  await set(`sequence:${key}`, n);
  return n;
}
/** Returns null, writing nothing, when `commandId` is already queued. */
export async function commitCash(
  scope: string,
  sequenceKey: string,
  commandId: string,
  build: (sequence: number) => { entry: Queued; state: State },
) {
  const entries = (await get<Queued[]>(`outbox:${scope}`)) ?? [];
  if (entries.some((e) => e.command.id === commandId)) return null;
  const n = await nextSequence(sequenceKey);
  const result = build(n);
  await set(`outbox:${scope}`, [...entries, result.entry]);
  await set(`state:${scope}`, result.state);
  return result;
}
export const durableOffline = false;
export async function updateQueue(
  scope: string,
  update: (entries: Queued[]) => Queued[],
) {
  const key = `outbox:${scope}`;
  const result = update((await get<Queued[]>(key)) ?? []);
  await set(key, result);
  return result;
}
