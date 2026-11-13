// Builds the iPhone app for a shop server and uploads it to TestFlight.
//
//   node scripts/build-ios-release.mjs --api https://shop.example.in [--check | --device]
//
// --device installs the release build on the iPhone connected by cable (Developer Mode on) instead
// of uploading, signed for development after scripts/make-ios-dev-signing.mjs. Notifications reach
// such installs only from a server sending to Apple's development service; TestFlight builds use
// the production one.
// Uploading needs an App Store Connect API key (Users and Access → Integrations → App Store
// Connect API, role Admin) described in .data/apple/asc.json (git-ignored):
//   { "keyId": "ABC123DEFG", "issuerId": "…-…", "teamId": "XYZ987", "keyPath": "~/.appstoreconnect/private_keys/AuthKey_ABC123DEFG.p8", "bundleId": "com.counterwell.mobile", "appAppleId": "…" }
// the app created once in App Store Connect with that bundle ID, and the signing made once by
// scripts/make-ios-signing.mjs. With --check, or without that file, it only proves the release
// build compiles for iPhones.
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
const device = process.argv.includes("--device");
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
// Every upload needs a new build number; the time of the build always increases.
const build = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const env = {
  ...process.env,
  // Read by app.config.js, so the app can show which build it is (More → Device and synchronisation).
  COUNTERWELL_BUILD_NUMBER: build,
  // Development-signed installs must declare Apple's development notification service.
  ...(device ? { COUNTERWELL_APNS: "development" } : {}),
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
execFileSync("/usr/libexec/PlistBuddy", [
  "-c",
  `Set :CFBundleVersion ${build}`,
  path.join(mobile, "ios/Counterwell/Info.plist"),
]);

// Distribution signing set up by scripts/make-ios-signing.mjs: a distribution certificate in a
// project-only keychain and an App Store profile. Only the app target's Release build is switched
// to it; the pods are not signed and development builds are untouched.
const signing = device ? asc?.development : asc?.signing;
if (asc && !signing) {
  console.error(
    `Run node scripts/${device ? "make-ios-dev-signing" : "make-ios-signing"}.mjs first.`,
  );
  process.exit(1);
}
if (device && !asc) {
  console.error("--device needs .data/apple/asc.json and development signing.");
  process.exit(1);
}
// One project-only keychain holds both identities (made by make-ios-signing.mjs).
const keychain = asc?.signing?.keychain,
  keychainPassword = asc?.signing?.keychainPassword;
let searchList = [];
if (signing) {
  const project = path.join(
    mobile,
    "ios/Counterwell.xcodeproj/project.pbxproj",
  );
  const settings = {
    CODE_SIGN_STYLE: "Manual",
    CODE_SIGN_IDENTITY: device ? '"Apple Development"' : '"Apple Distribution"',
    DEVELOPMENT_TEAM: asc.teamId,
    PROVISIONING_PROFILE_SPECIFIER: `"${signing.profileName}"`,
  };
  let patched = 0;
  const text = readFileSync(project, "utf8").replace(
    /(\/\* Release \*\/ = \{\s*isa = XCBuildConfiguration;[\s\S]*?buildSettings = \{)([\s\S]*?)(\n\t\t\t\};\s*name = Release;)/g,
    (block, head, body, tail) => {
      if (!body.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${asc.bundleId};`))
        return block;
      patched++;
      let lines = body
        .split("\n")
        .filter(
          (line) =>
            !Object.keys(settings).some(
              (key) =>
                line.trim().startsWith(`${key} =`) ||
                line.trim().startsWith(`"${key}[`),
            ),
        );
      lines.push(
        ...Object.entries(settings).map(
          ([key, value]) => `\t\t\t\t${key} = ${value};`,
        ),
      );
      return head + lines.join("\n") + tail;
    },
  );
  if (patched !== 1)
    throw new Error(`Expected one app Release configuration, found ${patched}`);
  writeFileSync(project, text);
  // Codesign finds the intermediate only in keychains on the search list: add ours for the build.
  searchList = execFileSync("security", ["list-keychains", "-d", "user"], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((k) => k && k !== keychain);
  execFileSync("security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    ...searchList,
    keychain,
  ]);
  execFileSync("security", [
    "unlock-keychain",
    "-p",
    keychainPassword,
    keychain,
  ]);
  process.on("exit", () =>
    execFileSync("security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      ...searchList,
    ]),
  );
}

if (device) {
  // The first iPhone connected by cable, unless --udid names one.
  let udid = argument("udid");
  if (!udid) {
    const listing = path.join(out, "devices.json");
    mkdirSync(out, { recursive: true });
    execFileSync(
      "xcrun",
      ["devicectl", "list", "devices", "--json-output", listing],
      {
        stdio: "ignore",
      },
    );
    udid = JSON.parse(readFileSync(listing, "utf8")).result.devices.find(
      (d) =>
        d.hardwareProperties?.platform === "iOS" &&
        d.hardwareProperties?.reality === "physical" &&
        d.connectionProperties?.tunnelState === "connected",
    )?.hardwareProperties.udid;
    if (!udid) {
      console.error(
        "No iPhone is connected: plug it in by cable and unlock it.",
      );
      process.exit(1);
    }
  }
  const derived = path.join(root, ".data/ios-device");
  run("xcodebuild", [
    "-workspace",
    "ios/Counterwell.xcworkspace",
    "-scheme",
    "Counterwell",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-derivedDataPath",
    derived,
    `OTHER_CODE_SIGN_FLAGS=--keychain ${keychain}`,
    "build",
  ]);
  const app = path.join(
    derived,
    "Build/Products/Release-iphoneos/Counterwell.app",
  );
  run("xcrun", [
    "devicectl",
    "device",
    "install",
    "app",
    "--device",
    udid,
    app,
  ]);
  run("xcrun", [
    "devicectl",
    "device",
    "process",
    "launch",
    "--terminate-existing",
    "--device",
    udid,
    asc.bundleId,
  ]);
  console.log(`\nInstalled and opened build ${build} on the iPhone (${udid}).`);
  process.exit(0);
}

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
  ...(signing
    ? [`OTHER_CODE_SIGN_FLAGS=--keychain ${keychain}`]
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
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict>
    <key>${asc.bundleId}</key><string>${signing.profileName}</string>
  </dict>
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
