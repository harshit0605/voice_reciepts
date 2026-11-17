import { describe, it, expect } from "vitest";
import {
  canRepeat,
  withRetry,
  Reachability,
  TransientFailure,
  type Attempt,
} from "./connection";

const ok = (status = 200, type = "application/json") =>
  new Response("{}", { status, headers: { "content-type": type } });
const noSleep = async () => {};
const refused = () => new TypeError("Could not connect to the server.");
const dropped = () => new TypeError("Network request failed");
const neverSent = (e: unknown) =>
  /Could not connect/.test(String((e as Error).message));

/** Plays back answers in order; a function entry is thrown, a number is a status. */
function script(steps: (number | (() => Error))[]) {
  const calls: AbortSignal[] = [];
  const attempt: Attempt = async (signal) => {
    calls.push(signal);
    const step = steps[calls.length - 1];
    if (typeof step === "function") throw step();
    return ok(step);
  };
  return { attempt, calls };
}

describe("which requests may be sent twice", () => {
  it("allows reads and id-carrying writes, never billed uploads", () => {
    expect(canRepeat(undefined, "/state")).toBe(true);
    expect(canRepeat("GET", "/sync?since=4")).toBe(true);
    expect(canRepeat("POST", "/commands")).toBe(true);
    expect(canRepeat("POST", "/sync")).toBe(true);
    expect(canRepeat("POST", "/devices/heartbeat")).toBe(true);
    expect(canRepeat("POST", "/devices/register")).toBe(true);
    expect(canRepeat("POST", "/extractions")).toBe(false);
    expect(canRepeat("POST", "/extractions/text")).toBe(false);
    expect(canRepeat("POST", "/extractions/abc/retry")).toBe(false);
    expect(canRepeat("POST", "/employees")).toBe(false);
    expect(canRepeat("PATCH", "/employees/1")).toBe(false);
    expect(canRepeat("POST", "/recovery/import")).toBe(false);
  });
});

