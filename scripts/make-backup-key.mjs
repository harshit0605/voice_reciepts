// Makes the key pair for the encrypted database backups (age, https://age-encryption.org).
//   node scripts/make-backup-key.mjs <private-key-file>
// The private key is saved to that file (mode 600; an existing file is never replaced) and stays
// with the owner: only it can open the backups. Only the public key is printed. Put the public key
// in the server's BACKUP_AGE_RECIPIENT setting. The file is in age's standard format, so the age
// command line tool can use it too (age --decrypt -i <file> backup.sql.gz.age).
import { generateIdentity, identityToRecipient } from "age-encryption";
import { writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/make-backup-key.mjs <private-key-file>");
  process.exit(1);
}
const identity = await generateIdentity();
const recipient = await identityToRecipient(identity);
try {
  // "wx": fail rather than overwrite a key that may be the only way to open old backups.
  writeFileSync(
    file,
    `# created: ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`,
    { flag: "wx", mode: 0o600 },
  );
} catch (e) {
  console.error(
    e.code === "EEXIST"
      ? `${file} already exists; not replacing it.`
      : `Could not write ${file}: ${e.message}`,
  );
  process.exit(1);
}
console.log(
  `Private key saved to ${file} (keep it safe, and keep a second copy).`,
);
console.log(`BACKUP_AGE_RECIPIENT=${recipient}`);
