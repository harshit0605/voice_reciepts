import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { SessionProvider } from "../src/session";
export default function Layout() {
  // Text laid out before the font arrives keeps the fallback font's width on iOS and gets clipped.
  // The faces are Anek Devanagari with corrected line metrics (assets/fonts/patch-anek.py); the
  // keys are the family names theme.ts uses. Icons load here too so tabs never draw blank.
  const [loaded, failed] = useFonts({
    AnekDevanagari_400Regular: require("../assets/fonts/CounterwellAnek-Regular.ttf"),
    AnekDevanagari_500Medium: require("../assets/fonts/CounterwellAnek-Medium.ttf"),
    AnekDevanagari_600SemiBold: require("../assets/fonts/CounterwellAnek-SemiBold.ttf"),
    AnekDevanagari_700Bold: require("../assets/fonts/CounterwellAnek-Bold.ttf"),
    ...Ionicons.font,
  });
  if (!loaded && !failed) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#FFFFFF" },
          }}
        />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
