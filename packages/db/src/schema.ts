import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { collections, type Entity, type Settings } from "@counterwell/core";
export const user = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
});
export const session = pgTable("auth_session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
export const account = pgTable("auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const verification = pgTable("auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  settings: jsonb("settings").$type<Settings>().notNull(),
});
function entityTable(name: string) {
  return pgTable(
    `retail_${name}`,
    {
      businessId: text("business_id")
        .notNull()
        .references(() => businesses.id),
      id: text("id").notNull(),
      revision: integer("revision").notNull(),
      payload: jsonb("payload").$type<Entity>().notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.businessId, t.id] }),
      index(`${name}_sync_idx`).on(t.businessId, t.revision),
    ],
  );
}
export const tables = Object.fromEntries(
  collections.map((name) => [name, entityTable(name)]),
) as Record<(typeof collections)[number], ReturnType<typeof entityTable>>;
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull(),
  actorId: text("actor_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at").notNull().defaultNow(),
  lockedAt: timestamp("locked_at"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
