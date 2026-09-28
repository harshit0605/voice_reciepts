// Stand-in for the optional `expo-network` module that @better-auth/expo loads to pause session
// refetches while offline. The app does not use better-auth's reactive session and tracks the
// connection itself. Without this, Expo's native loader throws from that optional import instead of
// rejecting, and the throw can surface as a failed sign-out ("Cannot find module 'expo-network'").
// Reporting "always reachable" is better-auth's own fallback when the module is absent.
export function addNetworkStateListener(
  _listener: (state: { isInternetReachable: boolean }) => void,
) {
  return { remove() {} };
}
