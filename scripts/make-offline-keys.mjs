// Makes the key pair that signs each phone's 24-hour offline permission.
//   OFFLINE_SIGNING_KEY  private: on the server only
//   OFFLINE_VERIFY_KEY   public: on the shop gateway, which can check permissions but not make them
// Both are PEM encoded as base64, one line each.
//   node scripts/make-offline-keys.mjs                 prints both lines for a .env file
//   node scripts/make-offline-keys.mjs --into s.json   adds them to a JSON settings file instead
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const line = (pem) => Buffer.from(pem).toString("base64");
const keys = {
  OFFLINE_SIGNING_KEY: line(
    privateKey.export({ type: "pkcs8", format: "pem" }),
  ),
  OFFLINE_VERIFY_KEY: line(publicKey.export({ type: "spki", format: "pem" })),
};
const into = process.argv.indexOf("--into");
if (into > 0) {
  const file = process.argv[into + 1];
  const current = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  if (current.OFFLINE_SIGNING_KEY) {
    console.error(`${file} already has a signing key; not replacing it.`);
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify({ ...current, ...keys }, null, 2), {
    mode: 0o600,
  });
  console.log(`Added OFFLINE_SIGNING_KEY and OFFLINE_VERIFY_KEY to ${file}`);
} else
  for (const [name, value] of Object.entries(keys))
    console.log(`${name}=${value}`);