describe("retrying a dropped request", () => {
  it("returns the first answer without retrying", async () => {
    const s = script([200]);
    const r = await withRetry(s.attempt, {
      retries: 2,
      timeoutMs: 1000,
      sleep: noSleep,
    });
    expect(r.status).toBe(200);
    expect(s.calls).toHaveLength(1);
  });
  it("retries a dropped connection and succeeds", async () => {
    const s = script([dropped, dropped, 200]);
    const r = await withRetry(s.attempt, {
      retries: 2,
      timeoutMs: 1000,
      sleep: noSleep,
    });
    expect(r.status).toBe(200);
    expect(s.calls).toHaveLength(3);
  });
  it("retries gateway answers during a restart, then succeeds", async () => {
    const s = script([502, 503, 201]);
    const r = await withRetry(s.attempt, {
      retries: 2,
      timeoutMs: 1000,
      sleep: noSleep,
    });
    expect(r.status).toBe(201);
  });
  it("treats a proxy's text error page during a deploy as unreachable", async () => {
    let n = 0;
    const attempt: Attempt = async () =>
      ++n === 1 ? ok(404, "text/plain; charset=utf-8") : ok(200);
    const r = await withRetry(attempt, {
      retries: 1,
      timeoutMs: 1000,
      sleep: noSleep,
    });
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });
  it("does not retry the API's own answers, including errors", async () => {
    for (const status of [400, 401, 403, 409, 500]) {
      const s = script([status, 200]);
      const r = await withRetry(s.attempt, {
        retries: 2,
        timeoutMs: 1000,
        sleep: noSleep,
      });
      expect(r.status).toBe(status);
      expect(s.calls).toHaveLength(1);
    }
  });
  it("gives up after the allowed attempts and says whether anything could have arrived", async () => {
    const never = script([refused, refused, refused]);
    const e1 = await withRetry(never.attempt, {
      retries: 2,
      timeoutMs: 1000,
      sleep: noSleep,
      neverSent,
    }).catch((e) => e);
    expect(e1).toBeInstanceOf(TransientFailure);
    expect(e1.notSent).toBe(true);
    expect(never.calls).toHaveLength(3);
    // One attempt might have reached the server, so a sale must not be treated as unsent.
    const maybe = script([refused, dropped, refused]);
    const e2 = await withRetry(maybe.attempt, {
      retries: 2,
      timeoutMs: 1000,
      sleep: noSleep,
      neverSent,
    }).catch((e) => e);
    expect(e2.notSent).toBe(false);
    const gateway = script([refused, 502]);
    const e3 = await withRetry(gateway.attempt, {
      retries: 1,
      timeoutMs: 1000,
      sleep: noSleep,
      neverSent,
    }).catch((e) => e);
    expect(e3.notSent).toBe(false);
    expect(e3.status).toBe(502);
  });
  it("makes exactly one attempt when retries are not allowed", async () => {
    const s = script([dropped, 200]);
    await expect(
      withRetry(s.attempt, { retries: 0, timeoutMs: 1000, sleep: noSleep }),
    ).rejects.toBeInstanceOf(TransientFailure);
    expect(s.calls).toHaveLength(1);
  });
  it("aborts an attempt that takes too long, then retries", async () => {
    let n = 0;
    const attempt: Attempt = (signal) =>
      ++n === 1
        ? new Promise((_, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          )
        : Promise.resolve(ok());
    const r = await withRetry(attempt, {
      retries: 1,
      timeoutMs: 20,
      sleep: noSleep,
    });
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });
  it("stops retrying once told to (the app went to the background)", async () => {
    const s = script([dropped, 200]);
    await expect(
      withRetry(s.attempt, {
        retries: 2,
        timeoutMs: 1000,
        sleep: noSleep,
        shouldStop: () => true,
      }),
    ).rejects.toBeInstanceOf(TransientFailure);
    expect(s.calls).toHaveLength(1);
  });
  it("waits longer before each retry", async () => {
    const waits: number[] = [];
    const s = script([dropped, dropped, dropped]);
    await withRetry(s.attempt, {
      retries: 2,
      timeoutMs: 1000,
      delaysMs: [100, 1000],
      sleep: async (ms) => void waits.push(ms),
    }).catch(() => {});
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(100);
    expect(waits[0]).toBeLessThan(130);
    expect(waits[1]).toBeGreaterThanOrEqual(1000);
  });
});

describe("deciding the phone is offline", () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };
  it("does not call one dropped request an outage", () => {
    const c = clock();
    const r = new Reachability({ now: c.now });
    c.advance(1000);
    expect(r.failure()).toBe(false);
    expect(r.online).toBe(true);
    r.success();
    c.advance(1000);
    expect(r.failure()).toBe(false);
    expect(r.online).toBe(true);
  });
  it("goes offline after two failures in a row and back online on the next success", () => {
    const c = clock();
    const r = new Reachability({ now: c.now });
    r.failure();
    expect(r.failure()).toBe(true);
    expect(r.online).toBe(false);
    expect(r.failure()).toBe(false); // already offline: no change to report
    expect(r.success()).toBe(true);
    expect(r.online).toBe(true);
  });
  it("goes offline on one failure after a long silence", () => {
    const c = clock();
    const r = new Reachability({ now: c.now, staleAfterMs: 20_000 });
    c.advance(25_000);
    expect(r.failure()).toBe(true);
  });
  it("ignores failures in the background and just after returning", () => {
    const c = clock();
    const r = new Reachability({ now: c.now, resumeGraceMs: 4000 });
    r.setActive(false);
    c.advance(60_000);
    r.failure();
    r.failure();
    expect(r.online).toBe(true);
    r.setActive(true);
    c.advance(1000);
    r.failure();
    r.failure();
    expect(r.online).toBe(true);
    // Time in the background is not silence: one later failure is still not an outage.
    c.advance(4000);
    expect(r.failure()).toBe(false);
    expect(r.failure()).toBe(true);
  });
  it("judges a request by when it started: a sync begun as the app woke, failing 12 s later, is ignored", () => {
    const c = clock();
    const r = new Reachability({ now: c.now, resumeGraceMs: 4000 });
    r.setActive(false);
    c.advance(120_000);
    r.setActive(true);
    const started = c.now() + 800;
    c.advance(13_000);
    r.failure(started);
    r.failure(started);
    expect(r.online).toBe(true);
  });
  it("ignores a slow failure from before the connection came back", () => {
    const c = clock();
    const r = new Reachability({ now: c.now });
    const early = c.now();
    r.failure(early);
    r.failure(early);
    expect(r.online).toBe(false);
    c.advance(2000);
    r.success();
    c.advance(10_000);
    // A request that began before that success and only now timed out says nothing new.
    expect(r.failure(early)).toBe(false);
    expect(r.failure(early)).toBe(false);
    expect(r.online).toBe(true);
  });
  it("can be marked offline at start-up", () => {
    const r = new Reachability();
    expect(r.markOffline()).toBe(true);
    expect(r.online).toBe(false);
    expect(r.success()).toBe(true);
  });
});
