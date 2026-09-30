// Phone notifications, sent straight to Apple (APNs) for iPhones and Firebase (FCM) for Android.
// Nothing is sent unless the keys are configured:
//   APNS_KEY (.p8, PEM or base64), APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC (bundle ID),
//   APNS_SANDBOX=1 for development builds; FCM_SERVICE_ACCOUNT (the service-account JSON, raw or
//   base64). A failed notification never affects the action that caused it.
import { connect } from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import type { Notice, State } from "@counterwell/core";

const decode = (value: string, start: string) =>
  value.trim().startsWith(start)
    ? value.trim()
    : Buffer.from(value.trim(), "base64").toString("utf8");
type Text = { title: string; body: string };
export type Outcome = "sent" | "gone" | "failed";

let apnsJwt: { token: string; at: number } | undefined;
async function apnsAuthorisation() {
  // Apple accepts a signed token for up to an hour and refuses one renewed too often.
  if (apnsJwt && Date.now() - apnsJwt.at < 45 * 60_000) return apnsJwt.token;
  const key = await importPKCS8(
    decode(process.env.APNS_KEY!, "-----BEGIN"),
    "ES256",
  );
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APNS_KEY_ID! })
    .setIssuer(process.env.APNS_TEAM_ID!)
    .setIssuedAt()
    .sign(key);
  apnsJwt = { token, at: Date.now() };
  return token;
}
export async function sendApns(
  token: string,
  text: Text,
  page: string,
): Promise<Outcome> {
  const host =
    process.env.APNS_HOST ??
    (process.env.APNS_SANDBOX === "1"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com");
  const authorisation = await apnsAuthorisation();
  const client = connect(host);
  try {
    return await new Promise<Outcome>((resolve) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${authorisation}`,
        "apns-topic": process.env.APNS_TOPIC ?? "com.counterwell.mobile",
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
      let status = 0,
        body = "";
      request.setTimeout(10_000, () => {
        request.close();
        resolve("failed");
      });
      request.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        if (status === 200) return resolve("sent");
        if (status === 410 || /BadDeviceToken|Unregistered/.test(body))
          return resolve("gone");
        console.warn(JSON.stringify({ event: "apns_failed", status, body }));
        resolve("failed");
      });
      request.on("error", () => resolve("failed"));
      request.end(
        // Expo reads a remote notification's own data from "body".
        JSON.stringify({
          aps: { alert: text, sound: "default" },
          body: { page },
        }),
      );
    });
  } finally {
    client.close();
  }
}

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
};
let fcmAccess: { token: string; until: number } | undefined;
const serviceAccount = () =>
  JSON.parse(decode(process.env.FCM_SERVICE_ACCOUNT!, "{")) as ServiceAccount;
async function fcmAuthorisation(account: ServiceAccount) {
  if (fcmAccess && Date.now() < fcmAccess.until) return fcmAccess.token;
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", kid: account.private_key_id })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(tokenUri)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(await importPKCS8(account.private_key, "RS256"));
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !data.access_token)
    throw new Error(`Firebase sign-in failed (${response.status})`);
  fcmAccess = {
    token: data.access_token,
    until: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000,
  };
  return fcmAccess.token;
}
export async function sendFcm(
  token: string,
  text: Text,
  page: string,
): Promise<Outcome> {
  const account = serviceAccount();
  const base = process.env.FCM_BASE_URL ?? "https://fcm.googleapis.com";
  const response = await fetch(
    `${base}/v1/projects/${account.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await fcmAuthorisation(account)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: text,
          data: { page },
          android: {
            priority: "HIGH",
            notification: { channel_id: "default", sound: "default" },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.ok) return "sent";
  const body = await response.text();
  if (response.status === 404 || /UNREGISTERED/.test(body)) return "gone";
  console.warn(
    JSON.stringify({ event: "fcm_failed", status: response.status, body }),
  );
  return "failed";
}

export const pushConfigured = () => ({
  ios: !!(
    process.env.APNS_KEY &&
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID
  ),
  android: !!process.env.FCM_SERVICE_ACCOUNT,
});

/**
 * Sends each notice to every live phone of the people it is for, in that phone's language.
 * Returns the tokens Apple or Google said no longer exist, so they can be forgotten.
 */
export async function deliver(state: State, notices: Notice[]) {
  const configured = pushConfigured();
  const gone: string[] = [];
  const sends: Promise<void>[] = [];
  for (const notice of notices)
    for (const device of Object.values(state.devices)) {
      if (
        device.revoked ||
        !device.pushToken ||
        !notice.to.includes(device.userId) ||
        !(device.pushPlatform === "ios" ? configured.ios : configured.android)
      )
        continue;
      const text = device.pushLanguage === "hi" ? notice.hi : notice.en;
      const token = device.pushToken;
      sends.push(
        (device.pushPlatform === "ios"
          ? sendApns(token, text, notice.page)
          : sendFcm(token, text, notice.page)
        )
          .then((outcome) => {
            if (outcome === "gone") gone.push(token);
          })
          .catch((e) =>
            console.warn(
              JSON.stringify({
                event: "push_error",
                error: (e as Error).message,
              }),
            ),
          ),
      );
    }
  await Promise.all(sends);
  return gone;
}
