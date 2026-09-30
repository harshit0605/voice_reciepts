// One-time iPhone signing setup for TestFlight builds, without registering a device.
//
//   node scripts/make-ios-signing.mjs
//
// Uses the App Store Connect API key described in .data/apple/asc.json to create an Apple
// Distribution certificate (private key made here) and an App Store provisioning profile for the
// app's bundle ID. The certificate lives in a project-only keychain, .data/apple/signing.keychain-db,
// never in the login keychain. Everything is written under the git-ignored .data/apple. Safe to run
// again: it reuses what exists and only renews the profile.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { api, asc, ascFile, saveAsc } from "./app-store-connect.mjs";

const dir = path.dirname(ascFile);
const run = (file, args, options = {}) =>
  execFileSync(file, args, { encoding: "utf8", ...options });

// 1. Distribution certificate, with its private key made here.
const keyFile = path.join(dir, "distribution.key");
const certFile = path.join(dir, "distribution.cer");
const signing = asc.signing ?? {};
if (!existsSync(certFile)) {
  run("openssl", ["genrsa", "-out", keyFile, "2048"], { stdio: "ignore" });
  const csr = run("openssl", [
    "req",
    "-new",
    "-key",
    keyFile,
    "-subj",
    `/CN=Counterwell Distribution/C=IN`,
  ]);
  const created = await api("POST", "/certificates", {
    data: {
      type: "certificates",
      attributes: {
        certificateType: "DISTRIBUTION",
        csrContent: csr.replace(/-----[^-]+-----|\s/g, ""),
      },
    },
  });
  writeFileSync(
    certFile,
    Buffer.from(created.data.attributes.certificateContent, "base64"),
  );
  signing.certificateId = created.data.id;
  console.log(`Created distribution certificate ${created.data.id}`);
}
const issuer = run("openssl", [
  "x509",
  "-inform",
  "DER",
  "-in",
  certFile,
  "-noout",
  "-issuer",
]);
const generation = /OU\s*=\s*(G\d)/.exec(issuer)?.[1] ?? "G3";

// 2. The Apple intermediate that issued it, checked against Apple's root from the system store.
const intermediate = path.join(dir, `AppleWWDRCA${generation}.cer`);
if (!existsSync(intermediate)) {
  const response = await fetch(
    `https://www.apple.com/certificateauthority/AppleWWDRCA${generation}.cer`,
  );
  if (!response.ok)
    throw new Error(`Could not fetch the ${generation} intermediate`);
  writeFileSync(intermediate, Buffer.from(await response.arrayBuffer()));
}
const rootPem = path.join(dir, "AppleRootCA.pem");
writeFileSync(
  rootPem,
  run("security", [
    "find-certificate",
    "-a",
    "-c",
    "Apple Root CA",
    "-p",
    "/System/Library/Keychains/SystemRootCertificates.keychain",
  ]),
);
const intermediatePem = path.join(dir, `AppleWWDRCA${generation}.pem`);
run("openssl", [
  "x509",
  "-inform",
  "DER",
  "-in",
  intermediate,
  "-out",
  intermediatePem,
]);
const certPem = path.join(dir, "distribution.pem");
run("openssl", ["x509", "-inform", "DER", "-in", certFile, "-out", certPem]);
run("openssl", ["verify", "-CAfile", rootPem, intermediatePem]);
// Apple signing certificates carry an Apple-specific critical extension OpenSSL does not know.
run("openssl", [
  "verify",
  "-ignore_critical",
  "-CAfile",
  rootPem,
  "-untrusted",
  intermediatePem,
  certPem,
]);

