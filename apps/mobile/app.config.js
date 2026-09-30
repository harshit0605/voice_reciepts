// Extends app.json with settings that depend on the build or on files kept out of git.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  // Firebase's Android settings are copied in by scripts/build-android-release.mjs from the
  // git-ignored .data/firebase; the repository is public. Without them Android simply has no
  // notifications.
  const googleServices = fs.existsSync(
    path.join(__dirname, "google-services.json"),
  );
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServices
        ? { googleServicesFile: "./google-services.json" }
        : {}),
    },
    plugins: [
      ...config.plugins,
      [
        "expo-notifications",
        {
          icon: "./assets/notification-icon.png",
          color: "#146D5A",
          // TestFlight and App Store builds use Apple's production notification service.
          mode:
            process.env.NODE_ENV === "production"
              ? "production"
              : "development",
        },
      ],
    ],
  };
};
