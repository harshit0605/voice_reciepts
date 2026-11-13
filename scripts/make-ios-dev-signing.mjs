// One-time setup for installing test builds straight onto iPhones connected by cable.
//
//   node scripts/make-ios-dev-signing.mjs
//
// Registers each connected iPhone (Developer Mode on) with the Apple developer team, creates an
// Apple Development certificate whose private key is made here and kept in the project keychain
// from make-ios-signing.mjs, and a development profile for the app that covers the team's
// iPhones. Run it again after connecting another iPhone; the profile is remade to include it.
// Then: node scripts/build-ios-release.mjs --api https://… --device
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { api, asc, ascFile, saveAsc } from "./app-store-connect.mjs";

const dir = path.dirname(ascFile);
const run = (file, args, options = {}) =>
  execFileSync(file, args, { encoding: "utf8", ...options });
const keychain = asc.signing?.keychain,
  keychainPassword = asc.signing?.keychainPassword;
if (!keychain || !existsSync(keychain))
  throw new Error(
    "Run node scripts/make-ios-signing.mjs first; it makes the project keychain.",
  );

// 1. Connected iPhones, registered with the team.
const listing = path.join(tmpdir(), `counterwell-devices-${process.pid}.json`);
run("xcrun", ["devicectl", "list", "devices", "--json-output", listing], {
  stdio: "ignore",
});
const phones = JSON.parse(readFileSync(listing, "utf8")).result.devices.filter(
  (d) =>
    d.hardwareProperties?.platform === "iOS" &&
    d.hardwareProperties?.reality === "physical",
);
rmSync(listing, { force: true });
for (const phone of phones) {
  const udid = phone.hardwareProperties.udid;
  const known = await api("GET", `/devices?filter[udid]=${udid}&limit=1`);
  if (known.data.length) continue;
  const name = (phone.deviceProperties?.name ?? "iPhone")
    .replace(/[^\w .-]/g, "")
    .slice(0, 50);
  await api("POST", "/devices", {
    data: { type: "devices", attributes: { name, udid, platform: "IOS" } },
  });
  console.log(`Registered ${name}`);
}
const devices = (
  await api(
    "GET",
    "/devices?filter[platform]=IOS&filter[status]=ENABLED&limit=200",
  )
).data;
if (!devices.length)
  throw new Error(
    "No iPhone is registered: connect one by cable, unlock it and turn on Developer Mode.",
  );

// 2. Apple Development certificate, with its private key made here.
const dev = asc.development ?? {};
const keyFile = path.join(dir, "development.key");
const certFile = path.join(dir, "development.cer");
if (!existsSync(certFile)) {
  run("openssl", ["genrsa", "-out", keyFile, "2048"], { stdio: "ignore" });
  const csr = run("openssl", [
    "req",
    "-new",
    "-key",
    keyFile,
    "-subj",
    "/CN=Counterwell Development/C=IN",
  ]);
  const created = await api("POST", "/certificates", {
    data: {
      type: "certificates",
      attributes: {
        certificateType: "DEVELOPMENT",
        csrContent: csr.replace(/-----[^-]+-----|\s/g, ""),
      },
    },
  });
  writeFileSync(
    certFile,
    Buffer.from(created.data.attributes.certificateContent, "base64"),
  );
  dev.certificateId = created.data.id;
  dev.imported = false;
  asc.development = dev;
  saveAsc();
  console.log(`Created development certificate ${created.data.id}`);
}

// 3. Into the project keychain, usable by codesign without a prompt.
run("security", ["unlock-keychain", "-p", keychainPassword, keychain]);
if (!dev.imported) {
  const pem = path.join(dir, "development.pem");
  run("openssl", ["x509", "-inform", "DER", "-in", certFile, "-out", pem]);
  const p12 = path.join(dir, "development.p12");
  const p12Password = randomBytes(12).toString("base64url");
  run("openssl", [
    "pkcs12",
    "-export",
    "-legacy",
    "-inkey",
    keyFile,
    "-in",
    pem,
    "-out",
    p12,
    "-passout",
    `pass:${p12Password}`,
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
  run(
    "security",
    [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    ],
    { stdio: "ignore" },
  );
  dev.imported = true;
  asc.development = dev;
  saveAsc();
}
// Trust is checked only for keychains on the search list: add ours for the check, then restore.
const searchList = run("security", ["list-keychains", "-d", "user"])
  .split("\n")
  .map((line) => line.trim().replace(/^"|"$/g, ""))
  .filter((k) => k && k !== keychain);
run("security", [
  "list-keychains",
  "-d",
  "user",
  "-s",
  ...searchList,
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
  run("security", ["list-keychains", "-d", "user", "-s", ...searchList]);
}
const identity = /"(Apple Development: [^"]+)"/.exec(identities)?.[1];
if (!identity)
  throw new Error(
    `No valid development identity in the keychain:\n${identities}`,
  );
dev.identity = identity;

// 4. Development profile for the app, covering every registered iPhone.
const bundle = (
  await api(
    "GET",
    `/bundleIds?filter[identifier]=${encodeURIComponent(asc.bundleId)}`,
  )
).data.find((b) => b.attributes.identifier === asc.bundleId);
if (!bundle) throw new Error(`${asc.bundleId} is not registered`);
dev.certificateId ??= (
  await api(
    "GET",
    "/certificates?filter[certificateType]=DEVELOPMENT&limit=200",
  )
).data.find((c) =>
  Buffer.from(c.attributes.certificateContent, "base64").equals(
    readFileSync(certFile),
  ),
)?.id;
const profileName = `Counterwell Development ${new Date().toISOString().slice(0, 10)}`;
const existing = await api(
  "GET",
  `/profiles?filter[name]=${encodeURIComponent(profileName)}`,
);
for (const old of existing.data) await api("DELETE", `/profiles/${old.id}`);
const profile = await api("POST", "/profiles", {
  data: {
    type: "profiles",
    attributes: { name: profileName, profileType: "IOS_APP_DEVELOPMENT" },
    relationships: {
      bundleId: { data: { type: "bundleIds", id: bundle.id } },
      certificates: {
        data: [{ type: "certificates", id: dev.certificateId }],
      },
      devices: {
        data: devices.map((d) => ({ type: "devices", id: d.id })),
      },
    },
  },
});
const content = Buffer.from(profile.data.attributes.profileContent, "base64");
const uuid = profile.data.attributes.uuid;
writeFileSync(path.join(dir, "development.mobileprovision"), content);
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
dev.profileName = profileName;
dev.profileUuid = uuid;
asc.development = dev;
saveAsc();
console.log(
  `Development signing ready: ${identity}, profile "${profileName}" for ${devices.length} iPhone(s).`,
);
