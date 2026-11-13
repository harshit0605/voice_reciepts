// Apps built with the iOS 27 SDK must use the scene-based life cycle: without it UIKit stops the
// app as it opens (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption), which is how
// the first TestFlight build from Xcode 27.2 crashed. Expo 57 ships the scene delegate
// (ExpoAppSceneDelegate) but its project template does not use it yet; this makes the same three
// changes as Expo 58's template. Remove this plugin after upgrading to Expo 58.
const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const SCENE_DELEGATE = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`;

module.exports = function sceneLifecycle(config) {
  // 1. Declare the scene and its delegate.
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return c;
  });

  // 2. The app delegate keeps creating the React Native factory, hands it to the scene delegate,
  //    and no longer makes its own window.
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift")
      throw new Error("scene-lifecycle: expected a Swift AppDelegate");
    let source = c.modResults.contents;
    if (!source.includes("ExpoReactNativeFactoryProvider")) {
      const declaration = "class AppDelegate: ExpoAppDelegate {";
      const ownWindow =
        /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;
      // Fail the build rather than ship an app that stops at launch.
      if (!source.includes(declaration) || !ownWindow.test(source))
        throw new Error(
          "scene-lifecycle: the AppDelegate no longer matches Expo 57's template; compare it with Expo 58's and update this plugin",
        );
      source = source
        .replace(
          declaration,
          "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
        )
        .replace(
          ownWindow,
          "    // The window is created and React Native is started by `SceneDelegate` under the\n    // scene-based life cycle (required by the iOS 27 SDK).\n",
        );
    }
    c.modResults.contents = source;
    return c;
  });

  // 3. Add SceneDelegate.swift to the app target.
  config = withDangerousMod(config, [
    "ios",
    (c) => {
      fs.writeFileSync(
        path.join(
          c.modRequest.platformProjectRoot,
          c.modRequest.projectName,
          "SceneDelegate.swift",
        ),
        SCENE_DELEGATE,
      );
      return c;
    },
  ]);
  config = withXcodeProject(config, (c) => {
    const name = c.modRequest.projectName;
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${name}/SceneDelegate.swift`,
      groupName: name,
      project: c.modResults,
    });
    return c;
  });
  return config;
};
