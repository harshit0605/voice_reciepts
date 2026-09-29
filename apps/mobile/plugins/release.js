// Release settings that must survive `expo prebuild` (the android/ and ios/ folders are generated).
const {
  withAndroidManifest,
  withAppBuildGradle,
  withInfoPlist,
  withProjectBuildGradle,
} = require("expo/config-plugins");

/**
 * - The shop gateway (printing, sale backups) is a PC on the shop's Wi-Fi reached over plain
 *   HTTP, so release builds must allow it: Android blocks cleartext and iOS blocks local HTTP by
 *   default. The API itself should be HTTPS.
 * - Release APKs are signed with the shop's own upload key when COUNTERWELL_KEYSTORE and its
 *   passwords are set (see scripts/build-android-release.mjs); otherwise the debug key is used.
 * - COUNTERWELL_MAVEN_LOCAL names a folder of already-downloaded libraries (React Native's release
 *   libraries are over 200 MB) that Gradle checks before the internet.
 */
module.exports = function release(config) {
  config = withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$["android:usesCleartextTraffic"] =
      "true";
    return c;
  });
  config = withInfoPlist(config, (c) => {
    c.modResults.NSAppTransportSecurity = {
      ...(c.modResults.NSAppTransportSecurity ?? {}),
      NSAllowsLocalNetworking: true,
    };
    return c;
  });
  config = withProjectBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes("COUNTERWELL_MAVEN_LOCAL"))
      c.modResults.contents = c.modResults.contents.replace(
        /allprojects \{\n(\s+)repositories \{\n/,
        `allprojects {\n$1repositories {\n$1  if (System.getenv("COUNTERWELL_MAVEN_LOCAL")) { maven { url = uri(System.getenv("COUNTERWELL_MAVEN_LOCAL")) } }\n`,
      );
    return c;
  });
  config = withAppBuildGradle(config, (c) => {
    let gradle = c.modResults.contents;
    if (!gradle.includes("COUNTERWELL_KEYSTORE")) {
      gradle = gradle.replace(
        /signingConfigs \{\n(\s+)debug \{/,
        `signingConfigs {
$1release {
$1    if (System.getenv("COUNTERWELL_KEYSTORE")) {
$1        storeFile file(System.getenv("COUNTERWELL_KEYSTORE"))
$1        storePassword System.getenv("COUNTERWELL_KEYSTORE_PASSWORD")
$1        keyAlias System.getenv("COUNTERWELL_KEY_ALIAS")
$1        keyPassword System.getenv("COUNTERWELL_KEY_PASSWORD")
$1    }
$1}
$1debug {`,
      );
      gradle = gradle.replace(
        /(release \{\n\s+\/\/ Caution![^\n]*\n[^\n]*\n\s+)signingConfig signingConfigs\.debug/,
        '$1signingConfig System.getenv("COUNTERWELL_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
      );
    }
    c.modResults.contents = gradle;
    return c;
  });
  return config;
};
