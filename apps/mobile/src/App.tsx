import React, { useEffect, useRef, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  type TextInput,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useSession, signInFailure } from "./session";
import {
  colors,
  palette,
  radius,
  space,
  toneInk,
  Txt,
  Icon,
  Button,
  Field,
  Row,
  Banner,
  StaffMark,
  BrandMark,
  Wordmark,
  RuledPaper,
  useText,
} from "./ui";
import { shadow } from "./theme";
import { SellScreen, ReceiptSheet } from "./selling";
import { useAttention } from "./payments";
import { ShopSetup } from "./setup";
import { onNotificationTap } from "./push";
import {
  OrdersScreen,
  StockScreen,
  CustomersScreen,
  MoreScreen,
  OverviewScreen,
  MoneyScreen,
  ReviewsScreen,
  AdministrationScreen,
} from "./screens";
import { ExpiryScreen } from "./expiry";
import type { Invoice } from "@counterwell/core";
const tabs = [
  ["sell", "bag-handle-outline"],
  ["orders", "receipt-outline"],
  ["stock", "cube-outline"],
  ["customers", "people-outline"],
  ["more", "grid-outline"],
] as const;
const ownerTabs = [
  ["overview", "analytics-outline"],
  ["inventory", "layers-outline"],
  ["money", "wallet-outline"],
  ["reviews", "shield-checkmark-outline"],
  ["administration", "settings-outline"],
] as const;
/** The demo shop is for the web preview and development; a shop's phones sign in to the real one. */
const DEMO =
  __DEV__ || Platform.OS === "web" || process.env.EXPO_PUBLIC_DEMO === "1";
