import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, sql } from "drizzle-orm";
import {
  emptyState,
  collections,
  type State,
  type Entity,
} from "@counterwell/core";
import * as schema from "./schema";
export * from "./schema";
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
export const db = drizzle(pool, { schema });
type Db = typeof db;
async function load(
  connection: Pick<Db, "select">,
  id: string,
): Promise<State | null> {
  const [business] = await connection
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, id));
  if (!business) return null;
  const state = emptyState(id, business.settings);
  state.revision = business.revision;
  for (const name of collections) {
    const rows = await connection
      .select()
      .from(schema.tables[name])
      .where(eq(schema.tables[name].businessId, id));
    (state[name] as Record<string, Entity>) = Object.fromEntries(
      rows.map((r) => [r.id, r.payload]),
    );
  }
  return state;
}
export async function readState(id: string): Promise<State | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    return load(tx, id);
  });
}
export async function transact<T>(
  id: string,
  fn: (
    state: State,
  ) => Promise<{ state: State; result: T }> | { state: State; result: T },
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${id},0))`,
    );
    const before = await load(tx, id);
    if (!before) throw new Error("Business not found");
    const { state: after, result } = await fn(before);
    if (after === before) return result;
    const revision = Math.max(before.revision + 1, after.revision);
    await tx
      .update(schema.businesses)
      .set({ revision, settings: after.settings })
      .where(eq(schema.businesses.id, id));
    for (const name of collections) {
      for (const record of Object.values(after[name]) as Entity[]) {
        if (
          JSON.stringify(record) ===
          JSON.stringify((before[name] as Record<string, Entity>)[record.id])
        )
          continue;
        const table = schema.tables[name];
        await tx
          .insert(table)
          .values({ businessId: id, id: record.id, revision, payload: record })
          .onConflictDoUpdate({
            target: [table.businessId, table.id],
            set: { revision, payload: record },
          });
      }
    }
    return result;
  });
}
export async function createBusiness(state: State) {
  await db.transaction(async (tx) => {
    await tx.insert(schema.businesses).values({
      id: state.businessId,
      revision: state.revision,
      settings: state.settings,
    });
    for (const name of collections) {
      const records = Object.values(state[name]) as Entity[];
      if (records.length)
        await tx.insert(schema.tables[name]).values(
          records.map((record) => ({
            businessId: state.businessId,
            id: record.id,
            revision: state.revision,
            payload: record,
          })),
        );
    }
  });
}
export async function membershipsFor(userId: string) {
  const result = await db
    .select()
    .from(schema.tables.members)
    .where(eq(schema.tables.members.id, userId));
  return result.map((r) => ({ businessId: r.businessId, ...r.payload }));
}
export async function changes(
  id: string,
  since: number,
  project: (state: State) => State,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    const state = await load(tx, id);
    if (!state) return null;
    if (since === state.revision)
      return { revision: state.revision, unchanged: true };
    const visible = project(state);
    const delta: Record<string, Record<string, Entity | null>> = {};
    for (const name of collections) {
      const table = schema.tables[name];
      const rows = await tx
        .select()
        .from(table)
        .where(and(eq(table.businessId, id), sql`${table.revision}>${since}`));
      delta[name] = Object.fromEntries(
        rows.map((row) => [
          row.id,
          (visible[name] as Record<string, Entity>)[row.id] ?? null,
        ]),
      );
    }
    return {
      businessId: id,
      revision: state.revision,
      settings: visible.settings,
      changes: delta,
    };
  });
}
