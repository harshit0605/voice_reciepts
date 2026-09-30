import { Platform } from "react-native";

// expo-notifications is a native module: a development build made before it was added does not
// have it, so it is loaded lazily and every use tolerates its absence.
type Notifications = typeof import("expo-notifications");
let loaded: Promise<Notifications | null> | undefined;
function notifications() {
  if (Platform.OS === "web") return Promise.resolve(null);
  loaded ??= import("expo-notifications")
    .then((n) => {
      n.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      return n;
    })
    .catch(() => null);
  return loaded;
}

/**
 * Asks once for permission and returns this phone's own notification token: an APNs token on an
 * iPhone, an FCM token on Android. Null when refused or unavailable (a simulator, or an Android
 * build without Firebase).
 */
export async function devicePushToken(): Promise<{
  token: string;
  platform: "ios" | "android";
} | null> {
  const n = await notifications();
  if (!n) return null;
  try {
    if (Platform.OS === "android")
      await n.setNotificationChannelAsync("default", {
        name: "Counterwell",
        importance: n.AndroidImportance.HIGH,
      });
    const current = await n.getPermissionsAsync();
    const granted =
      current.granted ||
      (current.canAskAgain && (await n.requestPermissionsAsync()).granted);
    if (!granted) return null;
    const token = await n.getDevicePushTokenAsync();
    return {
      token: String(token.data),
      platform: Platform.OS === "ios" ? "ios" : "android",
    };
  } catch {
    return null;
  }
}

/** Calls `open(page)` when someone taps a notification, including the one that started the app. */
export function onNotificationTap(open: (page: string) => void) {
  let stop = () => {};
  let cancelled = false;
  void notifications().then(async (n) => {
    if (!n || cancelled) return;
    const page = (data: unknown) =>
      typeof (data as { page?: unknown })?.page === "string"
        ? (data as { page: string }).page
        : undefined;
    const first = await n.getLastNotificationResponseAsync().catch(() => null);
    const initial = page(first?.notification.request.content.data);
    if (initial && !cancelled) open(initial);
    const subscription = n.addNotificationResponseReceivedListener((r) => {
      const target = page(r.notification.request.content.data);
      if (target) open(target);
    });
    stop = () => subscription.remove();
  });
  return () => {
    cancelled = true;
    stop();
  };
}
