import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  ScrollView,
  Pressable,
  useWindowDimensions,
  Platform,
} from "react-native";
import { PurchaseForm } from "./receiving";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useSession, uid } from "./session";
import {
  Txt,
  Icon,
  Button,
  Field,
  Row,
  Badge,
  Chip,
  Sheet,
  Empty,
  Section,
  colors,
  styles,
  useText,
  useWord,
  itemCount,
  SHOWN_PRODUCTS,
} from "./ui";
import { Checkout } from "./selling";
import { ProductForm } from "./product-form";
import { CatalogueImport } from "./catalogue-import";
import { StockCount, CountForm } from "./stock-count";
import { ReturnForm, RefundForm, amountOf } from "./payments";
import {
  DrawerPanel,
  DayReportView,
  clock,
  dayLabel,
  differenceColour,
} from "./drawer";
import {
  D,
  rupees,
  totals,
  balance,
  expectedCash,
  indiaDate,
  round,
  type Invoice,
  type Order,
  type Product,
  type Batch,
  type Approval,
  type State,
  groupBatches,
  matchesSearch,
  bySearch,
  returnable,
  refundQuote,
  billDue,
  dayReport,
  differenceText,
  openDrawerSession,
  invoiceNumber,
  deviceLabel,
  type ReturnLine,
} from "@counterwell/core";
const money = (value: string) => {
  const d = D(value || 0).mul(100);
  if (!d.isInteger() || d.lt(0))
    throw new Error("Enter a valid amount with at most two decimals");
  return d.toNumber();
};
/** What an open order holds, so the counter can tell orders apart and check them before collecting. */
function orderSummary(state: State, o: Order) {
  let totalPaise = 0;
  const lines = o.lines.map((l, i) => {
    const batch = state.batches[l.batchId],
      product = batch && state.products[batch.productId],
      factor = product?.units[l.unit];
    if (batch && factor)
      totalPaise += round(D(l.quantity).mul(factor).mul(batch.pricePaise));
    return {
      key: `${l.batchId}:${i}`,
      name: product ? `${product.name} ${product.strength}`.trim() : "Medicine",
      quantity: l.quantity,
      unit: l.unit,
      batch: batch?.code,
    };
  });
  return { lines, totalPaise };
}
function OrderLines({ order }: { order: Order }) {
  const state = useSession().state!,
    w = useWord();
  return (
    <View style={{ marginBottom: 16 }}>
      {orderSummary(state, order).lines.map((l) => (
        <Row
          key={l.key}
          style={[styles.listRow, { justifyContent: "space-between" }]}
        >
          <Txt bold style={{ flex: 1 }}>
            {l.name}
          </Txt>
          <Txt muted size={12}>
            {`${l.quantity} ${w(l.unit)}${l.batch ? ` · ${l.batch}` : ""}`}
          </Txt>
        </Row>
      ))}
    </View>
  );
}
function Page({ title, subtitle, action, children }: any) {
  return (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 50 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Row style={{ justifyContent: "space-between", marginBottom: 26 }}>
        <View style={{ flex: 1 }}>
          <Txt size={28} bold style={{ letterSpacing: -0.7 }}>
            {title}
          </Txt>
          {subtitle && (
            <Txt size={12} muted style={{ marginTop: 6 }}>
              {subtitle}
            </Txt>
          )}
        </View>
        {action}
      </Row>
      {children}
    </ScrollView>
  );
}
function useRun() {
  const s = useSession();
  const running = useRef(false);
  // Ignore a second tap while the first action is still being saved.
  return async (fn: () => Promise<any>) => {
    if (running.current) return;
    running.current = true;
    try {
      await fn();
    } catch (e) {
      s.setError((e as Error).message);
    } finally {
      running.current = false;
    }
  };
}
export function OverviewScreen({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    hi = s.language === "hi";
  const [operations, O] = useState<any>(null);
  useEffect(() => {
    if (!s.demo)
      void s
        .request("/operations")
        .then(O)
        .catch(() => {});
  }, [state.revision, s.demo]);
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const now = Date.now();
  const today = indiaDate(new Date(now).toISOString()),
    yesterday = indiaDate(new Date(now - 86_400_000).toISOString());
  const date = day === "today" ? today : yesterday;
  const r = useMemo(
    () => dayReport(state, date),
    [state.revision, state, date],
  );
  const drawer = openDrawerSession(state);
  const lastClose = Object.values(state.drawers)
    .filter((d) => d.closedAt)
    .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0];
  const lastCount = drawer?.checks?.at(-1);
  const sinceCount =
    drawer && now - Date.parse(lastCount?.at ?? drawer.openedAt);
  const soon = indiaDate(new Date(now + 90 * 86_400_000).toISOString());
  // Only medicines the shop has stocked; imported ones never counted are not "running low".
  const low = Object.values(state.products).filter((p) => {
    const batches = Object.values(state.batches).filter(
      (b) => b.productId === p.id,
    );
    return (
      p.active &&
      batches.length > 0 &&
      batches.reduce((n, b) => n.plus(b.quantity), D(0)).lte(p.reorderAt)
    );
  }).length;
  const expiring = Object.values(state.batches).filter(
    (b) => D(b.quantity).gt(0) && b.expiry <= soon,
  ).length;
  const waiting = Object.values(state.approvals).filter(
    (a) => a.status === "pending",
  ).length;
  const openReviews = Object.values(state.reviews).filter(
    (r) => r.status === "open",
  ).length;
  const attention: {
    icon: any;
    text: string;
    page: string;
    alert?: boolean;
  }[] = [
    ...(waiting
      ? [
          {
            icon: "checkmark-circle-outline",
            text: hi
              ? `${waiting} अनुरोध आपकी मंज़ूरी का इंतज़ार कर रहे हैं`
              : `${waiting} ${waiting === 1 ? "request is" : "requests are"} waiting for your approval`,
            page: "reviews",
            alert: true,
          },
        ]
      : []),
    ...(drawer && indiaDate(drawer.openedAt) < today
      ? [
          {
            icon: "alert-circle-outline",
            text: hi
              ? `दराज़ ${dayLabel(indiaDate(drawer.openedAt), hi)} से खुली है — गिनकर बंद करें`
              : `The drawer has been open since ${dayLabel(indiaDate(drawer.openedAt))}; count and close it`,
            page: "money",
            alert: true,
          },
        ]
      : sinceCount && sinceCount > 4 * 3_600_000
        ? [
            {
              icon: "time-outline",
              text: hi
                ? `${Math.floor(sinceCount / 3_600_000)} घंटे से नकदी नहीं गिनी गई`
                : `Cash not counted for ${Math.floor(sinceCount / 3_600_000)} hours`,
              page: "money",
            },
          ]
        : []),
    ...(drawer?.openingDifferencePaise
      ? [
          {
            icon: "moon-outline",
            text:
              indiaDate(drawer.openedAt) === today
                ? hi
                  ? `आज खोलते समय पिछली बार छोड़ी नकदी से ${differenceText(drawer.openingDifferencePaise)}`
                  : `Today's opening was ${differenceText(drawer.openingDifferencePaise)} against the cash left at the last close`
                : hi
                  ? `${dayLabel(indiaDate(drawer.openedAt), hi)} खोलते समय पिछली बार छोड़ी नकदी से ${differenceText(drawer.openingDifferencePaise)}`
                  : `The opening on ${dayLabel(indiaDate(drawer.openedAt))} was ${differenceText(drawer.openingDifferencePaise)} against the cash left at the last close`,
            page: "money",
            alert: drawer.openingDifferencePaise < 0,
          },
        ]
      : []),
    ...(lastClose?.discrepancyPaise
      ? [
          {
            icon: "wallet-outline",
            text: hi
              ? `आख़िरी बार बंद करते समय दराज़ ${differenceText(lastClose.discrepancyPaise)}`
              : `The last close was ${differenceText(lastClose.discrepancyPaise)}`,
            page: "money",
            alert: lastClose.discrepancyPaise < 0,
          },
        ]
      : []),
    ...(r.pendingDevices
      ? [
          {
            icon: "sync-outline",
            text: hi
              ? `${r.pendingDevices} फ़ोन पर बिक्री भेजनी बाकी`
              : `${r.pendingDevices} ${r.pendingDevices === 1 ? "phone has" : "phones have"} sales not yet sent`,
            page: "reviews",
          },
        ]
      : []),
    // A registered phone that has gone quiet holds every day report as provisional.
    ...Object.values(state.devices)
      .filter(
        (d) =>
          !d.revoked &&
          Date.now() - Date.parse(d.lastSeen) > 24 * 3_600_000 &&
          d.id !== s.identity?.deviceId,
      )
      .map((d) => ({
        icon: "phone-portrait-outline",
        text: hi
          ? `${deviceLabel(state, d)} ${dayLabel(indiaDate(d.lastSeen), hi)} से नहीं दिखा; रिपोर्ट उसका इंतज़ार कर रही हैं। इस्तेमाल न हो तो हटाएँ।`
          : `${deviceLabel(state, d)} not seen since ${dayLabel(indiaDate(d.lastSeen))}; reports wait for it. Revoke it if it is no longer used.`,
        page: "administration",
        alert: d.pendingCount > 0,
      })),
    ...(openReviews
      ? [
          {
            icon: "shield-checkmark-outline",
            text: hi
              ? `${openReviews} जाँच खुली हैं`
              : `${openReviews} ${openReviews === 1 ? "exception is" : "exceptions are"} open`,
            page: "reviews",
          },
        ]
      : []),
    ...(expiring
      ? [
          {
            icon: "hourglass-outline",
            text: hi
              ? `${expiring} बैच 90 दिन में एक्सपायर`
              : `${expiring} ${expiring === 1 ? "batch expires" : "batches expire"} within 90 days`,
            page: "inventory",
          },
        ]
      : []),
    ...(low
      ? [
          {
            icon: "cube-outline",
            text: hi
              ? `${low} दवाएँ दोबारा मँगाने के स्तर पर`
              : `${low} ${low === 1 ? "medicine is" : "medicines are"} at reorder level`,
            page: "inventory",
          },
        ]
      : []),
  ];
  const closes = Object.values(state.drawers)
    .filter((d) => d.closedAt)
    .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))
    .slice(0, 7);
  const invoices = Object.values(state.invoices)
    .filter((i) => indiaDate(i.occurredAt) === date)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return (
    <Page
      title={t("overview")}
      subtitle={
        hi
          ? "नकदी, बिक्री और स्टाफ़ एक नज़र में।"
          : "Cash, sales and staff at a glance."
      }
    >
      <Pressable
        onPress={() => navigate("money")}
        style={{
          backgroundColor: colors.accent,
          borderRadius: 16,
          padding: 24,
          marginBottom: 22,
        }}
      >
        {drawer ? (
          <>
            <Txt style={{ color: "#BFE1CE" }} size={12}>
              {hi ? "दराज़ में होना चाहिए" : "Should be in the drawer now"}
            </Txt>
            <Txt
              size={40}
              bold
              style={{ color: "white", marginTop: 8, letterSpacing: -1.2 }}
            >
              {rupees(expectedCash(state, drawer.id))}
            </Txt>
            <Txt size={12} style={{ color: "#BFE1CE", marginTop: 8 }}>
              {lastCount
                ? hi
                  ? `आख़िरी गिनती ${clock(lastCount.at)} · ${state.members[lastCount.by]?.name ?? ""} · ${differenceText(lastCount.differencePaise)}`
                  : `Last counted ${clock(lastCount.at)} by ${state.members[lastCount.by]?.name ?? "someone"}: ${differenceText(lastCount.differencePaise)}`
                : hi
                  ? `${indiaDate(drawer.openedAt) !== today ? `${dayLabel(indiaDate(drawer.openedAt), hi)} ` : ""}${clock(drawer.openedAt)} पर खुली · अभी गिनी नहीं`
                  : `Opened ${indiaDate(drawer.openedAt) !== today ? `${dayLabel(indiaDate(drawer.openedAt))} ` : ""}${clock(drawer.openedAt)} · not counted since`}
            </Txt>
          </>
        ) : (
          <>
            <Txt style={{ color: "#BFE1CE" }} size={12}>
              {hi ? "दराज़ बंद है" : "The drawer is closed"}
            </Txt>
            <Txt size={20} bold style={{ color: "white", marginTop: 8 }}>
              {lastClose
                ? `${hi ? "आख़िरी बार" : "Last close"}: ${differenceText(lastClose.discrepancyPaise)}`
                : hi
                  ? "पहली बिक्री से पहले खोलें"
                  : "Open it before the first cash sale"}
            </Txt>
          </>
        )}
      </Pressable>
      <Row style={{ marginBottom: 16 }}>
        <Chip active={day === "today"} onPress={() => setDay("today")}>
          {t("today")}
        </Chip>
        <Chip active={day === "yesterday"} onPress={() => setDay("yesterday")}>
          {hi ? "कल" : "Yesterday"}
        </Chip>
      </Row>
      <View style={[styles.panel, { marginBottom: 22 }]}>
        <Txt muted size={12}>
          {hi ? "शुद्ध बिक्री" : "Net sales"}
        </Txt>
        <Txt size={32} bold style={{ marginTop: 6 }}>
          {rupees(r.sales.netPaise)}
        </Txt>
        <Txt muted size={12} style={{ marginTop: 6 }}>
          {r.sales.bills} {hi ? "बिल" : r.sales.bills === 1 ? "bill" : "bills"}
          {r.sales.returnsPaise
            ? ` · ${hi ? "वापसी" : "returns"} ${rupees(r.sales.returnsPaise)}`
            : ""}
          {r.sales.discountsPaise
            ? ` · ${hi ? "छूट" : "discounts"} ${rupees(r.sales.discountsPaise)}`
            : ""}
        </Txt>
        <Row
          style={{ justifyContent: "space-between", marginTop: 16, gap: 12 }}
        >
          {[
            [hi ? "नकद" : "Cash", r.sales.cashPaise],
            ["UPI", r.sales.upiPaise],
            [hi ? "उधार" : "Credit", r.sales.creditPaise],
          ].map(([label, value]) => (
            <View key={String(label)}>
              <Txt size={11} muted>
                {label}
              </Txt>
              <Txt size={18} bold style={{ marginTop: 4 }}>
                {rupees(Number(value))}
              </Txt>
            </View>
          ))}
        </Row>
      </View>
      {attention.length > 0 && (
        <Section title={hi ? "ध्यान दें" : "Needs attention"}>
          {attention.map((a) => (
            <Pressable
              key={a.text}
              onPress={() => navigate(a.page)}
              style={styles.listRow}
            >
              <Row>
                <Icon
                  name={a.icon}
                  color={a.alert ? colors.amber : colors.muted}
                />
                <Txt
                  bold={a.alert}
                  style={{
                    flex: 1,
                    color: a.alert ? colors.amber : colors.ink,
                  }}
                >
                  {a.text}
                </Txt>
                <Icon name="chevron-forward" />
              </Row>
            </Pressable>
          ))}
        </Section>
      )}
      <Section title={hi ? "स्टाफ़" : "Staff"}>
        {r.staff.map((p) => (
          <View key={p.id} style={styles.listRow}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt bold>{p.name}</Txt>
              <Txt bold>{rupees(p.salesPaise)}</Txt>
            </Row>
            <Txt muted size={12} style={{ marginTop: 5 }}>
              {[
                `${p.bills} ${hi ? "बिल" : p.bills === 1 ? "bill" : "bills"}`,
                `${hi ? "नकद" : "cash"} ${rupees(p.cashInPaise)}`,
                `UPI ${rupees(p.upiInPaise)}`,
                p.creditGivenPaise
                  ? `${hi ? "उधार" : "credit"} ${rupees(p.creditGivenPaise)}`
                  : "",
                p.discountsPaise
                  ? `${hi ? "छूट" : "discount"} ${rupees(p.discountsPaise)}`
                  : "",
                p.refundsPaise
                  ? `${hi ? "वापसी दी" : "refunded"} ${rupees(p.refundsPaise)}`
                  : "",
                p.cancelled
                  ? `${p.cancelled} ${hi ? "रद्द" : "cancelled"}`
                  : "",
                p.cashOutPaise
                  ? `${hi ? "दराज़ से निकाले" : "paid out"} ${rupees(p.cashOutPaise)}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Txt>
          </View>
        ))}
        {!r.staff.length && (
          <Txt muted>{hi ? "अभी कोई गतिविधि नहीं" : "No activity yet"}</Txt>
        )}
      </Section>
      {closes.length > 0 && (
        <Section title={hi ? "पिछली दराज़ गिनतियाँ" : "Recent drawer closes"}>
          {closes.map((d) => (
            <Row
              key={d.id}
              style={[styles.listRow, { justifyContent: "space-between" }]}
            >
              <Txt>
                {dayLabel(indiaDate(d.closedAt!), hi)} ·{" "}
                {state.members[d.closedBy ?? ""]?.name ?? ""}
              </Txt>
              <Txt bold style={{ color: differenceColour(d.discrepancyPaise) }}>
                {differenceText(d.discrepancyPaise)}
              </Txt>
            </Row>
          ))}
        </Section>
      )}
      {operations && (
        <Section title="Shop infrastructure">
          <Txt>
            {operations.gateway?.reachableRecently
              ? "Gateway reachable"
              : "Gateway unavailable or not paired"}
          </Txt>
          <Txt muted>
            Printer:{" "}
            {operations.gateway?.details.printerConfigured
              ? "Configured"
              : "Not configured"}{" "}
            · {operations.gateway?.details.uncertainPrints ?? 0} uncertain jobs
          </Txt>
        </Section>
      )}
      <Section title={hi ? "हाल के बिल" : "Recent sales"}>
        {invoices.slice(0, 8).map((i) => (
          <Row
            key={i.id}
            style={[styles.listRow, { justifyContent: "space-between" }]}
          >
            <View>
              <Txt bold>{i.number}</Txt>
              <Txt muted size={12} style={{ marginTop: 4 }}>
                {itemCount(i.lines.length, s.language)} · {clock(i.occurredAt)}{" "}
                · {state.members[i.collectorId]?.name ?? ""}
              </Txt>
            </View>
            <Txt bold>{rupees(i.totalPaise)}</Txt>
          </Row>
        ))}
        {!invoices.length && (
          <Empty
            title={hi ? "अभी कोई बिल नहीं" : "No bills yet"}
            detail={
              hi ? "पूरे हुए बिल यहाँ दिखेंगे।" : "Completed bills appear here."
            }
          />
        )}
      </Section>
    </Page>
  );
}
export function OrdersScreen({
  onInvoice,
}: {
  onInvoice: (i: Invoice) => void;
}) {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    run = useRun();
  const [filter, setFilter] = useState("open"),
    [selected, setSelected] = useState<Order | null>(null),
    [handoff, setHandoff] = useState<Order | null>(null),
    [cancelling, setCancelling] = useState<Order | null>(null),
    [cancelReason, setCancelReason] = useState(""),
    [discount, setDiscount] = useState("");
  const [returnInvoice, setReturnInvoice] = useState<Invoice | null>(null),
    [refunding, setRefunding] = useState<Approval | null>(null),
    [billQuery, setBillQuery] = useState("");
  const me = s.identity!.actor,
    hi = s.language === "hi";
  /** The latest credit or discount request on an order, if any. */
  const orderRequest = (o: Order) =>
    Object.values(state.approvals)
      .filter(
        (a) =>
          (a.kind === "credit" || a.kind === "discount") &&
          a.payload.orderId === o.id &&
          a.status !== "used",
      )
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  const returnRequest = (i: Invoice) =>
    Object.values(state.approvals)
      .filter((a) => a.kind === "refund" && a.payload.invoiceId === i.id)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  const q = billQuery.trim().toLowerCase();
  const bills = Object.values(state.invoices)
    .filter(
      (i) =>
        !q ||
        i.number.toLowerCase().includes(q) ||
        i.lines.some((l) => l.name.toLowerCase().includes(q)) ||
        state.customers[i.customerId ?? ""]?.name.toLowerCase().includes(q),
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const open = Object.values(state.orders).filter(
    (o) => o.status === "held" || o.status === "handoff",
  );
  const cancelled = Object.values(state.orders)
    .filter((o) => o.status === "cancelled")
    .sort((a, b) => (b.cancelledAt ?? "").localeCompare(a.cancelledAt ?? ""));
  const act = (
    type: "order.accept" | "order.decline" | "order.recall",
    o: Order,
  ) => void run(() => s.command({ type, orderId: o.id, version: o.version }));
  return (
    <Page
      title={t("orders")}
      subtitle="Held orders, handoffs, and completed bills."
    >
      <Row style={{ marginBottom: 20 }}>
        <Chip active={filter === "open"} onPress={() => setFilter("open")}>
          {hi ? "खुले" : "Open"} · {open.length}
        </Chip>
        <Chip active={filter === "bills"} onPress={() => setFilter("bills")}>
          Completed
        </Chip>
        {cancelled.length > 0 && (
          <Chip
            active={filter === "cancelled"}
            onPress={() => setFilter("cancelled")}
          >
            Cancelled · {cancelled.length}
          </Chip>
        )}
      </Row>
      {filter === "cancelled" &&
        cancelled.map((o) => (
          <View key={o.id} style={styles.listRow}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt bold>Order {o.id.slice(0, 8)}</Txt>
              <Txt muted size={12}>
                {o.cancelledAt
                  ? new Date(o.cancelledAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : ""}
              </Txt>
            </Row>
            <Txt muted size={12} style={{ marginTop: 5 }}>
              {orderSummary(state, o)
                .lines.map((l) => l.name)
                .join(", ")}{" "}
              · {state.members[o.collectorId]?.name}
            </Txt>
            <Txt size={12} style={{ marginTop: 5 }}>
              {o.cancelReason}
            </Txt>
          </View>
        ))}
      {filter === "open"
        ? open.map((o) => (
            <View key={o.id} style={styles.listRow}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Txt bold>Order {o.id.slice(0, 8)}</Txt>
                  <Txt size={13} style={{ marginTop: 5 }}>
                    {orderSummary(state, o)
                      .lines.map((l) => l.name)
                      .join(", ")}
                  </Txt>
                  <Txt muted size={12} style={{ marginTop: 4 }}>
                    {rupees(orderSummary(state, o).totalPaise)} ·{" "}
                    {state.members[o.dispenserId]?.name}
                  </Txt>
                </View>
                <Badge warning={o.status === "handoff"}>
                  {o.status === "handoff" ? "Handoff pending" : "Held"}
                </Badge>
              </Row>
              {o.status === "handoff" && (
                <Txt muted size={12} style={{ marginTop: 8 }}>
                  Offered to{" "}
                  {state.members[o.offeredTo ?? ""]?.name ?? "a cashier"}
                </Txt>
              )}
              {(() => {
                const a = orderRequest(o);
                if (!a) return null;
                const what =
                  a.kind === "credit"
                    ? hi
                      ? "उधार"
                      : "Credit"
                    : hi
                      ? "छूट"
                      : "Discount";
                const amount = rupees(Number(a.payload.amountPaise));
                return (
                  <Txt
                    size={12}
                    bold
                    style={{
                      marginTop: 8,
                      color:
                        a.status === "approved"
                          ? colors.accent
                          : a.status === "rejected"
                            ? colors.red
                            : colors.amber,
                    }}
                  >
                    {a.status === "pending"
                      ? hi
                        ? `${what} ${amount} · मालिक की मंज़ूरी बाकी`
                        : `${what} ${amount} · waiting for the owner`
                      : a.status === "approved"
                        ? hi
                          ? `${what} ${amount} मंज़ूर · पैसे लेते समय लागू होगा`
                          : `${what} ${amount} approved · applied when you collect`
                        : hi
                          ? `${what} ${amount} मना किया गया`
                          : `${what} ${amount} declined by the owner`}
                  </Txt>
                );
              })()}
              <Row style={{ marginTop: 14, flexWrap: "wrap" }}>
                {o.status === "handoff" && o.offeredTo === me.id ? (
                  <>
                    <Button small onPress={() => act("order.accept", o)}>
                      Accept handoff
                    </Button>
                    <Button
                      secondary
                      small
                      onPress={() => act("order.decline", o)}
                    >
                      Decline
                    </Button>
                  </>
                ) : o.status === "handoff" && o.collectorId === me.id ? (
                  <Button
                    secondary
                    small
                    onPress={() => act("order.recall", o)}
                  >
                    Take back
                  </Button>
                ) : o.status === "held" && o.collectorId === me.id ? (
                  <>
                    <Button small onPress={() => setSelected(o)}>
                      Collect payment
                    </Button>
                    <Button secondary small onPress={() => setHandoff(o)}>
                      Hand to cashier
                    </Button>
                    <Button
                      secondary
                      small
                      onPress={() => {
                        setCancelReason("");
                        setCancelling(o);
                      }}
                    >
                      Cancel order
                    </Button>
                  </>
                ) : me.role === "owner" ? (
                  <Button
                    secondary
                    small
                    onPress={() => act("order.recall", o)}
                  >
                    Take over
                  </Button>
                ) : (
                  <Txt muted size={12}>
                    Awaiting the assigned collector.
                  </Txt>
                )}
              </Row>
            </View>
          ))
        : filter === "bills" && (
            <>
              <Field
                value={billQuery}
                onChange={setBillQuery}
                placeholder="Find bill by number, medicine or customer"
              />
              {bills.slice(0, 30).map((i) => {
                const refunded = Object.values(state.refunds)
                  .filter((r) => r.invoiceId === i.id)
                  .reduce((n, r) => n + r.totalPaise, 0);
                const request = returnRequest(i);
                const fully = returnable(state, i).every((r) =>
                  r.remaining.lte(0),
                );
                const mine =
                  request?.requestedBy === me.id || me.role === "owner";
                return (
                  <View key={i.id} style={styles.listRow}>
                    <Row style={{ justifyContent: "space-between" }}>
                      <Pressable
                        onPress={() => onInvoice(i)}
                        style={{ flex: 1, marginRight: 12 }}
                      >
                        <Txt bold>{i.number}</Txt>
                        <Txt size={12} muted style={{ marginTop: 5 }}>
                          {i.lines.map((l) => l.name).join(", ")}
                          {i.customerId && state.customers[i.customerId]
                            ? ` · ${state.customers[i.customerId].name}`
                            : ""}
                        </Txt>
                      </Pressable>
                      <Txt bold>{rupees(i.totalPaise)}</Txt>
                    </Row>
                    {refunded > 0 && (
                      <Txt size={12} style={{ marginTop: 6 }}>
                        {hi
                          ? `वापसी ${rupees(refunded)}`
                          : `Returned ${rupees(refunded)}`}
                      </Txt>
                    )}
                    {request?.status === "pending" ? (
                      <Txt
                        size={12}
                        bold
                        style={{ marginTop: 8, color: colors.amber }}
                      >
                        {hi
                          ? "वापसी मालिक की मंज़ूरी का इंतज़ार कर रही है"
                          : "Return waiting for the owner"}
                      </Txt>
                    ) : request?.status === "approved" && mine ? (
                      <View style={{ marginTop: 10 }}>
                        <Button small onPress={() => setRefunding(request)}>
                          {hi
                            ? "मंज़ूर वापसी · पैसे लौटाएँ"
                            : "Return approved · Give refund"}
                        </Button>
                      </View>
                    ) : fully ? null : (
                      <Pressable
                        onPress={() => setReturnInvoice(i)}
                        style={{ paddingTop: 12 }}
                      >
                        <Txt size={12} style={{ color: colors.accent }}>
                          {request?.status === "rejected"
                            ? hi
                              ? "पिछली वापसी मना हुई · फिर माँगें"
                              : "Last return declined · Request again"
                            : hi
                              ? "वापसी माँगें"
                              : "Request return"}
                        </Txt>
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {bills.length > 30 && (
                <Txt size={11} muted>
                  {hi
                    ? `${bills.length} में से 30 दिख रहे हैं · खोजें`
                    : `Showing 30 of ${bills.length} · search to find others`}
                </Txt>
              )}
            </>
          )}
      {filter === "open" && !open.length && (
        <Empty
          title="No open orders"
          detail="Hold a basket or hand an order to a cashier to continue it here."
        />
      )}
      <Sheet
        visible={!!selected}
        title="Collect payment"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <OrderLines order={selected} />
            <Checkout
              existingOrderId={selected.id}
              lines={selected.lines}
              onComplete={(i) => {
                setSelected(null);
                onInvoice(i);
              }}
              onHeld={() => setSelected(null)}
            />
            <View style={{ height: 24 }} />
            <Field
              label="Request discount (₹)"
              value={discount}
              onChange={setDiscount}
              number
            />
            <Button
              secondary
              onPress={() =>
                void run(async () => {
                  await s.command({
                    type: "approval.request",
                    approvalId: uid(),
                    kind: "discount",
                    payload: {
                      orderId: selected.id,
                      orderVersion: selected.version,
                      amountPaise: money(discount),
                    },
                    reason: "Customer discount request",
                  });
                  setSelected(null);
                })
              }
            >
              Ask owner to approve discount
            </Button>
          </>
        )}
      </Sheet>
      <Sheet
        visible={!!handoff}
        title="Choose a cashier"
        onClose={() => setHandoff(null)}
      >
        {Object.values(state.members)
          .filter(
            (m) =>
              m.active &&
              m.canCollect &&
              m.id !== s.identity!.actor.id &&
              !m.id.startsWith("service:"),
          )
          .map((m) => (
            <Pressable
              key={m.id}
              onPress={() =>
                void run(async () => {
                  await s.command({
                    type: "order.offer",
                    orderId: handoff!.id,
                    to: m.id,
                    version: handoff!.version,
                  });
                  setHandoff(null);
                })
              }
              style={styles.listRow}
            >
              <Txt bold>{m.name}</Txt>
            </Pressable>
          ))}
      </Sheet>
      <Sheet
        visible={!!cancelling}
        title="Cancel order"
        onClose={() => setCancelling(null)}
      >
        <Txt muted size={12} style={{ marginBottom: 12 }}>
          Only for an unbilled order the customer did not take. The cancellation
          and reason are recorded.
        </Txt>
        <Field
          label="Reason for cancelling"
          value={cancelReason}
          onChange={setCancelReason}
        />
        <Button
          disabled={cancelReason.trim().length < 3}
          onPress={() =>
            void run(async () => {
              await s.command({
                type: "order.cancel",
                orderId: cancelling!.id,
                version: cancelling!.version,
                reason: cancelReason.trim(),
              });
              setCancelling(null);
            })
          }
        >
          Cancel order
        </Button>
      </Sheet>
      <Sheet
        visible={!!returnInvoice}
        title="Request return"
        onClose={() => setReturnInvoice(null)}
      >
        {returnInvoice && (
          <ReturnForm
            invoice={returnInvoice}
            onDone={() => setReturnInvoice(null)}
          />
        )}
      </Sheet>
      <Sheet
        visible={!!refunding}
        title="Give refund"
        onClose={() => setRefunding(null)}
      >
        {refunding && (
          <RefundForm approval={refunding} onDone={() => setRefunding(null)} />
        )}
      </Sheet>
    </Page>
  );
}
export function CustomersScreen() {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    run = useRun();
  const [add, setAdd] = useState(false),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [address, setAddress] = useState(""),
    [selected, setSelected] = useState(""),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState<"cash" | "upi">("cash"),
    [ref, setRef] = useState(""),
    [verified, setVerified] = useState(false);
  // A closed form starts empty next time, so nothing is added twice by accident.
  const closeAdd = () => {
    setAdd(false);
    setName("");
    setPhone("");
    setAddress("");
  };
  return (
    <Page
      title={t("customers")}
      subtitle="Credit belongs to a customer. Repayments are not new sales."
      action={
        <Button small icon="add" onPress={() => setAdd(true)}>
          Add
        </Button>
      }
    >
      {Object.values(state.customers)
        // Customers who owe come first, largest balance first.
        .map((c) => ({ c, owes: balance(state, c.id) }))
        .sort((a, b) => b.owes - a.owes || a.c.name.localeCompare(b.c.name))
        .map(({ c }) => c)
        .map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setSelected(c.id)}
            style={styles.listRow}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <Row>
                <View
                  style={{
                    backgroundColor: colors.tint,
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Txt bold>{c.name[0]}</Txt>
                </View>
                <View>
                  <Txt bold>{c.name}</Txt>
                  <Txt size={12} muted style={{ marginTop: 4 }}>
                    {c.phone || "No phone recorded"}
                  </Txt>
                </View>
              </Row>
              <View style={{ alignItems: "flex-end" }}>
                {balance(state, c.id) > 0 ? (
                  <>
                    <Txt bold style={{ color: colors.amber }}>
                      {rupees(balance(state, c.id))}
                    </Txt>
                    <Txt size={10} muted>
                      {s.language === "hi" ? "बाकी" : "owes"}
                    </Txt>
                  </>
                ) : (
                  <Txt size={12} muted>
                    {s.language === "hi" ? "कुछ बाकी नहीं" : "Nothing owed"}
                  </Txt>
                )}
              </View>
            </Row>
          </Pressable>
        ))}
      <Sheet visible={add} title="Add customer" onClose={() => closeAdd()}>
        <Field label={t("name")} value={name} onChange={setName} />
        <Field label={t("phone")} value={phone} onChange={setPhone} number />
        <Field label={t("address")} value={address} onChange={setAddress} />
        <Button
          disabled={!name.trim()}
          onPress={() =>
            void run(async () => {
              await s.command({
                type: "customer.create",
                customer: {
                  id: uid(),
                  name: name.trim(),
                  phone: phone.trim(),
                  address: address.trim(),
                },
              });
              closeAdd();
            })
          }
        >
          Save customer
        </Button>
      </Sheet>
      <Sheet
        visible={!!selected}
        title={state.customers[selected]?.name ?? ""}
        onClose={() => setSelected("")}
      >
        {selected && (
          <>
            <Txt muted size={12}>
              {s.language === "hi" ? "बाकी" : "Owes"}
            </Txt>
            <Txt size={30} bold style={{ marginBottom: 20 }}>
              {rupees(balance(state, selected))}
            </Txt>
            <Field
              label="Repayment amount (₹)"
              value={amount}
              onChange={setAmount}
              number
            />
            {balance(state, selected) > 0 && (
              <Row style={{ marginBottom: 12 }}>
                <Chip
                  active={
                    amount === (balance(state, selected) / 100).toString()
                  }
                  onPress={() =>
                    setAmount((balance(state, selected) / 100).toString())
                  }
                >
                  {s.language === "hi" ? "पूरा बाकी" : "Full amount"}{" "}
                  {rupees(balance(state, selected))}
                </Chip>
              </Row>
            )}
            <Row style={{ marginBottom: 20 }}>
              <Chip
                active={method === "cash"}
                onPress={() => setMethod("cash")}
              >
                {t("cash")}
              </Chip>
              <Chip active={method === "upi"} onPress={() => setMethod("upi")}>
                {t("upi")}
              </Chip>
            </Row>
            {method === "upi" && (
              <>
                <Field
                  label="Merchant transaction reference"
                  value={ref}
                  onChange={setRef}
                />
                <Pressable
                  onPress={() => setVerified(!verified)}
                  style={{ marginBottom: 20 }}
                >
                  <Row>
                    <Icon name={verified ? "checkbox" : "square-outline"} />
                    <Txt>Verified in merchant app</Txt>
                  </Row>
                </Pressable>
              </>
            )}
            <Button
              onPress={() =>
                void run(async () => {
                  await s.command({
                    type: "credit.repay",
                    customerId: selected,
                    amountPaise: money(amount),
                    method,
                    reference: ref,
                    verified,
                  });
                  setAmount("");
                })
              }
            >
              Record repayment
            </Button>
            <View style={{ height: 25 }} />
            <Txt bold>Account history</Txt>
            {Object.values(state.ledger)
              .filter((l) => l.customerId === selected)
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
              .map((l) => {
                const hi = s.language === "hi";
                const bill = state.invoices[l.invoiceId ?? ""]?.number;
                const what =
                  l.kind === "credit_sale"
                    ? hi
                      ? "उधार बिक्री"
                      : "Credit sale"
                    : l.kind === "repayment"
                      ? hi
                        ? "भुगतान मिला"
                        : "Paid back"
                      : hi
                        ? "वापसी से कम"
                        : "Reduced by a return";
                return (
                  <Row
                    key={l.id}
                    style={[
                      styles.listRow,
                      { justifyContent: "space-between" },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt size={13}>{what}</Txt>
                      <Txt size={11} muted style={{ marginTop: 3 }}>
                        {new Date(l.occurredAt).toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          day: "numeric",
                          month: "short",
                        })}
                        {bill ? ` · ${bill}` : ""}
                      </Txt>
                    </View>
                    <Txt
                      bold
                      style={{
                        color: l.amountPaise < 0 ? colors.accent : colors.ink,
                      }}
                    >
                      {l.amountPaise < 0 ? "−" : "+"}
                      {rupees(Math.abs(l.amountPaise))}
                    </Txt>
                  </Row>
                );
              })}
          </>
        )}
      </Sheet>
    </Page>
  );
}
export function StockScreen({ manage = false }: { manage?: boolean }) {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    run = useRun();
  const [search, setSearch] = useState(""),
    [editing, setEditing] = useState<Product | null | undefined>(),
    [batchProduct, setBatchProduct] = useState<Product | null>(null),
    [purchase, setPurchase] = useState(false),
    [importing, setImporting] = useState(false),
    [counting, setCounting] = useState(false),
    [adjust, setAdjust] = useState<Batch | null>(null),
    [delta, setDelta] = useState(""),
    [reason, setReason] = useState(""),
    [kind, setKind] = useState<
      | "correction"
      | "damage"
      | "expiry"
      | "supplier_return"
      | "release"
      | "quarantine_disposal"
    >("correction");
  const batchesByProduct = useMemo(
    () => groupBatches(state.batches),
    [state.batches],
  );
  const matching = useMemo(() => {
    return Object.values(state.products)
      .filter((p) => matchesSearch(p, search))
      .sort(bySearch(search));
  }, [state.products, search]);
  return (
    <Page
      title={manage ? t("inventory") : t("stock")}
      subtitle="Batch-level stock, expiry, and verified physical counts."
      action={
        manage ? (
          <Button
            small
            onPress={() => setPurchase(true)}
            icon="document-text-outline"
          >
            Receive stock
          </Button>
        ) : undefined
      }
    >
      <Field value={search} onChange={setSearch} placeholder={t("search")} />
      {manage && (
        <Row style={{ marginBottom: 18, flexWrap: "wrap" }}>
          <Button small secondary onPress={() => setEditing(null)} icon="add">
            Add medicine
          </Button>
          <Button
            small
            secondary
            onPress={() => setImporting(true)}
            icon="cloud-upload-outline"
          >
            Import catalogue
          </Button>
          <Button
            small
            secondary
            onPress={() => setCounting(true)}
            icon="clipboard-outline"
          >
            Count stock
          </Button>
        </Row>
      )}
      {matching.length > SHOWN_PRODUCTS && (
        <Txt size={11} muted style={{ marginBottom: 12 }}>
          {s.language === "hi"
            ? `${matching.length.toLocaleString("en-IN")} में से ${SHOWN_PRODUCTS} दिख रहे हैं · खोजकर ढूँढें`
            : `Showing ${SHOWN_PRODUCTS} of ${matching.length.toLocaleString("en-IN")} · search to find others`}
        </Txt>
      )}
      {matching.slice(0, SHOWN_PRODUCTS).map((p) => (
        <View key={p.id} style={{ marginBottom: 24 }}>
          <Row style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <Txt bold size={17}>
              {p.name} <Txt muted>{p.strength}</Txt>
            </Txt>
            {manage && (
              <Pressable onPress={() => setEditing(p)}>
                <Icon name="create-outline" />
              </Pressable>
            )}
          </Row>
          {(batchesByProduct.get(p.id) ?? []).map((b) => (
            <Pressable
              key={b.id}
              onPress={() => {
                setAdjust(b);
                setDelta("");
              }}
              style={styles.listRow}
            >
              <Row style={{ justifyContent: "space-between" }}>
                <View>
                  <Txt size={12} bold>
                    {b.code} · {b.expiry}
                  </Txt>
                  <Txt size={11} muted style={{ marginTop: 5 }}>
                    {rupees(b.pricePaise)} / {p.baseUnit} · {b.quarantined}{" "}
                    quarantined
                  </Txt>
                </View>
                <Badge
                  warning={
                    Number(b.quantity) <= Number(p.reorderAt) ||
                    b.expiry < indiaDate(new Date().toISOString())
                  }
                >
                  {b.quantity} {p.baseUnit}
                </Badge>
              </Row>
            </Pressable>
          ))}
          {manage && (
            <Pressable
              onPress={() => setBatchProduct(p)}
              style={{ paddingVertical: 12 }}
            >
              <Txt size={11} style={{ color: colors.accent }}>
                + Record opening batch count
              </Txt>
            </Pressable>
          )}
        </View>
      ))}
      <Sheet
        visible={editing !== undefined}
        title={editing ? "Edit medicine" : "Add medicine"}
        onClose={() => setEditing(undefined)}
      >
        {editing !== undefined && (
          <ProductForm product={editing} onDone={() => setEditing(undefined)} />
        )}
      </Sheet>
      <Sheet
        visible={!!batchProduct}
        title="Physical opening count"
        onClose={() => setBatchProduct(null)}
      >
        {batchProduct && (
          <CountForm
            product={batchProduct}
            onSaved={() => setBatchProduct(null)}
          />
        )}
      </Sheet>
      <Sheet
        visible={!!adjust}
        title="Request stock adjustment"
        onClose={() => setAdjust(null)}
      >
        {adjust && (
          <>
            {manage && <PriceForm batch={adjust} />}
            <Txt muted style={{ marginBottom: 18 }}>
              {adjust.code} · Recorded stock {adjust.quantity}
            </Txt>
            <Row style={{ flexWrap: "wrap", marginBottom: 18 }}>
              {(
                [
                  "correction",
                  "damage",
                  "expiry",
                  "supplier_return",
                  "release",
                  "quarantine_disposal",
                ] as const
              ).map((k) => (
                <Chip key={k} active={kind === k} onPress={() => setKind(k)}>
                  {k.replace("_", " ")}
                </Chip>
              ))}
            </Row>
            <Field
              label="Change in base units (negative to remove)"
              value={delta}
              onChange={setDelta}
            />
            <Field label={t("reason")} value={reason} onChange={setReason} />
            <Button
              onPress={() =>
                void run(async () => {
                  await s.command({
                    type: "approval.request",
                    approvalId: uid(),
                    kind: "stock",
                    payload: {
                      batchId: adjust.id,
                      quantity: delta,
                      kind,
                      reason,
                    },
                    reason,
                  });
                  setAdjust(null);
                })
              }
            >
              Request owner approval
            </Button>
          </>
        )}
      </Sheet>
      <Sheet
        visible={purchase}
        title="Receive supplier invoice"
        onClose={() => setPurchase(false)}
      >
        {purchase && <PurchaseForm onDone={() => setPurchase(false)} />}
      </Sheet>
      <Sheet
        visible={counting}
        title="Count stock"
        onClose={() => setCounting(false)}
      >
        {counting && <StockCount />}
      </Sheet>
      <Sheet
        visible={importing}
        title="Import catalogue"
        onClose={() => setImporting(false)}
      >
        {importing && <CatalogueImport onDone={() => setImporting(false)} />}
      </Sheet>
    </Page>
  );
}
function PriceForm({ batch }: { batch: Batch }) {
  const s = useSession(),
    run = useRun();
  const [price, P] = useState(String(batch.pricePaise / 100)),
    [reason, R] = useState("");
  return (
    <View style={{ marginBottom: 24 }}>
      <Txt bold>Owner price update</Txt>
      <Field
        label="Selling price per base unit (₹)"
        value={price}
        onChange={P}
        number
      />
      <Field label="Reason" value={reason} onChange={R} />
      <Button
        secondary
        disabled={reason.length < 3}
        onPress={() =>
          void run(() =>
            s.command({
              type: "batch.price",
              batchId: batch.id,
              pricePaise: money(price),
              reason,
            }),
          )
        }
      >
        Update selling price
      </Button>
    </View>
  );
}
export function MoneyScreen() {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    run = useRun(),
    hi = s.language === "hi";
  const [open, setOpen] = useState<string | null>(null);
  const today = indiaDate(new Date().toISOString());
  const eods = Object.values(state.eods).sort(
    (a, b) => b.date.localeCompare(a.date) || b.revision - a.revision,
  );
  // The latest revision of each day, newest day first.
  const days = eods.filter(
    (e, i) => eods.findIndex((x) => x.date === e.date) === i,
  );
  const selected = open && open !== "live" ? state.eods[open] : undefined;
  const revisions = selected
    ? eods
        .filter((e) => e.date === selected.date)
        .sort((a, b) => a.revision - b.revision)
    : [];
  const previous = revisions.find(
    (e) => selected && e.revision === selected.revision - 1,
  );
  const closes = Object.values(state.drawers)
    .filter((d) => d.closedAt)
    .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))
    .slice(0, 14);
  return (
    <Page
      title={t("money")}
      subtitle={
        hi
          ? "एक साझा दराज़। हर गिनती और लेन-देन पर नाम दर्ज।"
          : "One shared drawer. Every count and movement carries a name."
      }
    >
      <Section title={hi ? "नकद दराज़" : "Cash drawer"}>
        <DrawerPanel />
      </Section>
      <Section
        title={hi ? "दिन की रिपोर्ट" : "End-of-day reports"}
        action={
          <Button small secondary onPress={() => setOpen("live")}>
            {hi ? "आज अब तक" : "Today so far"}
          </Button>
        }
      >
        {days.map((e) => {
          const drawerDiff = e.report?.drawers.find(
            (d) => d.differencePaise !== undefined,
          )?.differencePaise;
          return (
            <Pressable
              key={e.id}
              onPress={() => setOpen(e.id)}
              style={styles.listRow}
            >
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Txt bold>{dayLabel(e.date, hi)}</Txt>
                  <Txt muted size={12} style={{ marginTop: 4 }}>
                    {hi ? "संस्करण" : "Revision"} {e.revision} ·{" "}
                    {e.provisional
                      ? hi
                        ? "फ़ोन सिंक बाकी"
                        : "waiting for phones"
                      : hi
                        ? "सिंक पूरा"
                        : "synced"}
                    {drawerDiff !== undefined
                      ? ` · ${hi ? "दराज़" : "drawer"} ${differenceText(drawerDiff)}`
                      : ""}
                  </Txt>
                </View>
                <Txt bold>{rupees(e.totals.netSalesPaise)}</Txt>
              </Row>
            </Pressable>
          );
        })}
        {!days.length && (
          <Empty
            title={hi ? "अभी कोई रिपोर्ट नहीं" : "No reports yet"}
            detail={
              hi
                ? "दराज़ बंद करने पर उस दिन की रिपोर्ट बनती है।"
                : "Closing the drawer makes that day's report."
            }
          />
        )}
        <Button
          small
          secondary
          onPress={() =>
            void run(() => s.command({ type: "eod.close", date: today }))
          }
        >
          {hi ? "आज की रिपोर्ट अभी बनाएँ" : "Make today's report now"}
        </Button>
      </Section>
      <Section title={hi ? "दराज़ का इतिहास" : "Drawer history"}>
        {closes.map((d) => (
          <View key={d.id} style={styles.listRow}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt bold>
                {dayLabel(indiaDate(d.closedAt!), hi)} · {clock(d.closedAt)}
              </Txt>
              <Txt bold style={{ color: differenceColour(d.discrepancyPaise) }}>
                {differenceText(d.discrepancyPaise)}
              </Txt>
            </Row>
            <Txt muted size={12} style={{ marginTop: 5 }}>
              {hi ? "गिना" : "Counted"} {rupees(d.countedPaise ?? 0)} ·{" "}
              {hi ? "होना था" : "expected"} {rupees(d.expectedAtClose ?? 0)} ·{" "}
              {state.members[d.closedBy ?? ""]?.name ?? ""}
              {expectedCash(state, d.id) !== d.expectedAtClose
                ? ` · ${hi ? "बाद में बदला" : "changed later by"} ${rupees(expectedCash(state, d.id) - (d.expectedAtClose ?? 0))}`
                : ""}
            </Txt>
          </View>
        ))}
        {!closes.length && (
          <Txt muted>
            {hi ? "अभी कोई बंद दराज़ नहीं" : "No closed drawers yet"}
          </Txt>
        )}
      </Section>
      <Sheet
        visible={!!open}
        title={hi ? "दिन की रिपोर्ट" : "Day report"}
        onClose={() => setOpen(null)}
      >
        {open === "live" && <DayReportView report={dayReport(state, today)} />}
        {selected && (
          <>
            {revisions.length > 1 && (
              <Row style={{ flexWrap: "wrap", marginBottom: 12 }}>
                {revisions.map((e) => (
                  <Chip
                    key={e.id}
                    active={e.id === selected.id}
                    onPress={() => setOpen(e.id)}
                  >
                    {hi ? "संस्करण" : "Revision"} {e.revision}
                  </Chip>
                ))}
              </Row>
            )}
            <DayReportView
              report={selected.report ?? dayReport(state, selected.date)}
              eod={selected}
              previous={previous}
            />
          </>
        )}
      </Sheet>
    </Page>
  );
}
/** "Credit ₹120 · Meera Sharma", "Return on bill 2627-004-000001 · ₹35". */
function approvalTitle(state: State, a: Approval, hi: boolean) {
  const p = a.payload;
  const customer =
    state.customers[
      String(
        p.customerId ??
          state.orders[String(p.orderId)]?.customerId ??
          state.invoices[String(p.invoiceId)]?.customerId ??
          "",
      )
    ]?.name;
  if (a.kind === "refund") {
    const invoice = state.invoices[String(p.invoiceId)];
    let amount = "";
    try {
      amount = invoice
        ? ` · ${rupees(refundQuote(state, invoice, p.lines as ReturnLine[]).payablePaise)}`
        : "";
    } catch {}
    return `${hi ? "वापसी · बिल" : "Return on bill"} ${invoice?.number ?? ""}${amount}`;
  }
  if (a.kind === "stock") return hi ? "स्टॉक बदलाव" : "Stock change";
  const what =
    a.kind === "credit" ? (hi ? "उधार" : "Credit") : hi ? "छूट" : "Discount";
  return `${what} ${rupees(Number(p.amountPaise))}${customer ? ` · ${customer}` : ""}`;
}
function ApprovalDetails({ approval }: { approval: Approval }) {
  const { state } = useSession();
  const p = approval.payload,
    s = state!,
    o = s.orders[String(p.orderId)],
    i = s.invoices[String(p.invoiceId)],
    b = s.batches[String(p.batchId)];
  const customerId = String(
    p.customerId ?? o?.customerId ?? i?.customerId ?? "",
  );
  return (
    <View style={{ gap: 10 }}>
      <Txt muted>Requested by: {s.members[approval.requestedBy]?.name}</Txt>
      {customerId && (
        <Txt bold>
          {s.customers[customerId]?.name} · {s.customers[customerId]?.phone}
        </Txt>
      )}
      {customerId && approval.kind === "credit" && (
        <Txt style={{ color: colors.amber }}>
          {(() => {
            const bills = Object.values(s.invoices).filter(
              (inv) => inv.customerId === customerId && billDue(s, inv.id) > 0,
            );
            const owed = balance(s, customerId);
            return owed > 0
              ? `Already owes ${rupees(owed)} on ${bills.length} bill${bills.length === 1 ? "" : "s"}${bills.length ? `, oldest ${new Date(bills.reduce((a, b) => (a.occurredAt < b.occurredAt ? a : b)).occurredAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}`
              : "Owes nothing today";
          })()}
        </Txt>
      )}
      {typeof p.amountPaise === "number" && (
        <Txt bold size={26}>
          {rupees(p.amountPaise)}
        </Txt>
      )}
      {o && (
        <>
          <Txt muted>
            {new Date(o.createdAt).toLocaleString()} · {o.counterId}
          </Txt>
          {o.lines.map((l, n) => {
            const batch = s.batches[l.batchId],
              product = s.products[batch.productId];
            return (
              <Txt key={n}>
                {product.name} {product.strength} · {l.quantity} {l.unit} ·{" "}
                {batch.code}
              </Txt>
            );
          })}
        </>
      )}
      {i && (
        <>
          <Txt bold>
            {i.number} ·{" "}
            {new Date(i.occurredAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </Txt>
          <Txt muted>Billed by {s.members[i.collectorId]?.name}</Txt>
          {(p.lines as ReturnLine[]).map((l, n) => {
            const item = i.lines[l.index];
            const unit = s.products[item?.productId ?? ""]?.baseUnit ?? "";
            return (
              <Txt key={n}>
                {item?.name} {item?.strength} · {item?.batchCode} ·{" "}
                {amountOf(l.quantity, unit, (x) => x)} returned of{" "}
                {item?.baseQuantity} sold
              </Txt>
            );
          })}
          {(() => {
            try {
              const q = refundQuote(s, i, p.lines as ReturnLine[]);
              return (
                <View style={styles.panel}>
                  <Txt muted size={12}>
                    Refund to the customer
                  </Txt>
                  <Txt size={26} bold style={{ marginTop: 6 }}>
                    {rupees(q.payablePaise)}
                  </Txt>
                  {q.creditReductionPaise > 0 && (
                    <Txt
                      size={12}
                      style={{ marginTop: 6, color: colors.amber }}
                    >
                      {rupees(q.creditReductionPaise)} comes off what the
                      customer owes
                    </Txt>
                  )}
                </View>
              );
            } catch (e) {
              return (
                <Txt style={{ color: colors.red }}>{(e as Error).message}</Txt>
              );
            }
          })()}
        </>
      )}
      {b && (
        <>
          <Txt bold>
            {s.products[b.productId]?.name} · {b.code}
          </Txt>
          <Txt>
            {String(p.kind).replaceAll("_", " ")} · {String(p.quantity)}{" "}
            {s.products[b.productId]?.baseUnit}
          </Txt>
          <Txt muted>
            Available: {b.quantity} · Quarantined: {b.quarantined}
          </Txt>
        </>
      )}
    </View>
  );
}
function ExceptionDetails({ reviewId }: { reviewId: string }) {
  const { state } = useSession();
  const s = state!,
    r = s.reviews[reviewId];
  if (!r) return null;
  const q = s.quarantine[r.referenceId];
  const command = q?.command as any;
  const op = command?.operation;
  const observation = s.observations[r.referenceId];
  return (
    <View style={{ gap: 10, marginBottom: 20 }}>
      {q && op?.type === "offline.checkout" && (
        <>
          {s.devices[op.deviceId] && (
            <Txt bold>
              Bill{" "}
              {invoiceNumber(
                command.occurredAt,
                s.devices[op.deviceId].series,
                op.sequence,
              )}
            </Txt>
          )}
          <Txt bold>
            {s.members[q.actorId]?.name} · {rupees(op.cashPaise)}
          </Txt>
          <Txt muted>
            {new Date(command.occurredAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            })}{" "}
            · {op.counterId}
          </Txt>
          {op.lines.map((l: any, index: number) => {
            const b = s.batches[l.batchId],
              p = b ? s.products[b.productId] : undefined;
            return (
              <Txt key={index}>
                {p?.name ?? "Unknown product"} {p?.strength} · {l.quantity}{" "}
                {l.unit} · {b?.code ?? l.batchId}
              </Txt>
            );
          })}
        </>
      )}
      {observation && (
        <>
          <Txt bold>{observation.counterId}</Txt>
          <Txt muted>
            {new Date(observation.startedAt).toLocaleString()} –{" "}
            {new Date(observation.endedAt).toLocaleTimeString()}
          </Txt>
          <Txt>
            Possible matching bills:{" "}
            {observation.candidateInvoiceIds
              .map((id) => s.invoices[id]?.number ?? id)
              .join(", ") || "None"}
          </Txt>
        </>
      )}
    </View>
  );
}
export function ReviewsScreen() {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    run = useRun();
  const [selected, setSelected] = useState<Approval | null>(null),
    [reason, R] = useState(""),
    [reviewId, V] = useState("");
  const pending = Object.values(state.approvals).filter(
    (a) => a.status === "pending" || a.status === "approved",
  );
  async function clip(preserve = false) {
    const observation =
      state.observations[state.reviews[reviewId]?.referenceId];
    if (!observation?.clipId)
      throw new Error("No local clip was captured for this interaction");
    const url = state.settings.gatewayUrl;
    if (!url) throw new Error("Connect to the shop gateway");
    const headers = { Authorization: `Bearer ${s.identity!.lease}` };
    const clipUrl = `${url}/clips/${observation.clipId}`;
    if (preserve) {
      const r = await fetch(clipUrl + "/preserve", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ preserve: true, reason }),
      });
      if (!r.ok) throw new Error("Clip could not be preserved");
      return;
    }
    if (Platform.OS === "web") {
      const r = await fetch(clipUrl, { headers });
      if (!r.ok) throw new Error("Local clip unavailable");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await r.blob());
      link.download = "counter-review.mp4";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    } else {
      const destination = new FileSystem.File(
        FileSystem.Paths.cache,
        `review-${observation.clipId}.mp4`,
      );
      if (destination.exists) destination.delete();
      const file = await FileSystem.File.downloadFileAsync(
        clipUrl,
        destination,
        { headers },
      );
      try {
        await Sharing.shareAsync(file.uri, { mimeType: "video/mp4" });
      } finally {
        if (file.exists) file.delete();
      }
    }
  }
  return (
    <Page
      title={t("reviews")}
      subtitle="Approvals and evidence that need a human decision."
    >
      <View style={{ marginBottom: 24 }}>
        <Button
          secondary
          onPress={() =>
            void run(async () => {
              if (s.demo)
                throw new Error(
                  "Gateway recovery needs a real shop connection",
                );
              const r = await fetch(state.settings.gatewayUrl + "/backups", {
                headers: { Authorization: `Bearer ${s.identity!.lease}` },
                signal: AbortSignal.timeout(10000),
              });
              if (!r.ok) throw new Error("Shop backups are unavailable");
              const data = await r.json();
              for (let index = 0; index < data.entries.length; index += 100)
                await s.request("/recovery/import", {
                  method: "POST",
                  body: JSON.stringify({
                    entries: data.entries.slice(index, index + 100),
                  }),
                });
              await s.refresh();
            })
          }
        >
          Recover from shop backups
        </Button>
      </View>
      <Section title="Approval requests">
        {pending.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => setSelected(a)}
            style={styles.listRow}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <View>
                <Txt bold>{approvalTitle(state, a, s.language === "hi")}</Txt>
                <Txt muted size={12} style={{ marginTop: 6 }}>
                  {a.reason}
                </Txt>
                <Txt size={11} muted style={{ marginTop: 5 }}>
                  {state.members[a.requestedBy]?.name} ·{" "}
                  {new Date(a.requestedAt).toLocaleString("en-IN")}
                </Txt>
              </View>
              <Badge warning={a.status === "pending"}>{a.status}</Badge>
            </Row>
          </Pressable>
        ))}
        {!pending.length && (
          <Empty icon="checkmark-done-outline" title="No approvals waiting" />
        )}
      </Section>
      <Section title="Exceptions and camera pilot">
        {Object.values(state.reviews)
          .filter((r) => r.status === "open")
          .map((r) => (
            <Pressable
              key={r.id}
              onPress={() => V(r.id)}
              style={styles.listRow}
            >
              <Row>
                <Icon
                  name={
                    r.kind === "camera"
                      ? "videocam-outline"
                      : "alert-circle-outline"
                  }
                />
                <View style={{ flex: 1 }}>
                  <Txt bold>{r.title}</Txt>
                  <Txt size={12} muted style={{ lineHeight: 19, marginTop: 6 }}>
                    {r.detail}
                  </Txt>
                </View>
              </Row>
            </Pressable>
          ))}
        <Txt size={11} muted>
          Camera observations are review candidates. Employee alerts and
          automatic theft conclusions are disabled.
        </Txt>
      </Section>
      <Sheet
        visible={!!selected}
        title="Review approval"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <Txt bold size={18} style={{ marginBottom: 12 }}>
              {approvalTitle(state, selected, s.language === "hi")}
            </Txt>
            <Txt muted style={{ marginBottom: 15 }}>
              {selected.reason}
            </Txt>
            <ApprovalDetails approval={selected} />
            <View style={{ height: 20 }} />
            {selected.status === "pending" ? (
              <Row>
                <Button
                  onPress={() =>
                    void run(async () => {
                      await s.command({
                        type: "approval.decide",
                        approvalId: selected.id,
                        approve: true,
                      });
                      setSelected(null);
                    })
                  }
                >
                  {t("approve")}
                </Button>
                <Button
                  secondary
                  onPress={() =>
                    void run(async () => {
                      await s.command({
                        type: "approval.decide",
                        approvalId: selected.id,
                        approve: false,
                      });
                      setSelected(null);
                    })
                  }
                >
                  {t("reject")}
                </Button>
              </Row>
            ) : selected.kind === "stock" ? (
              <Button
                onPress={() =>
                  void run(async () => {
                    await s.command({
                      type: "stock.execute",
                      approvalId: selected.id,
                    });
                    setSelected(null);
                  })
                }
              >
                Execute approved adjustment
              </Button>
            ) : selected.kind === "refund" ? (
              <RefundForm
                approval={selected}
                onDone={() => setSelected(null)}
              />
            ) : (
              <Txt muted>
                Return to the held order to use this approval. It is valid only
                for the approved order version and amount.
              </Txt>
            )}
          </>
        )}
      </Sheet>
      <Sheet
        visible={!!reviewId}
        title="Resolve exception"
        onClose={() => V("")}
      >
        {reviewId && (
          <>
            <Txt muted style={{ marginBottom: 20 }}>
              {state.reviews[reviewId]?.detail}
            </Txt>
            <ExceptionDetails reviewId={reviewId} />
            <Field
              label="Resolution / evidence checked"
              value={reason}
              onChange={R}
              multiline
            />
            {state.reviews[reviewId]?.kind === "camera" &&
              state.observations[state.reviews[reviewId].referenceId]
                ?.clipId && (
                <View style={{ gap: 12, marginBottom: 20 }}>
                  <Button secondary onPress={() => void run(() => clip())}>
                    Open local review clip
                  </Button>
                  <Button
                    secondary
                    disabled={reason.length < 3}
                    onPress={() => void run(() => clip(true))}
                  >
                    Preserve clip with this case
                  </Button>
                </View>
              )}
            {state.reviews[reviewId]?.kind === "quarantined_command" ? (
              <Row>
                <Button
                  onPress={() =>
                    void run(async () => {
                      if (s.demo)
                        throw new Error(
                          "Recovery is available on the live API",
                        );
                      await s.request(
                        `/recovery/${state.reviews[reviewId].referenceId}`,
                        {
                          method: "POST",
                          body: JSON.stringify({ accept: true, reason }),
                        },
                      );
                      await s.refresh();
                      V("");
                    })
                  }
                >
                  Recover sale
                </Button>
                <Button
                  secondary
                  onPress={() =>
                    void run(async () => {
                      await s.request(
                        `/recovery/${state.reviews[reviewId].referenceId}`,
                        {
                          method: "POST",
                          body: JSON.stringify({ accept: false, reason }),
                        },
                      );
                      await s.refresh();
                      V("");
                    })
                  }
                >
                  Reject with reason
                </Button>
              </Row>
            ) : (
              <Button
                onPress={() =>
                  void run(async () => {
                    await s.command({
                      type: "review.resolve",
                      reviewId,
                      resolution: reason,
                    });
                    V("");
                    R("");
                  })
                }
              >
                Save resolution
              </Button>
            )}
          </>
        )}
      </Sheet>
    </Page>
  );
}
export function MoreScreen({ navigate }: { navigate: (p: string) => void }) {
  const s = useSession(),
    t = useText(),
    run = useRun();
  const [counter, C] = useState(
    s.state!.devices[s.identity!.deviceId]?.counterId ?? "counter-1",
  );
  return (
    <Page title={t("more")} subtitle={s.state!.settings.name}>
      {s.identity!.actor.role === "owner" && (
        <Section title={t("owner")}>
          {(
            [
              "overview",
              "inventory",
              "money",
              "reviews",
              "administration",
            ] as const
          ).map((p) => (
            <Pressable
              key={p}
              onPress={() => navigate(p)}
              style={styles.listRow}
            >
              <Row style={{ justifyContent: "space-between" }}>
                <Txt bold>{t(p)}</Txt>
                <Icon name="chevron-forward" />
              </Row>
            </Pressable>
          ))}
        </Section>
      )}
      <Section title="Counter assignment">
        <Field label="Counter ID" value={counter} onChange={C} />
        <Button
          secondary
          onPress={() => void run(() => s.assignCounter(counter))}
        >
          Assign this counter
        </Button>
      </Section>
      {s.identity!.actor.role !== "owner" && (
        <Section title={s.language === "hi" ? "नकद दराज़" : "Cash drawer"}>
          <DrawerPanel />
        </Section>
      )}
      <Section title="My cash collections">
        <Txt size={24} bold>
          {rupees(
            Object.values(s.state!.payments)
              .filter(
                (p) =>
                  p.collectorId === s.identity!.actor.id &&
                  p.method === "cash" &&
                  indiaDate(p.occurredAt) ===
                    indiaDate(new Date().toISOString()),
              )
              .reduce(
                (n, p) =>
                  n + (p.kind === "refund" ? -p.amountPaise : p.amountPaise),
                0,
              ),
          )}
        </Txt>
      </Section>
      <Section title="Device and synchronisation">
        <Txt muted size={12}>
          {s.demo ? "Preview device" : s.identity!.deviceId}
        </Txt>
        <Txt muted size={12}>
          Offline authorisation expires{" "}
          {new Date(s.identity!.expiresAt).toLocaleString("en-IN")}
        </Txt>
        <Button secondary onPress={() => void s.sync()} icon="sync-outline">
          {t("sync")}
        </Button>
        {s.pending.map((p) => (
          <View key={p.command.id} style={styles.listRow}>
            <Badge warning={p.status === "review"}>
              {p.status === "local"
                ? "Saved on this phone"
                : p.status === "gateway"
                  ? "Backed up at shop"
                  : "Owner recovery required"}
            </Badge>
            <Txt muted size={11} style={{ marginTop: 7 }}>
              {p.command.id.slice(0, 12)} {p.error}
            </Txt>
          </View>
        ))}
      </Section>
      <Section title={t("language")}>
        <Row>
          <Chip
            active={s.language === "en"}
            onPress={() => s.setLanguage("en")}
          >
            English
          </Chip>
          <Chip
            active={s.language === "hi"}
            onPress={() => s.setLanguage("hi")}
          >
            हिंदी
          </Chip>
        </Row>
      </Section>
      <Button secondary onPress={() => void run(s.logout)}>
        {t("logout")}
      </Button>
    </Page>
  );
}
export function AdministrationScreen() {
  const s = useSession(),
    state = s.state!,
    run = useRun();
  const [settings, S] = useState(state.settings),
    [name, N] = useState(""),
    [username, U] = useState(""),
    [password, P] = useState(""),
    [collect, C] = useState(true),
    [employee, setEmployee] = useState<string | null>(null);
  return (
    <Page
      title="Administration"
      subtitle="Shop configuration, employee access, and registered devices."
    >
      <Section title="Shop settings">
        {(
          [
            ["name", "Shop name"],
            ["address", "Shop address"],
            ["gstin", "GSTIN"],
            ["drugLicence", "Drug licence number"],
            ["stateCode", "State code"],
            ["phone", "Contact phone"],
            ["upiId", "Merchant UPI ID"],
            ["gatewayUrl", "Local gateway URL"],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            label={label}
            value={settings[key]}
            onChange={(v) => S({ ...settings, [key]: v })}
            identifier={[
              "gstin",
              "drugLicence",
              "upiId",
              "gatewayUrl",
            ].includes(key)}
          />
        ))}
        <Pressable
          onPress={() =>
            S({ ...settings, readinessConfirmed: !settings.readinessConfirmed })
          }
        >
          <Row>
            <Icon
              name={settings.readinessConfirmed ? "checkbox" : "square-outline"}
            />
            <Txt style={{ flex: 1 }} size={12}>
              Opening counts, tax configuration and pharmacy record requirements
              have been verified for this shop.
            </Txt>
          </Row>
        </Pressable>
        <Button
          onPress={() =>
            void run(() => s.command({ type: "settings.update", settings }))
          }
        >
          Save shop settings
        </Button>
      </Section>
      <Section title="Invite employee">
        <Field label="Employee name" value={name} onChange={N} />
        <Field
          label="Unique username"
          value={username}
          onChange={U}
          identifier
        />
        <Field
          label="Temporary password · at least 12 characters"
          value={password}
          onChange={P}
          secret
        />
        <Pressable onPress={() => C(!collect)}>
          <Row>
            <Icon name={collect ? "checkbox" : "square-outline"} />
            <Txt>May collect payments</Txt>
          </Row>
        </Pressable>
        <Button
          onPress={() =>
            void run(async () => {
              if (s.demo)
                throw new Error(
                  "Account creation requires a signed-in live shop.",
                );
              await s.request("/employees", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  username,
                  password,
                  canCollect: collect,
                }),
              });
              await s.refresh();
              N("");
              U("");
              P("");
            })
          }
        >
          Create employee account
        </Button>
      </Section>
      <Section title="Employees">
        {Object.values(state.members)
          .filter((m) => m.role === "owner")
          .map((m) => (
            <Pressable
              key={m.id}
              onPress={() => setEmployee(m.id)}
              style={[styles.listRow, { gap: 4 }]}
            >
              <Row style={{ justifyContent: "space-between" }}>
                <Txt bold>{m.name}</Txt>
                <Icon name="chevron-forward" size={16} />
              </Row>
              <Txt muted size={11}>
                Owner{m.username ? ` · ${m.username}` : ""}
              </Txt>
            </Pressable>
          ))}
        {Object.values(state.members)
          .filter((m) => m.role === "employee")
          .map((m) => (
            <Pressable
              key={m.id}
              onPress={() => setEmployee(m.id)}
              style={[styles.listRow, { gap: 4 }]}
            >
              <Row style={{ justifyContent: "space-between" }}>
                <Txt bold>{m.name}</Txt>
                <Icon name="chevron-forward" size={16} />
              </Row>
              <Txt muted size={11}>
                {m.username ? `${m.username} · ` : ""}
                {m.active ? "Active" : "Disabled"} ·{" "}
                {m.canCollect ? "Can collect" : "Cannot collect"}
                {m.mustChangePassword ? " · Temporary password" : ""}
              </Txt>
            </Pressable>
          ))}
      </Section>
      <Section title="Registered devices">
        {Object.values(state.devices).map((d) => (
          <View key={d.id} style={styles.listRow}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Txt bold>{deviceLabel(state, d)}</Txt>
                <Txt size={11} muted style={{ marginTop: 6 }}>
                  Series {d.series} · {d.pendingCount} pending · {d.counterId}
                </Txt>
                <Txt size={11} muted>
                  Last seen {new Date(d.lastSeen).toLocaleString("en-IN")}
                </Txt>
              </View>
              {d.revoked ? (
                <Badge warning>Revoked</Badge>
              ) : (
                <Button
                  small
                  secondary
                  onPress={() =>
                    void run(() =>
                      s.command({ type: "device.revoke", deviceId: d.id }),
                    )
                  }
                >
                  Revoke
                </Button>
              )}
            </Row>
          </View>
        ))}
      </Section>
      <EmployeeSheet id={employee} close={() => setEmployee(null)} />
    </Page>
  );
}
/** One employee's access: payments, a new temporary password, or turning the account off. */
function EmployeeSheet({
  id,
  close,
}: {
  id: string | null;
  close: () => void;
}) {
  const s = useSession(),
    run = useRun();
  const [password, setPassword] = useState(""),
    [done, setDone] = useState(""),
    [name, setName] = useState("");
  const m = id ? s.state!.members[id] : undefined;
  useEffect(() => {
    setPassword("");
    setDone("");
    setName(m?.name ?? "");
  }, [id]);
  const update = (change: {
    active?: boolean;
    canCollect?: boolean;
    name?: string;
  }) =>
    run(async () => {
      if (s.demo) throw new Error("Manage real accounts after signing in");
      await s.request(`/employees/${m!.id}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
      await s.refresh();
    });
  return (
    <Sheet visible={!!m} title={m?.name ?? ""} onClose={close}>
      {m && (
        <View style={{ gap: 16 }}>
          {!!m.username && <Txt muted>Username: {m.username}</Txt>}
          <View>
            <Field
              label="Name shown on bills and reports"
              value={name}
              onChange={setName}
            />
            <Button
              secondary
              small
              disabled={!name.trim() || name.trim() === m.name}
              onPress={() => void update({ name: name.trim() })}
            >
              Save name
            </Button>
          </View>
          {m.role === "employee" && (
            <>
              <Pressable
                onPress={() =>
                  void update({ active: m.active, canCollect: !m.canCollect })
                }
              >
                <Row>
                  <Icon name={m.canCollect ? "checkbox" : "square-outline"} />
                  <Txt style={{ flex: 1 }}>
                    May collect payments and handle the drawer
                  </Txt>
                </Row>
              </Pressable>
              <Section title="Forgot password">
                <Txt muted size={12}>
                  Set a temporary password. They are signed out on every phone
                  and choose their own password when they next sign in.
                </Txt>
                <Field
                  label="Temporary password · at least 12 characters"
                  value={password}
                  onChange={setPassword}
                  secret
                />
                <Button
                  secondary
                  disabled={password.length < 12}
                  onPress={() =>
                    void run(async () => {
                      if (s.demo)
                        throw new Error(
                          "Manage real accounts after signing in",
                        );
                      await s.request(`/employees/${m.id}/password`, {
                        method: "POST",
                        body: JSON.stringify({ password }),
                      });
                      await s.refresh();
                      setPassword("");
                      setDone(
                        `Tell ${m.name} the temporary password. They will choose their own when they sign in.`,
                      );
                    })
                  }
                >
                  Set temporary password
                </Button>
                {!!done && <Txt style={{ color: colors.accent }}>{done}</Txt>}
              </Section>
              <Button
                secondary
                onPress={() =>
                  void update({ active: !m.active, canCollect: m.canCollect })
                }
              >
                {m.active ? "Disable and sign out" : "Enable"}
              </Button>
            </>
          )}
        </View>
      )}
    </Sheet>
  );
}
