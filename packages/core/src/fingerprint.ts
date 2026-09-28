/** 53-bit string hash (cyrb53); only used to recognise a retried command, not for security. */
function cyrb53(text: string, seed: number) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const LIMIT = 4000;
/**
 * Stored with each command receipt and loaded on every transaction, so large
 * commands (catalogue imports, supplier invoices) keep a hash instead of their
 * whole body.
 */
export function commandFingerprint(json: string) {
  return json.length <= LIMIT
    ? json
    : `h:${json.length}:${cyrb53(json, 1)}${cyrb53(json, 2)}`;
}
/** Receipts written before hashing hold the full JSON; accept either form. */
export const sameFingerprint = (stored: string, json: string) =>
  stored === json || stored === commandFingerprint(json);
