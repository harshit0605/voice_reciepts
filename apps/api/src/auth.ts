import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { db, user, session, account, verification } from "@counterwell/db";
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (
    process.env.TRUSTED_ORIGINS ?? "http://localhost:8081,counterwell://"
  ).split(","),
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  plugins: [username(), expo()],
  session: { expiresIn: 60 * 60 * 24 * 7 },
  rateLimit: { enabled: true, window: 60, max: 60 },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
});
