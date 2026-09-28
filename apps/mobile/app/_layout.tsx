import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/session";
import {
  useFonts,
  DMSans_400Regular,
  DMSans_600SemiBold,
} from "@expo-google-fonts/dm-sans";
export default function Layout() {
  // Text laid out before the font arrives keeps the fallback font's width on iOS and gets clipped.
  const [loaded, failed] = useFonts({ DMSans_400Regular, DMSans_600SemiBold });
  if (!loaded && !failed) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
