// Installs or updates the shop gateway on the shop PC over SSH (Tailscale), from this Mac.
//
//   node scripts/windows/install-gateway.mjs --host cwsupport@counterwell-shop [printer] [--paper 58] [--test-print] [--ref main]
//
// The receipt printer, one of:
//   --usb-printer [name]       a printer installed in Windows, usually USB; without a name, the one
//                              USB printer Windows has
//   --raw-printer 192.168.1.60 a network receipt printer taking raw ESC/POS on port 9100
//   --printer 192.168.1.50     an Epson printer with ePOS-Print
// --paper is the roll width in mm, 80 (default) or 58. --test-print prints a sample receipt.
//
// The PC must have run the shop PC setup (Tailscale, SSH, Git, Node.js). Settings come from
// .data/production/secrets.json. The PC receives the public key that checks phones' offline
// permissions, never the private key that makes them, so nobody at the shop can mint them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const host = argument("host");
if (!host) {
  console.error("Give the shop PC: --host cwsupport@counterwell-shop");
  process.exit(1);
}
const secrets = JSON.parse(
  readFileSync(path.join(root, ".data/production/secrets.json"), "utf8"),
);
for (const name of [
  "DOMAIN",
  "BUSINESS_ID",
  "GATEWAY_TOKEN",
  "OFFLINE_VERIFY_KEY",
])
  if (!secrets[name]) throw new Error(`${name} is missing from secrets.json`);
const flag = (name) => process.argv.includes(`--${name}`);
const address = (name) => {
  const value = argument(name) ?? "";
  if (value && !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(value))
    throw new Error(`--${name} is an address such as 192.168.1.50`);
  return value;
};
const printer = address("printer"),
  rawPrinter = address("raw-printer");
const usbName = argument("usb-printer");
const usbPrinter = flag("usb-printer")
  ? !usbName || usbName.startsWith("--")
    ? "auto"
    : usbName
  : "";
if ([printer, rawPrinter, usbPrinter].filter(Boolean).length > 1)
  throw new Error(
    "Give one printer: --usb-printer, --raw-printer or --printer",
  );
const paper = argument("paper") ?? "80";
if (!["58", "80"].includes(paper)) throw new Error("--paper is 58 or 80 (mm)");

const settings = {
  CW_API_URL: `https://${secrets.DOMAIN}`,
  CW_BUSINESS_ID: secrets.BUSINESS_ID,
  CW_GATEWAY_TOKEN: secrets.GATEWAY_TOKEN,
  CW_VERIFY_KEY: secrets.OFFLINE_VERIFY_KEY,
  CW_PRINTER_HOST: printer,
  CW_PRINTER_RAW: rawPrinter,
  CW_PRINTER_NAME: usbPrinter,
  CW_PRINTER_WIDTH: paper,
  CW_TEST_PRINT: flag("test-print") ? "1" : "",
  CW_REPO_REF: argument("ref") ?? "main",
};
const work = mkdtempSync(path.join(tmpdir(), "cw-gateway-"));
try {
  const settingsFile = path.join(work, "gateway-settings.json");
  writeFileSync(settingsFile, JSON.stringify(settings), { mode: 0o600 });
  const remote = "C:/ProgramData/Counterwell";
  const ssh = (command) =>
    execFileSync("ssh", ["-o", "BatchMode=yes", host, command], {
      stdio: "inherit",
    });
  ssh(
    `powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path '${remote}' | Out-Null"`,
  );
  execFileSync(
    "scp",
    [
      "-o",
      "BatchMode=yes",
      path.join(root, "scripts/windows/install-gateway.ps1"),
      settingsFile,
      `${host}:${remote}/`,
    ],
    { stdio: "inherit" },
  );
  ssh(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${remote}/install-gateway.ps1" -SettingsFile "${remote}/gateway-settings.json"`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
