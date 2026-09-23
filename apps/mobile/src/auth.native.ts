import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4100";
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    usernameClient(),
    expoClient({
      scheme: "counterwell",
      storagePrefix: "counterwell.auth",
      storage: SecureStore,
    }),
  ],
});
export const cookieHeaders = async (): Promise<Record<string, string>> => {
  const cookie = await authClient.getCookie();
  return cookie ? { Cookie: cookie } : {};
};
