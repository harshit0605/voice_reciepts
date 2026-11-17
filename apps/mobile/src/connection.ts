// How the app talks to the shop server over an unreliable shop connection: which requests may be
// sent again, how a dropped request is retried, and when the phone should call itself offline.
// No React Native imports, so all of it is unit-tested (connection.test.ts).

/** Gateways and tunnels answer these when the API itself is briefly unreachable (restart, deploy). */
export const GATEWAY_STATUSES = new Set([502, 503, 504, 530]);

/**
 * Whether sending the same request twice is harmless. Reads always are. Commands and synced sales
 * carry their own id and the server returns the first result for a repeated id; device register,
 * heartbeat and push registration overwrite by device id. Uploads and extraction jobs are not:
 * each one is billed.
 */
export function canRepeat(method: string | undefined, route: string) {
  const m = (method ?? "GET").toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  if (m !== "POST") return false;
  const path = route.split("?")[0];
  return (
    path === "/commands" ||
    path === "/sync" ||
    path === "/devices/register" ||
    path === "/devices/heartbeat" ||
    path === "/devices/push"
  );
}

/** A network-level failure that may have reached the server (unlike a refused connection). */
export class TransientFailure extends Error {
  constructor(
    message: string,
    /** Nothing could have reached the server on any attempt. */
    public notSent: boolean,
    public status?: number,
  ) {
    super(message);
  }
}

/**
 * An answer from something in front of the API rather than the API: a gateway status, or an error
 * page that is not the API's JSON (during a deploy the proxy answers "404 page not found" as text).
 */
export function fromGateway(r: Pick<Response, "status" | "ok" | "headers">) {
  if (GATEWAY_STATUSES.has(r.status)) return true;
  return !r.ok && !(r.headers.get("content-type") ?? "").includes("json");
}

export type Attempt = (signal: AbortSignal) => Promise<Response>;
export type RetryOptions = {
  /** Extra attempts after the first (0 = no retry). */
  retries: number;
  /** Per-attempt time limit. */
  timeoutMs: number;
  /** Wait before retry n (index 0 = before the second attempt). */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  /** True when the error proves the request never left the phone (DNS failure, refused). */
  neverSent?: (e: unknown) => boolean;
  /** Stop retrying, e.g. once the app has gone to the background. */
  shouldStop?: () => boolean;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out after ${ms} ms`)),
    ms,
  );
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/**
 * Runs `attempt`, retrying network failures and gateway answers (see fromGateway). An answer from
 * the API itself (2xx, or a JSON 4xx/500) is returned as is: the server decided, so it is not retried.
 * Throws TransientFailure when every attempt failed.
 */
export async function withRetry(
  attempt: Attempt,
  options: RetryOptions,
): Promise<Response> {
  const sleep = options.sleep ?? defaultSleep;
  const delays = options.delaysMs ?? [400, 1500, 3000];
  let allNeverSent = true;
  let last: unknown;
  let lastStatus: number | undefined;
  for (let n = 0; n <= options.retries; n++) {
    if (n > 0) {
      if (options.shouldStop?.()) break;
      // Jitter so a shop's phones do not all retry in the same instant after an outage.
      const base = delays[Math.min(n - 1, delays.length - 1)];
      await sleep(base + Math.floor(Math.random() * base * 0.25));
    }
    const { signal, done } = timeoutSignal(options.timeoutMs);
    try {
      const response = await attempt(signal);
      if (!fromGateway(response)) return response;
      // The gateway answered, so the request reached the server side: it may have been applied.
      allNeverSent = false;
      lastStatus = response.status;
      last = new Error(`Gateway answered ${response.status}`);
    } catch (e) {
      last = e;
      if (!options.neverSent?.(e)) allNeverSent = false;
    } finally {
      done();
    }
  }
  throw new TransientFailure(
    String((last as Error)?.message ?? last ?? "Request failed"),
    allNeverSent,
    lastStatus,
  );
}

export type ReachabilityOptions = {
  /** Consecutive failed requests (after their retries) that mean offline. */
  failuresToOffline?: number;
  /** One failed request means offline if nothing succeeded for this long. */
  staleAfterMs?: number;
  /** Failures right after the app comes back to the front are the OS waking the radio, not an outage. */
  resumeGraceMs?: number;
  now?: () => number;
};

/**
 * Decides when the phone is offline. One dropped request is not an outage: it takes two failed
 * requests in a row, or one failure after a long silence. Any success means online again.
 * Failures while the app is in the background, or just after it returns, are ignored, because the
 * OS suspends networking there and those failures say nothing about the shop's connection.
 */
export class Reachability {
  private failures = 0;
  private lastSuccess: number;
  private resumedAt = -Infinity;
  private active = true;
  online = true;
  private readonly failuresToOffline: number;
  private readonly staleAfterMs: number;
  private readonly resumeGraceMs: number;
  private readonly now: () => number;
  constructor(options: ReachabilityOptions = {}) {
    this.failuresToOffline = options.failuresToOffline ?? 2;
    this.staleAfterMs = options.staleAfterMs ?? 20_000;
    this.resumeGraceMs = options.resumeGraceMs ?? 4_000;
    this.now = options.now ?? Date.now;
    this.lastSuccess = this.now();
  }
  /** Returns true when this changed `online`. */
  success() {
    this.failures = 0;
    this.lastSuccess = this.now();
    const changed = !this.online;
    this.online = true;
    return changed;
  }
  /** Returns true when this changed `online`. */
  failure() {
    if (!this.active || this.now() - this.resumedAt < this.resumeGraceMs)
      return false;
    this.failures++;
    const stale = this.now() - this.lastSuccess >= this.staleAfterMs;
    if (this.online && (this.failures >= this.failuresToOffline || stale)) {
      this.online = false;
      return true;
    }
    return false;
  }
  /** The app went to the background (true) or came back to the front (false). */
  setActive(active: boolean) {
    if (active && !this.active) this.resumedAt = this.now();
    this.active = active;
  }
  /** Seen offline at start-up (no saved session could be confirmed): show it straight away. */
  markOffline() {
    const changed = this.online;
    this.online = false;
    return changed;
  }
}
