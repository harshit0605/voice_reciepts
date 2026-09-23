import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4100";
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [usernameClient()],
});
export const cookieHeaders = async (): Promise<Record<string, string>> => ({});