export default function App() {
  const session = useSession(),
    t = useText(),
    { width } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const wide = width >= 768;
  const [page, setPage] = useState("sell"),
    [invoice, setInvoice] = useState<Invoice | null>(null);
  const params = useLocalSearchParams();
  // Handoffs, requests waiting for the owner, and answers to this person's requests.
  const attention = useAttention();
  useEffect(() => {
    if (DEMO && (params.demo === "owner" || params.demo === "employee"))
      session.startDemo(params.demo);
  }, []);
  // A tapped notification opens its screen (a request, an answer, the drawer or the day report).
  // When the tap started the app, it is read before the session is restored, so it is kept until
  // then instead of being replaced by the start page.
  const actorId = session.identity?.actor.id;
  const signedIn = useRef(actorId),
    tapped = useRef<string | undefined>(undefined);
  signedIn.current = actorId;
  useEffect(() => {
    setPage(tapped.current ?? "sell");
    session.setError("");
    tapped.current = undefined;
  }, [actorId]);
  // One-off messages belong to the screen that raised them: drop them on leaving it.
  const { setError } = session;
  useEffect(() => setError(""), [page]);
  useEffect(
    () =>
      onNotificationTap((target) => {
        if (signedIn.current) setPage(target);
        else tapped.current = target;
      }),
    [],
  );
  if (session.loading)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  if (!session.identity || session.passwordRequired || session.signInRequired)
    return <Login />;
  if (!session.state)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 30,
          backgroundColor: colors.bg,
        }}
      >
        <Txt>{session.error || "Loading shop…"}</Txt>
        <Button
          onPress={() =>
            void session.refresh().catch((e) => session.setError(e.message))
          }
        >
          Retry
        </Button>
        <Button secondary onPress={() => void session.logout()}>
          Sign out
        </Button>
      </View>
    );
  const owner = session.identity.actor.role === "owner";
  const count = (target: string) =>
    attention.filter((a) => a.page === target).length;
  // On a phone the owner screens sit under More.
  const badge = (key: string) =>
    count(key) + (key === "more" && !wide ? count("reviews") : 0);
  const nav = (items: typeof tabs | typeof ownerTabs) =>
    items.map(([key, icon]) => {
      const active = page === key;
      const dot =
        (key === "reviews" &&
          Object.values(session.state!.reviews).some(
            (r) => r.status === "open",
          )) ||
        badge(key) > 0;
      return (
        <Pressable
          key={key}
          onPress={() => setPage(key)}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 46,
            paddingHorizontal: 14,
            borderRadius: radius.md,
            backgroundColor: active
              ? palette.blueTint
              : pressed
                ? palette.desk
                : "transparent",
          })}
        >
          <Icon
            name={(active ? icon.replace("-outline", "") : icon) as any}
            size={20}
            color={active ? palette.blue : palette.ink2}
          />
          <Txt
            size={15}
            weight={active ? 600 : 500}
            color={active ? palette.blue : palette.ink2}
            style={{ flex: 1 }}
          >
            {t(key)}
          </Txt>
          {dot && (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: palette.waiting,
              }}
            />
          )}
        </Pressable>
      );
    });
  const content =
    page === "sell" ? (
      <SellScreen onInvoice={setInvoice} />
    ) : page === "orders" ? (
      <OrdersScreen onInvoice={setInvoice} />
    ) : page === "stock" || page === "inventory" ? (
      <StockScreen manage={owner && page === "inventory"} navigate={setPage} />
    ) : page === "expiry" && owner ? (
      <ExpiryScreen navigate={setPage} />
    ) : page === "customers" ? (
      <CustomersScreen />
    ) : page === "overview" ? (
      <OverviewScreen navigate={setPage} />
    ) : page === "money" ? (
      <MoneyScreen />
    ) : page === "reviews" ? (
      <ReviewsScreen />
    ) : page === "administration" ? (
      <AdministrationScreen />
    ) : (
      <MoreScreen navigate={setPage} />
    );
  const me = session.state.members[session.identity.actor.id];
  const counter =
    session.state.devices[session.identity.deviceId]?.counterId;
  const syncTone = session.pending.length
    ? "waiting"
    : session.online
      ? "paid"
      : "declined";
  const syncText = session.pending.length
    ? `${session.pending.length} ${t("pending")}`
    : session.online
      ? t("synced")
      : t("offline");
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: palette.paper }}
      edges={wide ? undefined : ["top", "left", "right"]}
    >
      <View style={{ flex: 1, flexDirection: "row" }}>
        {wide && (
          <View
            style={{
              width: 248,
              backgroundColor: palette.paper,
              borderRightWidth: 1,
              borderColor: palette.rule,
              paddingHorizontal: 16,
              paddingVertical: 20,
            }}
          >
            <View style={{ paddingHorizontal: 6 }}>
              <Wordmark size={19} />
            </View>
            <View style={{ height: 32 }} />
            <Txt
              size={13}
              weight={600}
              color={palette.ink3}
              style={{ marginLeft: 14, marginBottom: 6 }}
            >
              Counter
            </Txt>
            {nav(tabs)}
            {owner && (
              <>
                <View style={{ height: 24 }} />
                <Txt
                  size={13}
                  weight={600}
                  color={palette.ink3}
                  style={{ marginLeft: 14, marginBottom: 6 }}
                >
                  Management
                </Txt>
                {nav(ownerTabs)}
              </>
            )}
            <View style={{ flex: 1 }} />
            <View
              style={{
                borderTopWidth: 1,
                borderColor: palette.rule,
                paddingTop: 16,
                paddingHorizontal: 6,
              }}
            >
              <Row>
                <StaffMark
                  id={session.identity.actor.id}
                  name={me?.name}
                  size={36}
                />
                <View style={{ flex: 1 }}>
                  <Txt size={14} weight={600} numberOfLines={1}>
                    {me?.name}
                  </Txt>
                  <Txt size={13} color={palette.ink3}>
                    {owner ? "Owner" : "Employee"}
                  </Txt>
                </View>
              </Row>
            </View>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{
              paddingHorizontal: wide ? 32 : space.gutter,
              paddingTop: wide ? 18 : 8,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderColor: palette.rule,
              backgroundColor: palette.paper,
            }}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <Row style={{ flex: 1, gap: 10 }}>
                {!wide && <BrandMark size={30} />}
                <View style={{ flex: 1 }}>
                  <Txt size={16} weight={700} numberOfLines={2}>
                    {session.state.settings.name}
                  </Txt>
                  <Txt size={12} weight={500} color={palette.ink3} num>
                    {new Date().toLocaleDateString(
                      session.language === "hi" ? "hi-IN" : "en-IN",
                      wide
                        ? { weekday: "long", day: "numeric", month: "long" }
                        : { weekday: "short", day: "numeric", month: "short" },
                    )}
                    {counter ? ` · ${counter}` : ""}
                  </Txt>
                </View>
              </Row>
              <Row style={{ gap: 8 }}>
                <Pressable
                  onPress={() =>
                    session.setLanguage(session.language === "en" ? "hi" : "en")
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    session.language === "en"
                      ? "हिंदी में बदलें"
                      : "Switch to English"
                  }
                  hitSlop={6}
                  style={({ pressed }) => ({
                    height: 34,
                    minWidth: 48,
                    paddingHorizontal: 10,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: palette.ruleStrong,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? palette.desk : palette.paper,
                  })}
                >
                  <Txt size={14} weight={600} color={palette.ink2}>
                    {session.language === "en" ? "हिंदी" : "EN"}
                  </Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${syncText}. Synchronise`}
                  onPress={() => void session.sync()}
                  hitSlop={6}
                  style={({ pressed }) => ({
                    height: 34,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 34,
                    justifyContent: "center",
                    paddingHorizontal: 10,
                    borderRadius: radius.pill,
                    backgroundColor: toneInk[syncTone][1],
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  {/* An icon as well as the colour: a tick when up to date, a clock when bills
                      are waiting, a cloud with a slash when offline. */}
                  <Icon
                    name={
                      syncTone === "paid"
                        ? "checkmark-circle"
                        : syncTone === "waiting"
                          ? "time"
                          : "cloud-offline"
                    }
                    size={16}
                    color={toneInk[syncTone][0]}
                  />
                  {/* On a phone a green dot says "up to date"; words appear when something
                      is waiting or the phone is offline. */}
                  {(wide || syncTone !== "paid") && (
                    <Txt size={13} weight={600} color={toneInk[syncTone][0]}>
                      {syncText}
                    </Txt>
                  )}
                </Pressable>
              </Row>
            </Row>
          </View>
          {session.demo && (
            <View
              style={{
                paddingVertical: 6,
                paddingHorizontal: wide ? 32 : space.gutter,
                backgroundColor: palette.desk,
              }}
            >
              <Txt size={12} weight={500} color={palette.ink2}>
                {session.language === "hi"
                  ? "डेमो दुकान · नमूना डेटा · कोई वास्तविक भुगतान नहीं"
                  : "Demo shop · Sample stock and tax rates · No real payments"}
              </Txt>
            </View>
          )}
          {!!session.error && (
            <Banner tone="declined" onClose={() => session.setError("")}>
              {session.error}
            </Banner>
          )}
          {attention
            .filter(
              (a) =>
                a.page !== page || (page === "orders" && a.key !== "handoff"),
            )
            .slice(0, 2)
            .map((a) => (
              <Banner key={a.key} tone="waiting" onPress={() => setPage(a.page)}>
                {a.text}
              </Banner>
            ))}
          {(page === "sell" || page === "overview") && (
            <ShopSetup navigate={setPage} wide={wide} />
          )}
          <View style={{ flex: 1 }}>{content}</View>
          {!wide && (
            <View
              style={{
                flexDirection: "row",
                backgroundColor: palette.paper,
                borderTopWidth: 1,
                borderColor: palette.rule,
                paddingTop: 6,
                paddingBottom: Math.max(insets.bottom, 8),
              }}
            >
              {tabs.map(([key, icon]) => {
                // On a phone the owner screens (and Expiry) open from More, so More stays lit.
                const active =
                  page === key ||
                  (key === "more" && !tabs.some(([k]) => k === page));
                return (
                  <Pressable
                    key={key}
                    onPress={() => setPage(key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={t(key)}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      paddingVertical: 4,
                      gap: 3,
                      minHeight: 52,
                    }}
                  >
                    <View
                      style={{
                        width: 56,
                        height: 30,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {/* The pill is always drawn and only its opacity changes: switching the
                          background on after mount lost the corner radius on Android. */}
                      <View
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          borderRadius: 15,
                          backgroundColor: palette.blueTint,
                          opacity: active ? 1 : 0,
                        }}
                      />
                      <Icon
                        name={(active ? icon.replace("-outline", "") : icon) as any}
                        size={22}
                        color={active ? palette.blue : palette.ink2}
                      />
                      {badge(key) > 0 && (
                        <View
                          style={{
                            position: "absolute",
                            top: -2,
                            right: 6,
                            minWidth: 18,
                            height: 18,
                            borderRadius: 9,
                            paddingHorizontal: 4,
                            backgroundColor: palette.waiting,
                            borderWidth: 2,
                            borderColor: palette.paper,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Txt
                            size={12}
                            weight={700}
                            color="#FFFFFF"
                            num
                            style={{ fontSize: 10, lineHeight: 12 }}
                          >
                            {badge(key)}
                          </Txt>
                        </View>
                      )}
                    </View>
                    <Txt
                      size={12}
                      weight={active ? 600 : 500}
                      color={active ? palette.blue : palette.ink2}
                      numberOfLines={1}
                    >
                      {t(key)}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </View>
      <ReceiptSheet invoice={invoice} onClose={() => setInvoice(null)} />
    </SafeAreaView>
  );
}
function Login() {
  const s = useSession(),
    t = useText();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [replacement, setReplacement] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const passwordRef = useRef<TextInput>(null),
    replacementRef = useRef<TextInput>(null),
    scroller = useRef<ScrollView>(null);
  // Edge-to-edge Android does not resize the window for the keyboard (and the form could not
  // scroll past it), so lift the form by the keyboard's height, as the Sheet does, and scroll
  // down so the password field and Sign in button stay in view. iOS uses KeyboardAvoidingView.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const shown = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboard(e.endCoordinates.height);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 120);
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboard(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (s.passwordRequired) await s.changePassword(password, replacement);
      else await s.login(username, password);
    } catch (e) {
      setError(signInFailure(e));
    } finally {
      setBusy(false);
    }
  };
  const hi = s.language === "hi";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper }}>
      <RuledPaper />
      <KeyboardAvoidingView
        style={{ flex: 1, paddingBottom: keyboard }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scroller}
          contentContainerStyle={{
            flexGrow: 1,
            alignItems: "center",
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 28,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View style={{ width: "100%", maxWidth: 400, flex: 1 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Wordmark size={20} />
              <Pressable
                onPress={() => s.setLanguage(hi ? "en" : "hi")}
                accessibilityRole="button"
                hitSlop={6}
                style={({ pressed }) => ({
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: palette.ruleStrong,
                  justifyContent: "center",
                  backgroundColor: pressed ? palette.desk : palette.paper,
                })}
              >
                <Txt size={14} weight={600} color={palette.ink2}>
                  {hi ? "English" : "हिंदी"}
                </Txt>
              </Pressable>
            </Row>
            <View style={{ flex: 1, minHeight: 40, maxHeight: 120 }} />
            <Txt size={34} weight={700} style={{ letterSpacing: -0.6 }}>
              {s.passwordRequired
                ? "Set your password"
                : s.signInRequired
                  ? "Sign in again"
                  : hi
                    ? "दुकान का हर हिसाब, नाम के साथ।"
                    : "Every rupee, with a name beside it."}
            </Txt>
            <Txt
              size={16}
              color={palette.ink2}
              style={{ marginTop: 12, marginBottom: 32 }}
            >
              {s.passwordRequired
                ? "Replace the temporary password your owner gave you."
                : s.signInRequired
                  ? "This phone was signed out, for example after a password change on another phone. Sales not yet sent stay on this phone and are sent after you sign in."
                  : "Sign in to your shop to start billing and keep the day’s work in order."}
            </Txt>
            <View
              style={{
                backgroundColor: palette.paper,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: palette.rule,
                padding: 20,
                paddingBottom: 8,
                ...shadow,
              }}
            >
              {!s.passwordRequired && (
                <Field
                  identifier
                  label={t("username")}
                  value={username}
                  onChange={setUsername}
                  placeholder="Your shop username"
                  returnKeyType="next"
                  onSubmit={() => passwordRef.current?.focus()}
                />
              )}
              <Field
                label={s.passwordRequired ? "Temporary password" : t("password")}
                value={password}
                onChange={setPassword}
                secret
                inputRef={passwordRef}
                returnKeyType={s.passwordRequired ? "next" : "go"}
                onSubmit={() =>
                  s.passwordRequired
                    ? replacementRef.current?.focus()
                    : void submit()
                }
              />
              {s.passwordRequired && (
                <Field
                  label="New password · at least 12 characters"
                  value={replacement}
                  onChange={setReplacement}
                  secret
                  inputRef={replacementRef}
                  returnKeyType="go"
                  onSubmit={() => void submit()}
                />
              )}
              {!!error && (
                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    alignItems: "flex-start",
                    backgroundColor: palette.declinedTint,
                    borderRadius: radius.md,
                    padding: 12,
                    marginBottom: 14,
                  }}
                >
                  <Icon name="alert-circle" size={18} color={palette.declined} />
                  <Txt size={14} color={palette.declined} style={{ flex: 1 }}>
                    {error}
                  </Txt>
                </View>
              )}
              <Button onPress={() => void submit()} disabled={busy}>
                {busy
                  ? "Signing in…"
                  : s.passwordRequired
                    ? "Update password"
                    : t("signIn")}
              </Button>
              <View style={{ height: 12 }} />
            </View>
            {DEMO && (
              <View style={{ paddingTop: 28, gap: 8 }}>
                <Button
                  variant="secondary"
                  onPress={() => s.startDemo("owner")}
                  icon="play"
                >
                  {t("demo")} · Owner
                </Button>
                <Button variant="quiet" onPress={() => s.startDemo("employee")}>
                  Explore employee workspace
                </Button>
                <Txt size={13} color={palette.ink3} center>
                  Demo data stays separate from your real shop.
                </Txt>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
