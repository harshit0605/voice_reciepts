import React, { useEffect, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useSession } from "./session";
import { colors, Txt, Icon, Button, Field, Row, Badge, useText } from "./ui";
import { SellScreen, ReceiptSheet } from "./selling";
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
export default function App() {
  const session = useSession(),
    t = useText(),
    { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [page, setPage] = useState("sell"),
    [invoice, setInvoice] = useState<Invoice | null>(null);
  const params = useLocalSearchParams();
  useEffect(() => {
    if (params.demo === "owner" || params.demo === "employee")
      session.startDemo(params.demo);
  }, []);
  useEffect(() => setPage("sell"), [session.identity?.actor.id]);
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
  if (!session.identity || session.passwordRequired) return <Login />;
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
  const nav = (items: typeof tabs | typeof ownerTabs) =>
    items.map(([key, icon]) => (
      <Pressable
        key={key}
        onPress={() => setPage(key)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 16,
          borderRadius: 9,
          backgroundColor: page === key ? colors.tint : "transparent",
        }}
      >
        <Icon
          name={icon}
          size={20}
          color={page === key ? colors.accent : colors.muted}
        />
        <Txt
          bold={page === key}
          style={{ color: page === key ? colors.accent : colors.muted }}
        >
          {t(key)}
        </Txt>
        {key === "reviews" &&
          Object.values(session.state!.reviews).some(
            (r) => r.status === "open",
          ) && (
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: colors.amber,
              }}
            />
          )}
      </Pressable>
    ));
  const content =
    page === "sell" ? (
      <SellScreen onInvoice={setInvoice} />
    ) : page === "orders" ? (
      <OrdersScreen onInvoice={setInvoice} />
    ) : page === "stock" || page === "inventory" ? (
      <StockScreen manage={owner && page === "inventory"} />
    ) : page === "customers" ? (
      <CustomersScreen />
    ) : page === "overview" ? (
      <OverviewScreen />
    ) : page === "money" ? (
      <MoneyScreen />
    ) : page === "reviews" ? (
      <ReviewsScreen />
    ) : page === "administration" ? (
      <AdministrationScreen />
    ) : (
      <MoreScreen navigate={setPage} />
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {wide && (
          <View
            style={{
              width: 224,
              backgroundColor: "white",
              borderRightWidth: 1,
              borderColor: colors.line,
              padding: 20,
            }}
          >
            <Brand />
            <View style={{ height: 42 }} />
            <Txt
              muted
              size={10}
              bold
              style={{ letterSpacing: 1.5, marginLeft: 16, marginBottom: 13 }}
            >
              COUNTER
            </Txt>
            {nav(tabs)}
            {owner && (
              <>
                <View style={{ height: 34 }} />
                <Txt
                  muted
                  size={10}
                  bold
                  style={{
                    letterSpacing: 1.5,
                    marginLeft: 16,
                    marginBottom: 13,
                  }}
                >
                  MANAGEMENT
                </Txt>
                {nav(ownerTabs)}
              </>
            )}
            <View style={{ flex: 1 }} />
            <View
              style={{
                borderTopWidth: 1,
                borderColor: colors.line,
                paddingTop: 20,
              }}
            >
              <Row>
                <View
                  style={{
                    width: 35,
                    height: 35,
                    borderRadius: 18,
                    backgroundColor: colors.tint,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Txt bold>{owner ? "O" : "A"}</Txt>
                </View>
                <View>
                  <Txt size={12} bold>
                    {session.state.members[session.identity.actor.id]?.name}
                  </Txt>
                  <Txt size={11} muted>
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
              paddingHorizontal: wide ? 32 : 20,
              paddingVertical: 17,
              borderBottomWidth: 1,
              borderColor: colors.line,
              backgroundColor: "white",
            }}
          >
            <Row style={{ justifyContent: "space-between" }}>
              {wide ? (
                <View>
                  <Txt bold size={15}>
                    {session.state.settings.name}
                  </Txt>
                  <Txt size={11} muted style={{ marginTop: 4 }}>
                    {new Date().toLocaleDateString(
                      session.language === "hi" ? "hi-IN" : "en-IN",
                      { weekday: "long", day: "numeric", month: "long" },
                    )}{" "}
                    ·{" "}
                    {
                      session.state.devices[session.identity.deviceId]
                        ?.counterId
                    }
                  </Txt>
                </View>
              ) : (
                <Brand small />
              )}
              <Row>
                <Pressable
                  onPress={() =>
                    session.setLanguage(session.language === "en" ? "hi" : "en")
                  }
                  style={{ padding: 8 }}
                >
                  <Txt bold size={12}>
                    {session.language === "en" ? "हिंदी" : "EN"}
                  </Txt>
                </Pressable>
                <Pressable
                  accessibilityLabel="Synchronise"
                  onPress={() => void session.sync()}
                >
                  <Badge
                    warning={!session.online || session.pending.length > 0}
                  >
                    {session.pending.length
                      ? `${session.pending.length} ${t("pending")}`
                      : session.online
                        ? t("synced")
                        : t("offline")}
                  </Badge>
                </Pressable>
              </Row>
            </Row>
          </View>
          {session.demo && (
            <View
              style={{
                paddingVertical: 7,
                paddingHorizontal: wide ? 32 : 20,
                backgroundColor: "#ECEEE6",
              }}
            >
              <Txt size={11} muted>
                {session.language === "hi"
                  ? "डेमो दुकान · नमूना डेटा · कोई वास्तविक भुगतान नहीं"
                  : "DEMO SHOP · Sample inventory and tax rates · No real payments"}
              </Txt>
            </View>
          )}
          {!!session.error && (
            <Pressable
              onPress={() => session.setError("")}
              style={{ padding: 12, backgroundColor: colors.amberBg }}
            >
              <Txt size={12} style={{ color: colors.amber }}>
                {session.error} ×
              </Txt>
            </Pressable>
          )}
          <View style={{ flex: 1 }}>{content}</View>
          {!wide && (
            <View
              style={{
                flexDirection: "row",
                backgroundColor: "white",
                borderTopWidth: 1,
                borderColor: colors.line,
                paddingBottom: 4,
                paddingTop: 8,
              }}
            >
              {tabs.map(([key, icon]) => (
                <Pressable
                  key={key}
                  onPress={() => setPage(key)}
                  style={{ flex: 1, alignItems: "center", padding: 8, gap: 4 }}
                >
                  <Icon
                    name={icon}
                    size={22}
                    color={page === key ? colors.accent : colors.muted}
                  />
                  <Txt
                    size={10}
                    bold={page === key}
                    style={{
                      color: page === key ? colors.accent : colors.muted,
                    }}
                  >
                    {t(key)}
                  </Txt>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
      <ReceiptSheet invoice={invoice} onClose={() => setInvoice(null)} />
    </SafeAreaView>
  );
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <Row style={{ gap: 9 }}>
      <View
        style={{
          width: small ? 30 : 35,
          height: small ? 30 : 35,
          borderRadius: 10,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="layers" color="white" size={small ? 18 : 22} />
      </View>
      <Txt bold size={small ? 19 : 22} style={{ letterSpacing: -0.8 }}>
        counterwell<Txt style={{ color: colors.accent }}>.</Txt>
      </Txt>
    </Row>
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
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (s.passwordRequired) await s.changePassword(password, replacement);
      else await s.login(username, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 28,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={{ width: "100%", maxWidth: 390 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Brand />
            <Pressable
              onPress={() => s.setLanguage(s.language === "en" ? "hi" : "en")}
              style={{ padding: 10 }}
            >
              <Txt bold>{s.language === "en" ? "हिंदी" : "EN"}</Txt>
            </Pressable>
          </Row>
          <View style={{ height: 54 }} />
          <Txt size={32} bold style={{ letterSpacing: -1 }}>
            {s.passwordRequired
              ? "Set your password"
              : s.language === "hi"
                ? "दुकान का काम, एक जगह।"
                : "Ready for the next customer."}
          </Txt>
          <Txt
            muted
            style={{ lineHeight: 22, marginTop: 12, marginBottom: 30 }}
          >
            {s.passwordRequired
              ? "Replace the temporary password your owner gave you."
              : "Sign in to your shop to start billing and keep the day’s work in order."}
          </Txt>
          {!s.passwordRequired && (
            <Field
              label={t("username")}
              value={username}
              onChange={setUsername}
              placeholder="Your shop username"
            />
          )}
          <Field
            label={s.passwordRequired ? "Temporary password" : t("password")}
            value={password}
            onChange={setPassword}
            secret
          />
          {s.passwordRequired && (
            <Field
              label="New password · at least 12 characters"
              value={replacement}
              onChange={setReplacement}
              secret
            />
          )}
          {!!error && (
            <Txt style={{ color: colors.red, marginBottom: 15 }}>{error}</Txt>
          )}
          <Button onPress={() => void submit()} disabled={busy}>
            {busy
              ? "Signing in…"
              : s.passwordRequired
                ? "Update password"
                : t("signIn")}
          </Button>
          <View style={{ height: 30 }} />
          <View
            style={{
              borderTopWidth: 1,
              borderColor: colors.line,
              paddingTop: 22,
              gap: 12,
            }}
          >
            <Button
              secondary
              onPress={() => s.startDemo("owner")}
              icon="play-outline"
            >
              {t("demo")} · Owner
            </Button>
            <Pressable
              onPress={() => s.startDemo("employee")}
              style={{ padding: 12, alignItems: "center" }}
            >
              <Txt muted size={12}>
                Explore employee workspace
              </Txt>
            </Pressable>
            <Txt
              size={11}
              muted
              style={{ textAlign: "center", lineHeight: 18 }}
            >
              Demo data stays separate from your real shop. Native development
              builds support encrypted offline billing.
            </Txt>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
