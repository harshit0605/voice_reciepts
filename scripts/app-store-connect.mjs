// The App Store Connect API, signed with the key described in the git-ignored .data/apple/asc.json
// ({ keyId, issuerId, keyPath, teamId, bundleId, appAppleId, ... }).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SignJWT, importPKCS8 } from "jose";

export const ascFile = path.resolve(
  import.meta.dirname,
  "../.data/apple/asc.json",
);
export const asc = JSON.parse(readFileSync(ascFile, "utf8"));
export const saveAsc = () =>
  writeFileSync(ascFile, JSON.stringify(asc, null, 2), { mode: 0o600 });

export async function api(method, route, body) {
  const token = await new SignJWT({ aud: "appstoreconnect-v1" })
    .setProtectedHeader({ alg: "ES256", kid: asc.keyId, typ: "JWT" })
    .setIssuer(asc.issuerId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(await importPKCS8(readFileSync(asc.keyPath, "utf8"), "ES256"));
  const response = await fetch(
    `https://api.appstoreconnect.apple.com/v1${route}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new Error(
      `${method} ${route}: ${response.status} ${JSON.stringify(data.errors ?? data)}`,
    );
  return data;
}
