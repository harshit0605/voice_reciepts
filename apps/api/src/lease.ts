import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
export type Lease = {
  businessId: string;
  userId: string;
  deviceId: string;
  series: string;
  counterId: string;
  role?: "owner" | "employee";
  issuedAt: string;
  expiresAt: string;
};
/**
 * The 24-hour offline permission on each phone is signed by the server with an Ed25519 private
 * key (OFFLINE_SIGNING_KEY). The shop gateway checks it with the public key alone
 * (OFFLINE_VERIFY_KEY), so the PC in the shop, which staff can reach, cannot mint permissions and
 * post sales in someone else's name. Local development without a key pair uses a shared secret
 * (OFFLINE_SIGNING_SECRET). Only one algorithm is ever accepted.
 * Keys are PEM, or PEM encoded as base64 to fit on one line.
 */
const pem = (value: string) =>
  value.trim().startsWith("-----BEGIN")
    ? value.trim()
    : Buffer.from(value.trim(), "base64").toString("utf8");
function sharedSecret() {
  const secret = process.env.OFFLINE_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "Set OFFLINE_SIGNING_KEY (or, for local development, a 32-character OFFLINE_SIGNING_SECRET)",
    );
  return new TextEncoder().encode(secret);
}
async function signingKey(): Promise<{
  alg: string;
  key: CryptoKey | KeyObject | Uint8Array;
}> {
  const privateKey = process.env.OFFLINE_SIGNING_KEY;
  if (privateKey)
    return { alg: "EdDSA", key: await importPKCS8(pem(privateKey), "EdDSA") };
  return { alg: "HS256", key: sharedSecret() };
}
async function verifyingKey(): Promise<{
  alg: string;
  key: CryptoKey | KeyObject | Uint8Array;
}> {
  const publicKey = process.env.OFFLINE_VERIFY_KEY;
  if (publicKey)
    return { alg: "EdDSA", key: await importSPKI(pem(publicKey), "EdDSA") };
  const privateKey = process.env.OFFLINE_SIGNING_KEY;
  if (privateKey)
    return {
      alg: "EdDSA",
      key: createPublicKey(createPrivateKey(pem(privateKey))),
    };
  return { alg: "HS256", key: sharedSecret() };
}
export async function signLease(lease: Lease) {
  const { alg, key } = await signingKey();
  return new SignJWT(lease)
    .setProtectedHeader({ alg })
    .setIssuer("counterwell-api")
    .setAudience("counterwell-offline")
    .sign(key);
}
export async function verifyLease(token: string): Promise<Lease> {
  const { alg, key } = await verifyingKey();
  const { payload } = await jwtVerify(token, key, {
    issuer: "counterwell-api",
    audience: "counterwell-offline",
    algorithms: [alg],
  });
  const p = payload as unknown as Lease;
  if (!p.deviceId || !p.userId || !p.businessId || !p.issuedAt || !p.expiresAt)
    throw new Error("Malformed lease");
  return p;
}
