import { serve } from "@hono/node-server";
import { app } from "./app";
for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET"])
  if (!process.env[name]) throw new Error(`${name} is required`);
if (!process.env.OFFLINE_SIGNING_KEY && !process.env.OFFLINE_SIGNING_SECRET)
  throw new Error(
    "OFFLINE_SIGNING_KEY is required (OFFLINE_SIGNING_SECRET for local development)",
  );
import type { Server } from "node:http";
import { pool } from "@counterwell/db";
const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 4100),
    hostname: "0.0.0.0",
  },
  (info) => console.log(`Counterwell API listening on ${info.port}`),
) as Server;
// The proxy keeps idle connections open for up to 90 s; Node's default 5 s would close sockets
// the proxy is about to reuse, which surfaces as an occasional 502.
server.keepAliveTimeout = 95_000;
server.headersTimeout = 96_000;
// A deploy sends SIGTERM: stop taking new connections, let requests in flight finish (phones
// would otherwise see a dropped sale), then close the database pool.
let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(JSON.stringify({ event: "shutdown", signal }));
  const force = setTimeout(() => process.exit(0), 15_000) as unknown as {
    unref?: () => void;
  };
  force.unref?.();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  server.closeIdleConnections?.();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
