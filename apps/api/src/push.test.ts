import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttp2 } from "node:http2";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { demoState, type Notice } from "@counterwell/core";
import { deliver, sendApns, sendFcm } from "./push";

// Stand-ins for Apple (HTTP/2) and Google (token and send endpoints), with throwaway keys.
const apnsSeen: {
  path: string;
  headers: Record<string, unknown>;
  body: string;
}[] = [];
const fcmSeen: { auth: string; body: string }[] = [];
let apns: ReturnType<typeof createHttp2>, google: Server;
const address = (s: { address(): unknown }) =>
  (s.address() as { port: number }).port;

beforeAll(async () => {
  apns = createHttp2((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      apnsSeen.push({ path: req.url, headers: req.headers, body });
      if (req.url.endsWith("/stale")) {
        res.writeHead(410);
        res.end(JSON.stringify({ reason: "Unregistered" }));
      } else {
        res.writeHead(200);
        res.end();
      }
    });
  });
  google = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/token") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({ access_token: "google-access", expires_in: 3600 }),
        );
        fcmSeen.push({ auth: "token-request", body });
        return;
      }
      fcmSeen.push({ auth: String(req.headers.authorization), body });
      const token = JSON.parse(body).message.token;
      res.statusCode = token === "stale" ? 404 : 200;
      res.end(
        token === "stale"
          ? '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}'
          : "{}",
      );
    });
  });
  await Promise.all([
    new Promise<void>((r) => apns.listen(0, "127.0.0.1", () => r())),
    new Promise<void>((r) => google.listen(0, "127.0.0.1", () => r())),
  ]);
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    APNS_HOST: `http://127.0.0.1:${address(apns)}`,
    APNS_KEY: ec.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    APNS_KEY_ID: "APNSKEY123",
    APNS_TEAM_ID: "TEAM123456",
    APNS_TOPIC: "com.counterwell.mobile",
    FCM_BASE_URL: `http://127.0.0.1:${address(google)}`,
    FCM_SERVICE_ACCOUNT: Buffer.from(
      JSON.stringify({
        project_id: "counterwell-test",
        client_email: "push@counterwell-test.iam.gserviceaccount.com",
        private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }),
        private_key_id: "key-1",
        token_uri: `http://127.0.0.1:${address(google)}/token`,
      }),
    ).toString("base64"),
  });
});
afterAll(() => {
  apns?.close();
  google?.close();
});

describe("phone notifications", () => {
  it("signs requests the way Apple and Google expect", async () => {
    const text = { title: "Approval needed", body: "Aarav: Credit ₹35.00" };
    expect(await sendApns("abc123", text, "reviews")).toBe("sent");
    const request = apnsSeen.at(-1)!;
    expect(request.path).toBe("/3/device/abc123");
    expect(request.headers["apns-topic"]).toBe("com.counterwell.mobile");
    expect(request.headers["apns-push-type"]).toBe("alert");
    const jwt = String(request.headers.authorization).replace("bearer ", "");
    expect(decodeProtectedHeader(jwt)).toMatchObject({
      alg: "ES256",
      kid: "APNSKEY123",
    });
    expect(decodeJwt(jwt).iss).toBe("TEAM123456");
    expect(JSON.parse(request.body)).toEqual({
      aps: { alert: text, sound: "default" },
      body: { page: "reviews" },
    });

    expect(await sendFcm("android-token", text, "orders")).toBe("sent");
    const assertion = new URLSearchParams(fcmSeen[0].body).get("assertion")!;
    expect(decodeJwt(assertion)).toMatchObject({
      iss: "push@counterwell-test.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });
    const sent = fcmSeen.at(-1)!;
    expect(sent.auth).toBe("Bearer google-access");
    expect(JSON.parse(sent.body).message).toMatchObject({
      token: "android-token",
      notification: text,
      data: { page: "orders" },
    });
  });

  it("sends each phone its own language and reports tokens that no longer exist", async () => {
    const state = demoState();
    state.devices["owner-iphone"] = {
      ...state.devices["demo-device"],
      id: "owner-iphone",
      userId: "demo-owner",
      pushToken: "stale",
      pushPlatform: "ios",
      pushLanguage: "hi",
    };
    state.devices["owner-android"] = {
      ...state.devices["demo-device"],
      id: "owner-android",
      userId: "demo-owner",
      pushToken: "owner-fcm",
      pushPlatform: "android",
      pushLanguage: "en",
    };
    state.devices["staff-phone"] = {
      ...state.devices["demo-device"],
      id: "staff-phone",
      userId: "demo-employee",
      pushToken: "staff-fcm",
      pushPlatform: "android",
    };
    const notice: Notice = {
      to: ["demo-owner"],
      en: {
        title: "Drawer closed ₹10.00 short",
        body: "Aarav counted ₹1,990.00",
      },
      hi: { title: "दराज़ बंद · ₹10.00 कम", body: "Aarav ने ₹1,990.00 गिने" },
      page: "money",
    };
    const before = { apns: apnsSeen.length, fcm: fcmSeen.length };
    const gone = await deliver(state, [notice]);
    expect(gone).toEqual(["stale"]);
    const iphone = apnsSeen.slice(before.apns);
    expect(iphone).toHaveLength(1);
    expect(JSON.parse(iphone[0].body).aps.alert.title).toBe(
      "दराज़ बंद · ₹10.00 कम",
    );
    const android = fcmSeen
      .slice(before.fcm)
      .filter((x) => x.auth !== "token-request");
    expect(android.map((x) => JSON.parse(x.body).message.token)).toEqual([
      "owner-fcm",
    ]);
  });
});