// 3. Project-only keychain holding the identity; codesign may use it without a prompt.
const keychain = path.join(dir, "signing.keychain-db");
signing.keychain = keychain;
signing.keychainPassword ??= randomBytes(18).toString("base64url");
// Saved before anything else can fail, so the keychain can always be opened again.
asc.signing = signing;
saveAsc();
if (!existsSync(keychain)) {
  run("security", [
    "create-keychain",
    "-p",
    signing.keychainPassword,
    keychain,
  ]);
  run("security", ["set-keychain-settings", keychain]); // no automatic lock
  const p12 = path.join(dir, "distribution.p12");
  const p12Password = randomBytes(12).toString("base64url");
  run("openssl", [
    "pkcs12",
    "-export",
    "-legacy",
    "-inkey",
    keyFile,
    "-in",
    certPem,
    "-out",
    p12,
    "-passout",
    `pass:${p12Password}`,
  ]);
  run("security", [
    "unlock-keychain",
    "-p",
    signing.keychainPassword,
    keychain,
  ]);
  run("security", [
    "import",
    p12,
    "-k",
    keychain,
    "-P",
    p12Password,
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/security",
  ]);
  run("security", ["import", intermediate, "-k", keychain]);
  run(
    "security",
    [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      signing.keychainPassword,
      keychain,
    ],
    { stdio: "ignore" },
  );
}
run("security", ["unlock-keychain", "-p", signing.keychainPassword, keychain]);
// Xcode and codesign only find the intermediate in keychains on the search list, so the keychain
// is added there for the check (and by the build script for a build), then the list is restored.
const searchList = run("security", ["list-keychains", "-d", "user"])
  .split("\n")
  .map((line) => line.trim().replace(/^"|"$/g, ""))
  .filter(Boolean);
run("security", [
  "list-keychains",
  "-d",
  "user",
  "-s",
  ...searchList.filter((k) => k !== keychain),
  keychain,
]);
let identities;
try {
  identities = run("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychain,
  ]);
} finally {
  run("security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    ...searchList.filter((k) => k !== keychain),
  ]);
}
const identity = /"(Apple Distribution: [^"]+)"/.exec(identities)?.[1];
if (!identity)
  throw new Error(
    `No valid distribution identity in the keychain:\n${identities}`,
  );
signing.identity = identity;

// 4. App Store provisioning profile for the bundle ID with this certificate.
const bundle = await api(
  "GET",
  `/bundleIds?filter[identifier]=${encodeURIComponent(asc.bundleId)}`,
);
const bundleId = bundle.data.find(
  (b) => b.attributes.identifier === asc.bundleId,
)?.id;
if (!bundleId) throw new Error(`${asc.bundleId} is not registered`);
signing.certificateId ??= (
  await api("GET", "/certificates?filter[certificateType]=DISTRIBUTION")
).data.find((c) =>
  Buffer.from(c.attributes.certificateContent, "base64").equals(
    readFileSync(certFile),
  ),
)?.id;
const profileName = `Counterwell App Store ${new Date().toISOString().slice(0, 10)}`;
const existing = await api(
  "GET",
  `/profiles?filter[name]=${encodeURIComponent(profileName)}`,
);
for (const old of existing.data) await api("DELETE", `/profiles/${old.id}`);
const profile = await api("POST", "/profiles", {
  data: {
    type: "profiles",
    attributes: { name: profileName, profileType: "IOS_APP_STORE" },
    relationships: {
      bundleId: { data: { type: "bundleIds", id: bundleId } },
      certificates: {
        data: [{ type: "certificates", id: signing.certificateId }],
      },
    },
  },
});
const content = Buffer.from(profile.data.attributes.profileContent, "base64");
const uuid = profile.data.attributes.uuid;
writeFileSync(path.join(dir, "appstore.mobileprovision"), content);
for (const folder of [
  path.join(homedir(), "Library/MobileDevice/Provisioning Profiles"),
  path.join(
    homedir(),
    "Library/Developer/Xcode/UserData/Provisioning Profiles",
  ),
]) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, `${uuid}.mobileprovision`), content);
}
signing.profileName = profileName;
signing.profileUuid = uuid;
asc.signing = signing;
saveAsc();
console.log(
  `Signing ready: ${identity}, profile "${profileName}" (${uuid}), intermediate ${generation}.`,
);
