const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @better-auth/expo imports the optional expo-network module; see src/expo-network-stand-in.ts.
const standIn = path.resolve(__dirname, "src/expo-network-stand-in.ts");
const resolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  moduleName === "expo-network"
    ? { type: "sourceFile", filePath: standIn }
    : (resolve ?? context.resolveRequest)(context, moduleName, platform);

module.exports = config;
