import { SignJWT, jwtVerify } from "jose";
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
function key() {
  const secret = process.env.OFFLINE_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "OFFLINE_SIGNING_SECRET must contain at least 32 characters",
    );
  return new TextEncoder().encode(secret);
}
export async function signLease(lease: Lease) {
  return new SignJWT(lease)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("counterwell-api")
    .setAudience("counterwell-offline")
    .sign(key());
}
export async function verifyLease(token: string): Promise<Lease> {
  const { payload } = await jwtVerify(token, key(), {
    issuer: "counterwell-api",
    audience: "counterwell-offline",
    algorithms: ["HS256"],
  });
  const p = payload as unknown as Lease;
  if (!p.deviceId || !p.userId || !p.businessId || !p.issuedAt || !p.expiresAt)
    throw new Error("Malformed lease");
  return p;
}
