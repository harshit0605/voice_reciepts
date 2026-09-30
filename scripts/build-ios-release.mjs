// Builds the iPhone app for a shop server and uploads it to TestFlight.
//
//   node scripts/build-ios-release.mjs --api https://shop.example.in [--check]
//
// Uploading needs an App Store Connect API key (Users and Access → Integrations → App Store
// Connect API, role App Manager) described in .data/apple/asc.json (git-ignored):
//   { "keyId": "ABC123DEFG", "issuerId": "…-…", "teamId": "XYZ987", "keyPath": "~/.appstoreconnect/private_keys/AuthKey_ABC123DEFG.p8" }
// and the app created once in App Store Connect with bundle ID com.counterwell.mobile.
// With --check, or without that file, it only proves the release build compiles for iPhones.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mobile = path.join(root, "apps/mobile");
const out = path.join(root, ".data/ios-release");
const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const api = argument("api") ?? process.env.EXPO_PUBLIC_API_URL;
if (!api || !/^https:\/\/[^\s/]+/.test(api)) {
  console.error(
    "Give the shop server's HTTPS address: --api https://shop.example.in",
  );
  process.exit(1);
}
const credentialsFile = path.join(root, ".data/apple/asc.json");
const upload = !process.argv.includes("--check") && existsSync(credentialsFile);
const asc = upload ? JSON.parse(readFileSync(credentialsFile, "utf8")) : null;
const keyPath = asc?.keyPath?.replace(/^~(?=\/)/, homedir());
if (
  asc &&
  (!asc.keyId || !asc.issuerId || !asc.teamId || !existsSync(keyPath))
) {
  console.error(
    `${credentialsFile} needs keyId, issuerId, teamId and a keyPath that exists.`,
  );
  process.exit(1);
}
const auth = asc
  ? [
      "-allowProvisioningUpdates",
      "-authenticationKeyPath",
      keyPath,
      "-authenticationKeyID",
      asc.keyId,
      "-authenticationKeyIssuerID",
      asc.issuerId,
    ]
  : [];
const env = {
  ...process.env,
  // CocoaPods fails under a non-UTF-8 locale ("Unicode Normalization not appropriate for ASCII-8BIT").
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  NODE_ENV: "production",
  EXPO_PUBLIC_API_URL: api.replace(/\/$/, ""),
};
const run = (file, args, cwd = mobile) =>
  execFileSync(file, args, { cwd, env, stdio: "inherit" });

console.log(`Building the iPhone app for ${env.EXPO_PUBLIC_API_URL} …`);
run("npx", ["expo", "prebuild", "--platform", "ios", "--no-install"]);
run("pod", ["install"], path.join(mobile, "ios"));
// Every upload needs a new build number; the time of the build always increases.
const build = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
execFileSync("/usr/libexec/PlistBuddy", [
  "-c",
  `Set :CFBundleVersion ${build}`,
  path.join(mobile, "ios/Counterwell/Info.plist"),
]);

mkdirSync(out, { recursive: true });
const archive = path.join(out, `Counterwell-${build}.xcarchive`);
run("xcodebuild", [
  "-workspace",
  "ios/Counterwell.xcworkspace",
  "-scheme",
  "Counterwell",
  "-configuration",
  "Release",
  "-destination",
  "generic/platform=iOS",
  "-archivePath",
  archive,
  ...auth,
  ...(asc
    ? [`DEVELOPMENT_TEAM=${asc.teamId}`, "CODE_SIGN_STYLE=Automatic"]
    : ["CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO"]),
  "archive",
]);
if (!asc) {
  console.log(
    `\nThe release build compiles for iPhones (build ${build}). Nothing was signed or uploaded.`,
  );
  process.exit(0);
}

const options = path.join(out, "ExportOptions.plist");
writeFileSync(
  options,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${asc.teamId}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
`,
);
const exported = path.join(out, `export-${build}`);
rmSync(exported, { recursive: true, force: true });
run("xcodebuild", [
  "-exportArchive",
  "-archivePath",
  archive,
  "-exportOptionsPlist",
  options,
  "-exportPath",
  exported,
  ...auth,
]);
console.log(
  `\nUploaded build ${build} to App Store Connect. It appears in TestFlight after Apple processes it (usually 10 to 30 minutes).`,
);
