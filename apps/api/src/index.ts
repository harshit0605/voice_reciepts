import { serve } from "@hono/node-server";
import { app } from "./app";
for (const name of [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "OFFLINE_SIGNING_SECRET",
])
  if (!process.env[name]) throw new Error(`${name} is required`);
serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 4100),
    hostname: "0.0.0.0",
  },
  (info) => console.log(`Counterwell API listening on ${info.port}`),
);
