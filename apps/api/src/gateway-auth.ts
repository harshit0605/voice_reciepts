import { timingSafeEqual } from "node:crypto";

/**
 * The shop gateway proves itself with the shared GATEWAY_TOKEN in the X-Gateway-Token header.
 * Every gateway-to-API call checks it here, in constant time, and a short or missing server
 * token never matches anything.
 */
export function gatewayAuthorised(supplied: string | undefined) {
  const expected = process.env.GATEWAY_TOKEN;
  if (!expected || expected.length < 32 || supplied?.length !== expected.length)
    return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
