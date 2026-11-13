// Copies the newest encrypted database backup from the server, for a manual off-server copy.
//   node scripts/pull-backup.mjs --api https://<server> --token-file <file> [--out <folder>]
// --token-file holds the GATEWAY_TOKEN (the same one the shop PC uses); it is read from the file
// and never printed. The backup stays encrypted, so the copy is safe on any disk; opening it needs
// the private key (scripts/restore-check.mjs). The default folder is ~/counterwell-backups.
import { createHash } from "node:crypto";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const api = arg("--api")?.replace(/\/$/, "");
const tokenFile = arg("--token-file");
const out = arg("--out") ?? path.join(homedir(), "counterwell-backups");
if (!api || !tokenFile) {
  console.error(
    "Usage: node scripts/pull-backup.mjs --api https://<server> --token-file <file> [--out <folder>]",
  );
  process.exit(1);
}
if (
  !api.startsWith("https://") &&
  !/^http:\/\/(localhost|127\.0\.0\.1)[:/]?/.test(api)
) {
  console.error(
    "The server address must be https:// (http is only for local testing).",
  );
  process.exit(1);
}
const token = readFileSync(tokenFile, "utf8").trim();
const headers = { "X-Gateway-Token": token };

const list = await fetch(`${api}/api/v1/gateway/backups`, {
  headers,
  signal: AbortSignal.timeout(30_000),
});
if (!list.ok) {
  console.error(`The server refused the backup list (HTTP ${list.status}).`);
  process.exit(1);
}
const { backups } = await list.json();
const newest = backups[0];
if (!newest) {
  console.error("The server has no encrypted backups yet.");
  process.exit(1);
}
mkdirSync(out, { recursive: true, mode: 0o700 });
const final = path.join(out, newest.name);
if (existsSync(final)) {
  console.log(`Already have ${final}`);
  process.exit(0);
}
const response = await fetch(`${api}/api/v1/gateway/backups/${newest.name}`, {
  headers,
  signal: AbortSignal.timeout(10 * 60_000),
});
if (!response.ok || !response.body) {
  console.error(`Download failed (HTTP ${response.status}).`);
  process.exit(1);
}
// Written beside its final name and renamed only once size and checksum match.
const part = final + ".part";
const hash = createHash("sha256");
let size = 0;
try {
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk);
        size += chunk.length;
        done(null, chunk);
      },
    }),
    createWriteStream(part, { mode: 0o600 }),
  );
  if (size !== newest.size || hash.digest("hex") !== newest.sha256)
    throw new Error("size or checksum does not match what the server listed");
  renameSync(part, final);
} catch (e) {
  rmSync(part, { force: true });
  console.error(`Download failed: ${e.message}`);
  process.exit(1);
}
console.log(`Saved ${final} (${size} bytes, checksum verified)`);
