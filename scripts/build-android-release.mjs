// Builds a signed release APK of the Counterwell app for a given shop server.
//
//   node scripts/build-android-release.mjs --api https://shop.example.in
//
// The first run creates the upload key in .data/android-signing/ (git-ignored). Keep that folder:
// every later update must be signed with the same key or phones refuse to install it over the
// old app. The APK is written to .data/releases/.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mobile = path.join(root, "apps/mobile");
const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const api = argument("api") ?? process.env.EXPO_PUBLIC_API_URL;
if (!api || !/^https?:\/\/[^\s/]+/.test(api)) {
  console.error("Give the shop server address: --api https://shop.example.in");
  process.exit(1);
}
if (
  api.startsWith("http://") &&
  !/localhost|127\.0\.0\.1|10\.0\.2\.2/.test(api)
)
  console.warn(
    "Warning: the server address is plain HTTP. Passwords and bills would cross the internet unencrypted; use HTTPS for a real shop.",
  );

// Upload key: created once, never committed.
const signing = path.join(root, ".data/android-signing");
const keystore = path.join(signing, "upload.keystore");
const credentialsFile = path.join(signing, "credentials.json");
mkdirSync(signing, { recursive: true });
if (!existsSync(keystore)) {
  const password = randomBytes(18).toString("base64url");
  execFileSync(
    "keytool",
    [
      "-genkeypair",
      "-v",
      "-storetype",
      "PKCS12",
      "-keystore",
      keystore,
      "-alias",
      "counterwell-upload",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-storepass",
      password,
      "-keypass",
      password,
      "-dname",
      "CN=Counterwell, O=Counterwell, C=IN",
    ],
    { stdio: "ignore" },
  );
  writeFileSync(
    credentialsFile,
    JSON.stringify(
      {
        alias: "counterwell-upload",
        password,
        created: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Created the upload key in ${path.relative(root, signing)}. Back up this folder.`,
  );
}
const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));

// Regenerating android/ drops local.properties, so Gradle needs the SDK location from here.
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  path.join(process.env.HOME ?? "", "Library/Android/sdk");
if (!existsSync(sdk)) {
  console.error(`Android SDK not found at ${sdk}. Set ANDROID_HOME.`);
  process.exit(1);
}
// Libraries fetched ahead of time on a slow connection (see docs/DEPLOY.md), used before the internet.
const mavenLocal = path.join(root, ".data/maven-local");
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ...(existsSync(mavenLocal) ? { COUNTERWELL_MAVEN_LOCAL: mavenLocal } : {}),
  NODE_ENV: "production",
  EXPO_PUBLIC_API_URL: api.replace(/\/$/, ""),
  COUNTERWELL_KEYSTORE: keystore,
  COUNTERWELL_KEYSTORE_PASSWORD: credentials.password,
  COUNTERWELL_KEY_ALIAS: credentials.alias,
  COUNTERWELL_KEY_PASSWORD: credentials.password,
};
// Firebase's Android settings (notifications) live in the git-ignored .data/firebase.
const googleServices = path.join(root, ".data/firebase/google-services.json");
if (existsSync(googleServices))
  copyFileSync(googleServices, path.join(mobile, "google-services.json"));
else
  console.warn(
    "No .data/firebase/google-services.json: this build will have no notifications on Android.",
  );
console.log(`Building for ${env.EXPO_PUBLIC_API_URL} …`);
execFileSync(
  "npx",
  ["expo", "prebuild", "--platform", "android", "--no-install"],
  {
    cwd: mobile,
    env,
    stdio: "inherit",
  },
);
// Phones in Indian shops are ARM (64-bit, and some older 32-bit ones); x86 is only emulators.
// Large libraries come from Maven Central, which is slow at times: allow long downloads.
execFileSync(
  "./gradlew",
  [
    "assembleRelease",
    "--no-daemon",
    "-PreactNativeArchitectures=arm64-v8a,armeabi-v7a",
    "-Dorg.gradle.internal.http.socketTimeout=300000",
    "-Dorg.gradle.internal.http.connectionTimeout=120000",
    "-Dorg.gradle.internal.repository.max.retries=5",
  ],
  {
    cwd: path.join(mobile, "android"),
    env,
    stdio: "inherit",
  },
);

const version = JSON.parse(readFileSync(path.join(mobile, "app.json"), "utf8"))
  .expo.version;
const built = path.join(
  mobile,
  "android/app/build/outputs/apk/release/app-release.apk",
);
const releases = path.join(root, ".data/releases");
mkdirSync(releases, { recursive: true });
const host = new URL(env.EXPO_PUBLIC_API_URL).host.replace(
  /[^a-z0-9.-]/gi,
  "-",
);
const target = path.join(
  releases,
  `counterwell-${version}-${host}-${new Date().toISOString().slice(0, 10)}.apk`,
);
copyFileSync(built, target);
const sha = createHash("sha256").update(readFileSync(target)).digest("hex");
console.log(`\nAPK: ${path.relative(root, target)}\nSHA-256: ${sha}`);
