// Builds the shop PC setup that an employee runs on the shop's Windows computer.
//   node scripts/windows/build-shop-pc-setup.mjs [--ssh-key ~/.ssh/id_ed25519.pub] [--hostname counterwell-shop] [--out dir]
// The Tailscale auth key is read from .data/shop-pc/tailscale-authkey.txt (or CW_TAILSCALE_AUTHKEY).
// Output goes to .data/shop-pc/, which git ignores, because it contains the auth key:
//   counterwell-shop-setup.cmd         one file to double-click on the shop PC
//   paste-into-admin-powershell.txt    the same setup as one line, for when the file is blocked
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const privateDir = path.join(root, ".data/shop-pc");
const script = "scripts/windows/shop-pc-setup.ps1";
const repository = "harshit0605/voice_reciepts";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const expand = (p) => p.replace(/^~(?=\/)/, homedir());
const git = (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const outDir = path.resolve(expand(option("out", privateDir)));
// The output holds the auth key: never let it land somewhere git would publish.
if (!path.relative(root, outDir).startsWith("..")) {
  try {
    git("check-ignore", "-q", path.join(outDir, "counterwell-shop-setup.cmd"));
  } catch {
    throw new Error(
      `${outDir} is not ignored by git; keep the setup under .data/.`,
    );
  }
}

const authKey = (
  process.env.CW_TAILSCALE_AUTHKEY ??
  readFileSync(path.join(privateDir, "tailscale-authkey.txt"), "utf8")
).trim();
if (!/^tskey-auth-[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(authKey))
  throw new Error("The Tailscale auth key does not look like tskey-auth-...");
const publicKey = readFileSync(
  expand(option("ssh-key", "~/.ssh/id_ed25519.pub")),
  "utf8",
).trim();
if (
  !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+( .*)?$/.test(
    publicKey,
  )
)
  throw new Error("That is not an SSH public key (.pub file).");
const hostname = option("hostname", "counterwell-shop");
if (!/^[a-z0-9-]{1,63}$/.test(hostname))
  throw new Error("Use lowercase letters, digits and hyphens for --hostname.");

const body = readFileSync(path.join(root, script), "utf8");
for (const [text, name] of [
  [body, script],
  [publicKey, "SSH key"],
])
  if (/[^\x00-\x7f]/.test(text))
    // Windows PowerShell 5.1 reads BOM-less files in the local code page.
    throw new Error(`${name} must be plain ASCII.`);
const quote = (value) => `'${value.replace(/'/g, "''")}'`;

// A batch file whose first line is also the start of a PowerShell comment: cmd runs the batch
// part (ask for administrator rights, then hand the whole file to PowerShell), and PowerShell
// skips the batch part and runs the rest.
const launcher = [
  "<# : Counterwell shop PC setup. Double-click this file and choose Yes when Windows asks.",
  "@echo off",
  "setlocal",
  'set "CW_SELF=%~f0"',
  "net session >nul 2>&1",
  "if errorlevel 1 (",
  "  echo Asking Windows for administrator permission...",
  '  powershell -NoProfile -Command "Start-Process -FilePath $env:CW_SELF -Verb RunAs"',
  "  exit /b",
  ")",
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText($env:CW_SELF))"',
  "echo.",
  "pause",
  "exit /b",
  "#>",
  "$Settings = @{",
  `  TailscaleAuthKey = ${quote(authKey)}`,
  `  SshPublicKey = ${quote(publicKey)}`,
  `  Hostname = ${quote(hostname)}`,
  "}",
  "",
].join("\r\n");
mkdirSync(outDir, { recursive: true });
const cmdFile = path.join(outDir, "counterwell-shop-setup.cmd");
writeFileSync(cmdFile, launcher + body.replace(/\r?\n/g, "\r\n"));

// The one-line version downloads the script from GitHub at a fixed commit, so what runs is
// exactly what was reviewed here.
const commit = git("log", "-1", "--format=%H", "--", script);
let published = false;
try {
  published =
    !!commit &&
    git("branch", "-r", "--contains", commit).includes("origin/main");
} catch {
  published = false;
}
const oneLine = [
  "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'",
  `$env:CW_TAILSCALE_AUTHKEY = ${quote(authKey)}`,
  `$env:CW_SSH_PUBLIC_KEY = ${quote(publicKey)}`,
  `$env:CW_HOSTNAME = ${quote(hostname)}`,
  `irm https://raw.githubusercontent.com/${repository}/${commit}/${script} | iex`,
].join("; ");
writeFileSync(
  path.join(outDir, "paste-into-admin-powershell.txt"),
  [
    "Open Start, type PowerShell, right-click Windows PowerShell, choose Run as administrator,",
    "then paste this whole line and press Enter:",
    "",
    oneLine,
    "",
  ].join("\r\n"),
);
console.log(
  `Wrote ${path.relative(root, cmdFile)} and paste-into-admin-powershell.txt`,
);
console.log(
  `SSH key: ${publicKey.split(" ").slice(0, 1).join(" ")} … ${publicKey.split(" ")[2] ?? ""}`,
);
if (!published)
  console.warn(
    `${script} is not committed and pushed to origin/main yet: the one-line version will not work until it is.`,
  );
