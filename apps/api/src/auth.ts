import { betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import {
  db,
  user,
  session,
  account,
  verification,
  membershipsFor,
  transact,
} from "@counterwell/db";
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
  hooks: {
    // A password change always signs out every other device (a temporary password
    // was seen by the owner). The new session cookie goes back with the response.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/change-password")
        return {
          context: { body: { ...ctx.body, revokeOtherSessions: true } },
        };
    }),
    // Only a successful change clears the temporary-password requirement.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      const returned = ctx.context.returned as
        { user?: { id: string } } | undefined;
      if (!returned || isAPIError(returned) || !returned.user) return;
      const userId = returned.user.id;
      for (const membership of await membershipsFor(userId))
        await transact(membership.businessId, (s) => {
          if (!s.members[userId]?.mustChangePassword)
            return { state: s, result: false };
          const next = structuredClone(s);
          next.members[userId].mustChangePassword = false;
          return { state: next, result: true };
        });
    }),
  },
  rateLimit: { enabled: true, window: 60, max: 60 },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
});
