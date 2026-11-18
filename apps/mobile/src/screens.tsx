import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useDeferredValue,
} from "react";
import {
  View,
  ScrollView,
  Pressable,
  useWindowDimensions,
  Platform,
  type TextInput,
} from "react-native";
import { PurchaseForm } from "./receiving";
import { approvalReason, reviewDetail, reviewTitle } from "./review-text";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import Constants from "expo-constants";
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
  palette,
  space,
  radius,
  toneInk,
  Entry,
  ListRow,
  Line,
  TotalRule,
  Stamp,
  StaffMark,
  Amount,
  Panel,
  Banner,
  stampDate,
  indianMobile,
  dateTime24,
  deviceText,
} from "./ui";
import { Checkout } from "./selling";
import { ProductForm } from "./product-form";
import { CatalogueImport } from "./catalogue-import";
import { StockCount, CountForm } from "./stock-count";
import { ReturnForm, RefundForm, amountOf, approvalLive } from "./payments";
import {
  DrawerPanel,
  DayReportView,
  clock,
  dayLabel,
  differenceColour,
} from "./drawer";
import {
  D,
  quote,
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
  expiryRows,
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
  approvalSummary,
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
/** The time column of a register entry: the clock for today, a short date for earlier days. */
function entryTime(at: string) {
  if (indiaDate(at) === indiaDate(new Date().toISOString())) {
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return new Date(at).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
}
function OrderLines({ order }: { order: Order }) {
  const state = useSession().state!,
    w = useWord();
  return (
    <View style={{ marginBottom: 16 }}>
      {orderSummary(state, order).lines.map((l) => (
        <ListRow
          key={l.key}
          title={l.name}
          detail={`${l.quantity} ${w(l.unit)}`}
          trailing={
            l.batch ? (
              <Txt num weight={600} size={14} color={palette.ink2}>
                {l.batch}
              </Txt>
            ) : undefined
          }
        />
      ))}
    </View>
  );
}
export function Page({ title, subtitle, action, onBack, children }: any) {
  const { language } = useSession();
  return (
    <ScrollView
      style={{ backgroundColor: palette.paper }}
      contentContainerStyle={{
        paddingHorizontal: space.gutter,
        paddingTop: 20,
        paddingBottom: 56,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {onBack && (
        // A quiet way back to More for the owner screens that open from it.
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={language === "hi" ? "अन्य पर वापस" : "Back to More"}
          hitSlop={8}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            minHeight: 44,
            marginTop: -12,
            marginLeft: -6,
            paddingRight: 12,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="chevron-back" size={20} color={palette.ink2} />
          <Txt size={14} weight={500} color={palette.ink2}>
            {language === "hi" ? "अन्य" : "More"}
          </Txt>
        </Pressable>
      )}
      <Row
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 24,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size={28} weight={700} style={{ letterSpacing: -0.4 }}>
            {title}
          </Txt>
          {subtitle && (
            <Txt size={14} color={palette.ink2}>
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
export function useRun() {
  const s = useSession();
  const running = useRef(false);
  // Ignore a second tap while the first action is still being saved.
  return async (fn: () => Promise<any>) => {
    if (running.current) return;
    running.current = true;
    s.setError("");
    try {
      await fn();
      s.setError("");
    } catch (e) {
      s.setError((e as Error).message);
    } finally {
      running.current = false;
    }
  };
}
export function OverviewScreen({
  navigate,
  onBack,
}: {
  navigate: (page: string) => void;
  onBack?: () => void;
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
  const expiring = expiryRows(state, today).length;
  const waiting = Object.values(state.approvals).filter(
    (a) => a.status === "pending" && approvalLive(state, a),
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
          ? `${deviceText(deviceLabel(state, d), "hi")} ${dayLabel(indiaDate(d.lastSeen), hi)} से नहीं दिखा; रिपोर्ट उसका इंतज़ार कर रही हैं। इस्तेमाल न हो तो हटाएँ।`
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
              ? `${expiring} बैच एक्सपायर हो चुके या 90 दिन में होंगे`
              : `${expiring} ${expiring === 1 ? "batch is" : "batches are"} expired or expiring within 90 days`,
            page: "expiry",
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
      onBack={onBack}
      title={t("overview")}
      subtitle={
        hi
          ? "नकदी, बिक्री और स्टाफ़ एक नज़र में।"
          : "Cash, sales and staff at a glance."
      }
    >
      <Row style={{ marginBottom: 20 }}>
        <Chip active={day === "today"} onPress={() => setDay("today")}>
          {t("today")}
        </Chip>
        <Chip active={day === "yesterday"} onPress={() => setDay("yesterday")}>
          {hi ? "कल" : "Yesterday"}
        </Chip>
      </Row>
      <View style={{ marginBottom: 32 }}>
        <Txt size={14} weight={500} color={palette.ink2}>
          {day === "today"
            ? hi
              ? "आज की बिक्री"
              : "Sales today"
            : hi
              ? "कल की बिक्री"
              : "Sales yesterday"}
        </Txt>
        <Amount
          value={rupees(r.sales.netPaise)}
          size={40}
          weight={700}
          style={{ marginTop: 4 }}
        />
        <Txt size={13} color={palette.ink3} style={{ marginTop: 4, marginBottom: 12 }}>
          {r.sales.bills} {hi ? "बिल" : r.sales.bills === 1 ? "bill" : "bills"}
          {r.sales.returnsPaise
            ? ` · ${hi ? "वापसी" : "returns"} ${rupees(r.sales.returnsPaise)}`
            : ""}
          {r.sales.discountsPaise
            ? ` · ${hi ? "छूट" : "discounts"} ${rupees(r.sales.discountsPaise)}`
            : ""}
        </Txt>
        <Line label={hi ? "नकद" : "Cash"} value={rupees(r.sales.cashPaise)} />
        <Line label="UPI" value={rupees(r.sales.upiPaise)} />
        <Line
          label={hi ? "उधार" : "Credit"}
          value={rupees(r.sales.creditPaise)}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => navigate("money")}
          style={({ pressed }) => ({
            backgroundColor: pressed ? palette.desk : "transparent",
          })}
        >
          {drawer ? (
            <Line
              strong
              label={
                hi ? "दराज़ में होना चाहिए" : "Cash expected in the drawer"
              }
              value={rupees(expectedCash(state, drawer.id))}
              note={
                <Txt size={13} color={palette.ink3}>
                  {lastCount
                    ? hi
                      ? `आख़िरी गिनती ${clock(lastCount.at)} · ${state.members[lastCount.by]?.name ?? ""} · ${differenceText(lastCount.differencePaise)}`
                      : `Last counted ${clock(lastCount.at)} by ${state.members[lastCount.by]?.name ?? "someone"}: ${differenceText(lastCount.differencePaise)}`
                    : hi
                      ? `${indiaDate(drawer.openedAt) !== today ? `${dayLabel(indiaDate(drawer.openedAt), hi)} ` : ""}${clock(drawer.openedAt)} पर खुली · अभी गिनी नहीं`
                      : `Opened ${indiaDate(drawer.openedAt) !== today ? `${dayLabel(indiaDate(drawer.openedAt))} ` : ""}${clock(drawer.openedAt)} · not counted since`}
                </Txt>
              }
            />
          ) : (
            <Line
              strong
              label={hi ? "दराज़ बंद है" : "The drawer is closed"}
              value={
                lastClose ? differenceText(lastClose.discrepancyPaise) : "—"
              }
              color={
                lastClose
                  ? differenceColour(lastClose.discrepancyPaise)
                  : undefined
              }
              note={
                <Txt size={13} color={palette.ink3}>
                  {lastClose
                    ? hi
                      ? "आख़िरी बार बंद करते समय"
                      : "At the last close"
                    : hi
                      ? "पहली बिक्री से पहले खोलें"
                      : "Open it before the first cash sale"}
                </Txt>
              }
            />
          )}
        </Pressable>
      </View>
      {attention.length > 0 && (
        <Section title={hi ? "ध्यान दें" : "Needs attention"}>
          {attention.map((a) => (
            <ListRow
              key={a.text}
              onPress={() => navigate(a.page)}
              leading={
                <Icon
                  name={a.icon}
                  size={22}
                  color={a.alert ? palette.waiting : palette.ink3}
                />
              }
              title={
                <Txt
                  size={15}
                  weight={a.alert ? 600 : 400}
                  color={a.alert ? palette.waiting : palette.ink}
                >
                  {a.text}
                </Txt>
              }
            />
          ))}
        </Section>
      )}
      <Section title={hi ? "स्टाफ़" : "Staff"}>
        {r.staff.map((p) => (
          <ListRow
            key={p.id}
            leading={<StaffMark id={p.id} name={p.name} size={34} />}
            title={p.name}
            detail={
              <Txt size={13} color={palette.ink2}>
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
            }
            trailing={<Amount value={rupees(p.salesPaise)} size={16} />}
          />
        ))}
        {!r.staff.length && (
          <Empty
            icon="people-outline"
            title={hi ? "अभी कोई गतिविधि नहीं" : "No activity yet"}
          />
        )}
      </Section>
      {closes.length > 0 && (
        <Section title={hi ? "पिछली दराज़ गिनतियाँ" : "Recent drawer closes"}>
          {closes.map((d) => (
            <Entry
              key={d.id}
              time={new Date(`${indiaDate(d.closedAt!)}T00:00:00Z`).toLocaleDateString(
                hi ? "hi-IN" : "en-IN",
                { day: "numeric", month: "short", timeZone: "UTC" },
              )}
              title={state.members[d.closedBy ?? ""]?.name ?? ""}
              who={{ id: d.closedBy, name: state.members[d.closedBy ?? ""]?.name }}
              trailing={
                <Badge
                  tone={
                    (d.discrepancyPaise ?? 0) < 0
                      ? "declined"
                      : (d.discrepancyPaise ?? 0) > 0
                        ? "waiting"
                        : "paid"
                  }
                >
                  {differenceText(d.discrepancyPaise)}
                </Badge>
              }
            />
          ))}
        </Section>
      )}
      {operations && (
        <Section title="Shop infrastructure">
          <Line
            label={
              operations.gateway?.reachableRecently
                ? "Gateway reachable"
                : "Gateway unavailable or not paired"
            }
            value=""
          />
          <Txt size={13} color={palette.ink3} style={{ marginTop: 8 }}>
            {hi ? "प्रिंटर:" : "Printer:"}{" "}
            {operations.gateway?.details.printerConfigured
              ? "Configured"
              : "Not configured"}{" "}
            · {operations.gateway?.details.uncertainPrints ?? 0}{" "}
            {hi ? "अनिश्चित प्रिंट" : "uncertain jobs"}
          </Txt>
        </Section>
      )}
      <Section title={hi ? "हाल के बिल" : "Recent sales"}>
        {invoices.slice(0, 8).map((i) => (
          <Entry
            key={i.id}
            time={new Date(i.occurredAt).toLocaleTimeString("en-GB", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
            })}
            title={<Txt num size={16} weight={600}>{i.number}</Txt>}
            detail={itemCount(i.lines.length, s.language)}
            who={{
              id: i.collectorId,
              name: state.members[i.collectorId]?.name,
            }}
            amount={rupees(i.totalPaise)}
          />
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
  // A new request starts empty: the old amount must not linger after a decline or a send.
  const selectedRequestStatus = selected ? orderRequest(selected)?.status : "";
  useEffect(() => setDiscount(""), [selected?.id, selectedRequestStatus]);
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
  /**
   * The bill number when the order has been billed, otherwise "Open sale · 10:42" (never a raw
   * id fragment), then who it is for.
   */
  const orderTitle = (o: Order, customer?: string) => {
    const invoice = Object.values(state.invoices).find((i) => i.orderId === o.id);
    const label =
      o.status === "cancelled"
        ? hi
          ? "रद्द बिक्री"
          : "Cancelled sale"
        : hi
          ? "खुली बिक्री"
          : "Open sale";
    return (
      <Txt size={16} weight={600}>
        {invoice ? (
          <Txt size={16} weight={600} num>
            {invoice.number}
          </Txt>
        ) : (
          <>
            {label}
            {" · "}
            <Txt size={16} weight={600} num>
              {clock(o.createdAt)}
            </Txt>
          </>
        )}
        {customer ? (
          <Txt size={16} weight={400}>{` · ${customer}`}</Txt>
        ) : null}
      </Txt>
    );
  };
  const markOf = (id: string | undefined) => {
    const m = state.members[id ?? ""];
    return m ? { id: m.id, name: m.name } : undefined;
  };
  return (
    <Page
      title={t("orders")}
      subtitle="Held orders, handoffs, and completed bills."
    >
      <Row style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <Chip active={filter === "open"} onPress={() => setFilter("open")}>
          {hi ? "खुले" : "Open"} · {open.length}
        </Chip>
        <Chip active={filter === "bills"} onPress={() => setFilter("bills")}>
          {hi ? "पूरे हुए" : "Completed"} · {Object.keys(state.invoices).length}
        </Chip>
        {cancelled.length > 0 && (
          <Chip
            active={filter === "cancelled"}
            onPress={() => setFilter("cancelled")}
          >
            {hi ? "रद्द" : "Cancelled"} · {cancelled.length}
          </Chip>
        )}
      </Row>
      {filter === "cancelled" &&
        cancelled.map((o) => (
          <Entry
            key={o.id}
            time={o.cancelledAt ? entryTime(o.cancelledAt) : ""}
            title={orderTitle(o)}
            who={markOf(o.collectorId)}
            detail={
              <View style={{ gap: 6 }}>
                <Badge tone="neutral">{hi ? "रद्द" : "Cancelled"}</Badge>
                <Txt size={14} color={palette.ink2}>
                  {orderSummary(state, o)
                    .lines.map((l) => l.name)
                    .join(", ")}
                </Txt>
                <Txt size={14}>{o.cancelReason}</Txt>
              </View>
            }
          />
        ))}
      {filter === "open"
        ? open.map((o) => {
            const a = orderRequest(o);
            const summary = orderSummary(state, o);
            const customer = o.customerId
              ? state.customers[o.customerId]
              : undefined;
            const what = a
              ? a.kind === "credit"
                ? hi
                  ? "उधार"
                  : "Credit"
                : hi
                  ? "छूट"
                  : "Discount"
              : "";
            const amount = a ? rupees(Number(a.payload.amountPaise)) : "";
            const requestInk = !a
              ? palette.ink
              : a.status === "pending"
                ? palette.waiting
                : a.status === "approved"
                  ? palette.approved
                  : palette.declined;
            return (
              <Entry
                key={o.id}
                time={entryTime(o.createdAt)}
                title={orderTitle(o, customer?.name)}
                who={markOf(o.dispenserId)}
                amount={rupees(summary.totalPaise)}
                detail={
                  <View style={{ gap: 6 }}>
                    <Row style={{ flexWrap: "wrap", gap: 8 }}>
                      {o.status === "handoff" && (
                        <Badge tone="waiting">Handoff pending</Badge>
                      )}
                      {!a && o.status === "held" && (
                        <Badge tone="neutral">{hi ? "रोका गया" : "Held"}</Badge>
                      )}
                      {a && a.status === "pending" && (
                        <Badge tone="waiting">
                          {hi ? "इंतज़ार" : "Waiting"}
                        </Badge>
                      )}
                      {a && a.status !== "pending" && (
                        <Badge
                          tone={a.status === "approved" ? "approved" : "declined"}
                        >
                          {a.status === "approved"
                            ? hi
                              ? "मंज़ूर"
                              : "Approved"
                            : hi
                              ? "मना"
                              : "Declined"}
                        </Badge>
                      )}
                    </Row>
                    <Txt size={14} color={palette.ink2}>
                      {summary.lines.map((l) => l.name).join(", ")}
                    </Txt>
                    {o.status === "handoff" && (
                      <Txt size={13} color={palette.ink3}>
                        Offered to{" "}
                        {state.members[o.offeredTo ?? ""]?.name ?? "a cashier"}
                      </Txt>
                    )}
                    {a && (
                      <Txt size={14} weight={600} color={requestInk}>
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
                    )}
                  </View>
                }
              >
                <View style={{ marginTop: 8 }}>
                  {o.status === "handoff" && o.offeredTo === me.id ? (
                    <Row style={{ flexWrap: "wrap", gap: 8 }}>
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
                    </Row>
                  ) : o.status === "handoff" && o.collectorId === me.id ? (
                    <Row style={{ flexWrap: "wrap", gap: 8 }}>
                      <Button
                        secondary
                        small
                        onPress={() => act("order.recall", o)}
                      >
                        Take back
                      </Button>
                    </Row>
                  ) : o.status === "held" && o.collectorId === me.id ? (
                    <>
                      <Row style={{ flexWrap: "wrap", gap: 8 }}>
                        <Button small onPress={() => setSelected(o)}>
                          Collect payment
                        </Button>
                        <Button secondary small onPress={() => setHandoff(o)}>
                          Hand to cashier
                        </Button>
                      </Row>
                      <View style={{ alignSelf: "flex-end", marginTop: 4 }}>
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={8}
                          style={{ minHeight: 48, justifyContent: "center" }}
                          onPress={() => {
                            setCancelReason("");
                            setCancelling(o);
                          }}
                        >
                          <Txt size={14} weight={600} color={palette.declined}>
                            Cancel order
                          </Txt>
                        </Pressable>
                      </View>
                    </>
                  ) : me.role === "owner" ? (
                    <Row style={{ flexWrap: "wrap", gap: 8 }}>
                      <Button
                        secondary
                        small
                        onPress={() => act("order.recall", o)}
                      >
                        Take over
                      </Button>
                    </Row>
                  ) : (
                    <Txt size={13} color={palette.ink3}>
                      Awaiting the assigned collector.
                    </Txt>
                  )}
                </View>
              </Entry>
            );
          })
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
                const customer = i.customerId
                  ? state.customers[i.customerId]
                  : undefined;
                return (
                  <Entry
                    key={i.id}
                    time={entryTime(i.occurredAt)}
                    onPress={() => onInvoice(i)}
                    title={
                      <Txt size={16} weight={600}>
                        <Txt size={16} weight={600} num>
                          {i.number}
                        </Txt>
                        {customer ? (
                          <Txt size={16} weight={400}>{` · ${customer.name}`}</Txt>
                        ) : null}
                      </Txt>
                    }
                    who={markOf(i.collectorId)}
                    amount={rupees(i.totalPaise)}
                    detail={
                      <View style={{ gap: 6 }}>
                        <Row style={{ flexWrap: "wrap", gap: 8 }}>
                          <Badge tone="paid">
                            {hi ? "पूरा हुआ" : "Completed"}
                          </Badge>
                          {request?.status === "pending" && (
                            <Badge tone="waiting">
                              {hi ? "इंतज़ार" : "Waiting"}
                            </Badge>
                          )}
                          {request?.status === "rejected" && (
                            <Badge tone="declined">
                              {hi ? "मना" : "Declined"}
                            </Badge>
                          )}
                        </Row>
                        <Txt size={14} color={palette.ink2}>
                          {i.lines.map((l) => l.name).join(", ")}
                        </Txt>
                        {refunded > 0 && (
                          <Txt size={14} color={palette.ink2}>
                            {hi
                              ? `वापसी ${rupees(refunded)}`
                              : `Returned ${rupees(refunded)}`}
                          </Txt>
                        )}
                        {request?.status === "pending" && (
                          <Txt size={14} weight={600} color={palette.waiting}>
                            {hi
                              ? "वापसी मालिक की मंज़ूरी का इंतज़ार कर रही है"
                              : "Return waiting for the owner"}
                          </Txt>
                        )}
                      </View>
                    }
                  >
                    {request?.status === "pending" ? null : request?.status ===
                        "approved" && mine ? (
                      <View style={{ marginTop: 8 }}>
                        <Row style={{ flexWrap: "wrap", gap: 8 }}>
                          <Button small onPress={() => setRefunding(request)}>
                            {hi
                              ? "मंज़ूर वापसी · पैसे लौटाएँ"
                              : "Return approved · Give refund"}
                          </Button>
                        </Row>
                      </View>
                    ) : fully ? null : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setReturnInvoice(i)}
                        style={{ minHeight: 44, justifyContent: "center" }}
                      >
                        <Txt
                          size={14}
                          weight={600}
                          color={
                            request?.status === "rejected"
                              ? palette.declined
                              : palette.blue
                          }
                        >
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
                  </Entry>
                );
              })}
              {bills.length === 0 && (
                <Empty
                  icon="receipt-outline"
                  title={hi ? "कोई बिल नहीं मिला" : "No bills found"}
                />
              )}
              {bills.length > 30 && (
                <Txt size={13} muted style={{ marginTop: 12 }}>
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
            {s.identity?.actor.role !== "owner" && (
              <>
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
                  const amountPaise = money(discount);
                  if (amountPaise <= 0)
                    throw new Error("Enter the discount amount");
                  const billPaise = quote(
                    state,
                    selected.lines,
                    new Date().toISOString(),
                  ).reduce((n, l) => n + l.netPaise, 0);
                  if (amountPaise > billPaise)
                    throw new Error(
                      `The discount cannot be more than the bill (${rupees(billPaise)})`,
                    );
                  await s.command({
                    type: "approval.request",
                    approvalId: uid(),
                    kind: "discount",
                    payload: {
                      orderId: selected.id,
                      orderVersion: selected.version,
                      amountPaise,
                    },
                    reason: "Customer discount request",
                  });
                  setDiscount("");
                  setSelected(null);
                })
              }
            >
              Ask owner to approve discount
            </Button>
              </>
            )}
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
            <ListRow
              key={m.id}
              leading={<StaffMark id={m.id} name={m.name} size={32} />}
              title={m.name}
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
            />
          ))}
      </Sheet>
      <Sheet
        visible={!!cancelling}
        title="Cancel order"
        onClose={() => setCancelling(null)}
      >
        <Txt size={14} color={palette.ink2} style={{ marginBottom: 16 }}>
          Only for an unbilled order the customer did not take. The cancellation
          and reason are recorded.
        </Txt>
        <Field
          label="Reason for cancelling"
          value={cancelReason}
          onChange={setCancelReason}
        />
        <Button
          variant="danger"
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
    [phoneError, setPhoneError] = useState(""),
    [address, setAddress] = useState(""),
    [selected, setSelected] = useState(""),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState<"cash" | "upi">("cash"),
    [ref, setRef] = useState(""),
    [verified, setVerified] = useState(false),
    [query, setQuery] = useState("");
  const hi = s.language === "hi";
  const needle = query.trim().toLowerCase();
  // A closed form starts empty next time, so nothing is added twice by accident.
  const closeAdd = () => {
    setAdd(false);
    setName("");
    setPhone("");
    setPhoneError("");
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
      <Field
        value={query}
        onChange={setQuery}
        placeholder="Search by name or phone"
      />
      {Object.values(state.customers)
        .filter(
          (c) =>
            !needle ||
            c.name.toLowerCase().includes(needle) ||
            c.phone.toLowerCase().includes(needle),
        )
        // Customers who owe come first, largest balance first.
        .map((c) => ({ c, owes: balance(state, c.id) }))
        .sort((a, b) => b.owes - a.owes || a.c.name.localeCompare(b.c.name))
        .map(({ c, owes }) => (
          <ListRow
            key={c.id}
            onPress={() => setSelected(c.id)}
            title={c.name}
            detail={
              <Txt size={14} color={palette.ink2} num>
                {c.phone || "No phone recorded"}
              </Txt>
            }
            trailing={
              owes > 0 ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Amount
                    value={rupees(owes)}
                    size={16}
                    color={palette.waiting}
                  />
                  <Txt size={13} color={palette.waiting}>
                    {hi ? "बाकी" : "owes"}
                  </Txt>
                </View>
              ) : (
                <Txt size={13} color={palette.ink3}>
                  {hi ? "कुछ बाकी नहीं" : "Nothing owed"}
                </Txt>
              )
            }
          />
        ))}
      {Object.keys(state.customers).length === 0 && (
        <Empty
          icon="people-outline"
          title={hi ? "अभी कोई ग्राहक नहीं" : "No customers yet"}
        />
      )}
      <Sheet visible={add} title="Add customer" onClose={() => closeAdd()}>
        <Field label={t("name")} value={name} onChange={setName} />
        <Field
          label={t("phone")}
          value={phone}
          onChange={(v: string) => {
            setPhone(v);
            setPhoneError("");
          }}
          error={phoneError}
          number
        />
        <Field label={t("address")} value={address} onChange={setAddress} />
        <Button
          disabled={!name.trim()}
          onPress={() =>
            void run(async () => {
              const mobile = indianMobile(phone);
              if (mobile === null) {
                setPhoneError(
                  hi
                    ? "10 अंकों का मोबाइल नंबर भरें (जैसे 98765 43210)"
                    : "Enter a 10-digit mobile number (for example 98765 43210)",
                );
                return;
              }
              await s.command({
                type: "customer.create",
                customer: {
                  id: uid(),
                  name: name.trim(),
                  phone: mobile,
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
            <Txt size={14} color={palette.ink2}>
              {hi ? "बाकी" : "Owes"}
            </Txt>
            <View style={{ marginBottom: 20 }}>
              <Amount
                value={rupees(balance(state, selected))}
                size={40}
                weight={700}
                color={
                  balance(state, selected) > 0 ? palette.waiting : palette.ink
                }
              />
            </View>
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
                  {hi ? "पूरा बाकी" : "Full amount"}{" "}
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
                  style={{ marginBottom: 20, minHeight: 48, justifyContent: "center" }}
                >
                  <Row>
                    <Icon
                      name={verified ? "checkbox" : "square-outline"}
                      size={24}
                      color={verified ? palette.blue : palette.ink3}
                    />
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
            <View style={{ height: 32 }} />
            <Section title="Account history">
              {Object.values(state.ledger)
                .filter((l) => l.customerId === selected)
                .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                .map((l) => {
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
                    <Entry
                      key={l.id}
                      time={entryTime(l.occurredAt)}
                      title={what}
                      detail={
                        bill ? (
                          <Txt size={14} weight={600} num color={palette.ink2}>
                            {bill}
                          </Txt>
                        ) : undefined
                      }
                      amount={`${l.amountPaise < 0 ? "−" : "+"}${rupees(Math.abs(l.amountPaise))}`}
                      amountColor={l.amountPaise < 0 ? palette.paid : palette.ink}
                    />
                  );
                })}
            </Section>
          </>
        )}
      </Sheet>
    </Page>
  );
}
export function StockScreen({
  manage = false,
  navigate,
  onBack,
}: {
  manage?: boolean;
  navigate?: (page: string) => void;
  onBack?: () => void;
}) {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    w = useWord(),
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
      | "quarantine"
    >("correction");
  const batchesByProduct = useMemo(
    () => groupBatches(state.batches),
    [state.batches],
  );
  // Filter on a deferred copy so a long list never blocks the keyboard (fast typing dropped letters).
  const deferredSearch = useDeferredValue(search);
  const matching = useMemo(() => {
    return Object.values(state.products)
      .filter((p) => matchesSearch(p, deferredSearch))
      .sort(bySearch(deferredSearch));
  }, [state.products, deferredSearch]);
  const today = indiaDate(new Date().toISOString()),
    hi = s.language === "hi";
  /** An owner tool: a ruled row, an icon in ink, the name. Two sit side by side. */
  const tool = (
    icon: React.ComponentProps<typeof Icon>["name"],
    label: string,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderBottomWidth: 1,
        borderColor: palette.rule,
        backgroundColor: pressed ? palette.desk : "transparent",
      })}
    >
      <Icon name={icon} size={22} color={palette.blue} />
      <Txt size={15} weight={600} color={palette.blue} style={{ flex: 1 }}>
        {label}
      </Txt>
    </Pressable>
  );
  return (
    <Page
      onBack={manage ? onBack : undefined}
      title={manage ? t("inventory") : t("stock")}
      subtitle={
        hi
          ? "बैच के हिसाब से स्टॉक, एक्सपायरी और जाँची हुई गिनती।"
          : "Batch-level stock, expiry, and verified physical counts."
      }
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
        <View style={{ marginBottom: 20 }}>
          <Row style={{ gap: 20, alignItems: "stretch" }}>
            {tool("add-circle-outline", "Add medicine", () => setEditing(null))}
            {tool("clipboard-outline", "Count stock", () => setCounting(true))}
          </Row>
          <Row style={{ gap: 20, alignItems: "stretch" }}>
            {tool("cloud-upload-outline", "Import catalogue", () =>
              setImporting(true),
            )}
            {navigate ? (
              tool("hourglass-outline", t("expiry"), () => navigate("expiry"))
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </Row>
        </View>
      )}
      {matching.length > SHOWN_PRODUCTS && (
        <Txt size={13} muted style={{ marginBottom: 12 }}>
          {s.language === "hi"
            ? `${matching.length.toLocaleString("en-IN")} में से ${SHOWN_PRODUCTS} दिख रहे हैं · खोजकर ढूँढें`
            : `Showing ${SHOWN_PRODUCTS} of ${matching.length.toLocaleString("en-IN")} · search to find others`}
        </Txt>
      )}
      {matching.slice(0, SHOWN_PRODUCTS).map((p) => {
        const batches = batchesByProduct.get(p.id) ?? [];
        const total = batches.reduce((n, b) => n + Number(b.quantity), 0);
        const low = total <= Number(p.reorderAt);
        const expired = batches.some(
          (b) => b.expiry < today && Number(b.quantity) > 0,
        );
        const first = batches[0];
        return (
          <ListRow
            key={p.id}
            title={
              <Txt size={16} weight={600}>
                {p.name} <Txt color={palette.ink2}>{p.strength}</Txt>
              </Txt>
            }
            detail={
              <View style={{ gap: 6 }}>
                {!!p.generic && (
                  <Txt size={14} color={palette.ink2}>
                    {p.generic}
                  </Txt>
                )}
                <Row style={{ flexWrap: "wrap", gap: 8 }}>
                  <Txt size={14} weight={600} num>
                    {hi
                      ? `${Number(total.toFixed(3))} ${w(p.baseUnit)} बचे`
                      : `${amountOf(Number(total.toFixed(3)), p.baseUnit, w)} left`}
                  </Txt>
                  {low && <Badge tone="waiting">{hi ? "कम" : "Low"}</Badge>}
                  {expired && (
                    <Badge tone="declined">{hi ? "एक्सपायर" : "Expired"}</Badge>
                  )}
                </Row>
              </View>
            }
            trailing={
              <Row style={{ gap: 4 }}>
                {first && (
                  <View style={{ alignItems: "flex-end" }}>
                    <Amount value={rupees(first.pricePaise)} size={16} />
                    {first.mrpPaise > 0 && (
                      <Txt size={13} color={palette.ink3} num>
                        {`MRP ${rupees(first.mrpPaise)}`}
                      </Txt>
                    )}
                  </View>
                )}
                {manage && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={hi ? "दवा बदलें" : "Edit medicine"}
                    onPress={() => setEditing(p)}
                    hitSlop={8}
                    style={{
                      width: 40,
                      height: 48,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="create-outline" size={22} color={palette.ink2} />
                  </Pressable>
                )}
              </Row>
            }
          >
            {batches.map((b) => {
              const batchExpired = b.expiry < today;
              const batchLow = Number(b.quantity) <= Number(p.reorderAt);
              return (
                <Pressable
                  key={b.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setAdjust(b);
                    setDelta("");
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    minHeight: 48,
                    paddingVertical: 8,
                    borderTopWidth: 1,
                    borderColor: palette.rule,
                    backgroundColor: pressed ? palette.desk : "transparent",
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size={14} weight={600} num>
                      {b.code}
                      <Txt size={14} weight={400} color={palette.ink2}>
                        {` · ${hi ? "समाप्ति" : "Exp"} ${b.expiry}`}
                      </Txt>
                    </Txt>
                    <Txt size={13} color={palette.ink3} num>
                      {`${rupees(b.pricePaise)} / ${w(p.baseUnit)}`}
                      {Number(b.quarantined) > 0
                        ? ` · ${b.quarantined} quarantined`
                        : ""}
                    </Txt>
                  </View>
                  <Txt
                    size={15}
                    weight={600}
                    num
                    color={
                      batchExpired
                        ? palette.declined
                        : batchLow
                          ? palette.waiting
                          : palette.ink
                    }
                  >
                    {amountOf(b.quantity, p.baseUnit, w)}
                  </Txt>
                </Pressable>
              );
            })}
            {manage && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setBatchProduct(p)}
                style={{
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon name="add" size={18} color={palette.blue} />
                <Txt size={14} weight={600} color={palette.blue}>
                  Record opening batch count
                </Txt>
              </Pressable>
            )}
          </ListRow>
        );
      })}
      {matching.length === 0 && (
        <Empty
          icon="cube-outline"
          title={hi ? "कोई दवा नहीं मिली" : "No medicines found"}
        />
      )}
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
                  "quarantine",
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
                  if (!/^-?(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(delta.trim()))
                    throw new Error(
                      "Enter the change as a number, for example -2 to remove 2.",
                    );
                  if (Number(delta) === 0)
                    throw new Error("The change cannot be zero");
                  if (reason.trim().length < 3)
                    throw new Error(
                      "Write a short reason (at least 3 letters)",
                    );
                  await s.command({
                    type: "approval.request",
                    approvalId: uid(),
                    kind: "stock",
                    payload: {
                      batchId: adjust.id,
                      quantity: delta.trim(),
                      kind,
                      reason: reason.trim(),
                    },
                    reason: reason.trim(),
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
    <View
      style={{
        marginBottom: 24,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderColor: palette.ruleStrong,
      }}
    >
      <Txt size={19} weight={600} style={{ marginBottom: 12 }}>
        Owner price update
      </Txt>
      <Field
        label="Selling price per base unit (₹)"
        value={price}
        onChange={P}
        number
      />
      <Field label="Reason" value={reason} onChange={R} />
      <View style={{ marginBottom: 16 }}>
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
    </View>
  );
}
export function MoneyScreen({ onBack }: { onBack?: () => void }) {
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
  const shortDate = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(hi ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const diffTone = (p: number = 0) =>
    p < 0 ? ("declined" as const) : p > 0 ? ("waiting" as const) : ("paid" as const);
  return (
    <Page
      onBack={onBack}
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
            <Entry
              key={e.id}
              time={shortDate(e.date)}
              onPress={() => setOpen(e.id)}
              title={new Date(`${e.date}T00:00:00Z`).toLocaleDateString(
                hi ? "hi-IN" : "en-IN",
                { weekday: "long", timeZone: "UTC" },
              )}
              detail={`${hi ? "संस्करण" : "Revision"} ${e.revision} · ${
                e.provisional
                  ? hi
                    ? "फ़ोन सिंक बाकी"
                    : "waiting for phones"
                  : hi
                    ? "सिंक पूरा"
                    : "synced"
              }`}
              amount={rupees(e.totals.netSalesPaise)}
            >
              {drawerDiff !== undefined && (
                <Row style={{ gap: 8 }}>
                  <Txt size={13} color={palette.ink3}>
                    {hi ? "दराज़" : "Drawer"}
                  </Txt>
                  <Badge tone={diffTone(drawerDiff)}>
                    {differenceText(drawerDiff)}
                  </Badge>
                </Row>
              )}
            </Entry>
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
        <View style={{ marginTop: 16, alignItems: "flex-start" }}>
          <Button
            small
            secondary
            onPress={() =>
              void run(() => s.command({ type: "eod.close", date: today }))
            }
          >
            {hi ? "आज की रिपोर्ट अभी बनाएँ" : "Make today's report now"}
          </Button>
        </View>
      </Section>
      <Section title={hi ? "दराज़ का इतिहास" : "Drawer history"}>
        {closes.map((d) => (
          <Entry
            key={d.id}
            time={shortDate(indiaDate(d.closedAt!))}
            title={`${hi ? "बंद" : "Closed"} ${clock(d.closedAt)}`}
            who={{
              id: d.closedBy,
              name: state.members[d.closedBy ?? ""]?.name,
            }}
            detail={`${hi ? "गिना" : "Counted"} ${rupees(d.countedPaise ?? 0)} · ${hi ? "होना था" : "expected"} ${rupees(d.expectedAtClose ?? 0)} · ${state.members[d.closedBy ?? ""]?.name ?? ""}${
              expectedCash(state, d.id) !== d.expectedAtClose
                ? ` · ${hi ? "बाद में बदला" : "changed later by"} ${rupees(expectedCash(state, d.id) - (d.expectedAtClose ?? 0))}`
                : ""
            }`}
          >
            <Badge tone={diffTone(d.discrepancyPaise)}>
              {differenceText(d.discrepancyPaise)}
            </Badge>
          </Entry>
        ))}
        {!closes.length && (
          <Empty
            icon="lock-closed-outline"
            title={hi ? "अभी कोई बंद दराज़ नहीं" : "No closed drawers yet"}
          />
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
  return approvalSummary(state, a, hi);
}
function ApprovalDetails({ approval }: { approval: Approval }) {
  const { state, language } = useSession();
  const w = useWord();
  const hi = language === "hi";
  const p = approval.payload,
    s = state!,
    o = s.orders[String(p.orderId)],
    i = s.invoices[String(p.invoiceId)],
    b = s.batches[String(p.batchId)];
  const customerId = String(
    p.customerId ?? o?.customerId ?? i?.customerId ?? "",
  );
  const requester = s.members[approval.requestedBy];
  const decider = approval.decidedBy ? s.members[approval.decidedBy] : undefined;
  // A statement line whose right side can be a mark, an identifier or plain text.
  const fact = (label: string, node: React.ReactNode) => (
    <View
      key={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 9,
        minHeight: 44,
        gap: 12,
        borderBottomWidth: 1,
        borderColor: palette.rule,
      }}
    >
      <Txt size={15} color={palette.ink2}>
        {label}
      </Txt>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>{node}</View>
    </View>
  );
  let refund: ReturnType<typeof refundQuote> | null = null;
  let refundError = "";
  if (i) {
    try {
      refund = refundQuote(s, i, p.lines as ReturnLine[]);
    } catch (e) {
      refundError = (e as Error).message;
    }
  }
  const bigAmount =
    typeof p.amountPaise === "number"
      ? rupees(p.amountPaise)
      : refund
        ? rupees(refund.payablePaise)
        : undefined;
  const kindWord =
    approval.kind === "credit"
      ? hi
        ? "उधार"
        : "Credit"
      : approval.kind === "discount"
        ? hi
          ? "छूट"
          : "Discount"
        : approval.kind === "refund"
          ? hi
            ? "वापसी"
            : "Return"
          : hi
            ? "स्टॉक बदलाव"
            : "Stock change";
  const heading = customerId
    ? `${kindWord} · ${s.customers[customerId]?.name ?? ""}`
    : i
      ? `${kindWord} · ${i.number}`
      : kindWord;
  return (
    <View>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          {bigAmount !== undefined && (
            <Amount value={bigAmount} size={40} weight={700} />
          )}
          <Txt size={16} weight={600} color={palette.ink2}>
            {heading}
          </Txt>
        </View>
        {approval.status === "approved" || approval.status === "used" ? (
          <Stamp
            tone="approved"
            land
            date={
              approval.decidedAt ? stampDate(approval.decidedAt, language) : undefined
            }
          >
            {hi ? "मंज़ूर" : "Approved"}
          </Stamp>
        ) : approval.status === "rejected" ? (
          <Stamp
            tone="declined"
            land
            date={
              approval.decidedAt ? stampDate(approval.decidedAt, language) : undefined
            }
          >
            {hi ? "अस्वीकृत" : "Declined"}
          </Stamp>
        ) : null}
      </Row>
      {!!approval.reason && (
        <Txt size={14} color={palette.ink2} style={{ marginTop: 8 }}>
          {approval.reason}
        </Txt>
      )}
      <View style={{ marginTop: 20 }}>
        {fact(
          hi ? "माँगने वाले" : "Requested by",
          <Row style={{ gap: 8 }}>
            <StaffMark
              id={approval.requestedBy}
              name={requester?.name}
              size={26}
            />
            <Txt size={15} weight={600}>
              {requester?.name}
            </Txt>
          </Row>,
        )}
        {decider &&
          fact(
            hi ? "फ़ैसला किया" : "Decided by",
            <Row style={{ gap: 8 }}>
              <StaffMark id={approval.decidedBy} name={decider.name} size={26} />
              <Txt size={15} weight={600}>
                {decider.name}
              </Txt>
            </Row>,
          )}
        {customerId &&
          fact(
            hi ? "ग्राहक" : "Customer",
            <Txt size={15} weight={600}>
              {s.customers[customerId]?.name}
            </Txt>,
          )}
        {customerId &&
          !!s.customers[customerId]?.phone &&
          fact(
            hi ? "फ़ोन" : "Phone",
            <Txt size={15} num>
              {s.customers[customerId]?.phone}
            </Txt>,
          )}
        {o &&
          fact(
            hi ? "समय" : "Time",
            <Txt size={15} num>
              {dateTime24(o.createdAt)}
            </Txt>,
          )}
        {o &&
          fact(
            hi ? "काउंटर" : "Counter",
            <Txt size={15} num weight={600}>
              {o.counterId}
            </Txt>,
          )}
        {i &&
          fact(
            hi ? "बिल" : "Bill",
            <Txt size={15} num weight={600}>
              {i.number}
            </Txt>,
          )}
        {i &&
          fact(
            hi ? "समय" : "Time",
            <Txt size={15} num>
              {dateTime24(i.occurredAt)}
            </Txt>,
          )}
        {i &&
          fact(
            hi ? "बिल बनाया" : "Billed by",
            <Row style={{ gap: 8 }}>
              <StaffMark
                id={i.collectorId}
                name={s.members[i.collectorId]?.name}
                size={26}
              />
              <Txt size={15} weight={600}>
                {s.members[i.collectorId]?.name}
              </Txt>
            </Row>,
          )}
      </View>
      {customerId && approval.kind === "credit" && (
        <Txt size={14} weight={600} color={palette.waiting} style={{ marginTop: 12 }}>
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
      {o && o.lines.length > 0 && (
        <View style={{ marginTop: 20 }}>
          <Txt size={14} weight={600} color={palette.ink2} style={{ marginBottom: 4 }}>
            {hi ? "दवाएँ" : "Items"}
          </Txt>
          {o.lines.map((l, n) => {
            const batch = s.batches[l.batchId],
              product = s.products[batch.productId];
            return (
              <Line
                key={n}
                label={`${product.name} ${product.strength}`.trim()}
                value={`${l.quantity} ${l.unit}`}
                note={
                  <Txt size={13} num weight={600} color={palette.ink3}>
                    {batch.code}
                  </Txt>
                }
              />
            );
          })}
        </View>
      )}
      {i && (
        <View style={{ marginTop: 20 }}>
          <Txt size={14} weight={600} color={palette.ink2} style={{ marginBottom: 4 }}>
            {hi ? "लौटाई जा रही दवाएँ" : "Items returned"}
          </Txt>
          {(p.lines as ReturnLine[]).map((l, n) => {
            const item = i.lines[l.index];
            const unit = s.products[item?.productId ?? ""]?.baseUnit ?? "";
            return (
              <Line
                key={n}
                label={`${item?.name ?? ""} ${item?.strength ?? ""}`.trim()}
                value={`${amountOf(l.quantity, unit, w)} of ${item?.baseQuantity}`}
                note={
                  <Txt size={13} num weight={600} color={palette.ink3}>
                    {item?.batchCode}
                  </Txt>
                }
              />
            );
          })}
          {refund && (
            <>
              <TotalRule />
              <Line
                strong
                label={hi ? "ग्राहक को वापसी" : "Refund to the customer"}
                value={rupees(refund.payablePaise)}
                note={
                  refund.creditReductionPaise > 0 ? (
                    <Txt size={13} color={palette.waiting}>
                      {rupees(refund.creditReductionPaise)} comes off what the
                      customer owes
                    </Txt>
                  ) : undefined
                }
              />
            </>
          )}
          {!!refundError && (
            <Txt size={14} color={palette.declined} style={{ marginTop: 8 }}>
              {refundError}
            </Txt>
          )}
        </View>
      )}
      {b && (
        <View style={{ marginTop: 20 }}>
          <Line
            strong
            label={s.products[b.productId]?.name ?? ""}
            value={b.code}
          />
          <Line
            label={String(p.kind).replaceAll("_", " ")}
            value={amountOf(
              String(p.quantity),
              s.products[b.productId]?.baseUnit ?? "",
              w,
            )}
          />
          <Line label="Available" value={String(b.quantity)} />
          <Line label="Quarantined" value={String(b.quarantined)} />
        </View>
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
    <View style={{ marginBottom: 20 }}>
      {q && op?.type === "offline.checkout" && (
        <>
          {s.devices[op.deviceId] && (
            <Line
              strong
              label="Bill"
              value={invoiceNumber(
                command.occurredAt,
                s.devices[op.deviceId].series,
                op.sequence,
              )}
            />
          )}
          <Line
            label={
              <Row style={{ gap: 8 }}>
                <StaffMark
                  id={q.actorId}
                  name={s.members[q.actorId]?.name}
                  size={26}
                />
                <Txt size={15} weight={600}>
                  {s.members[q.actorId]?.name}
                </Txt>
              </Row>
            }
            value={rupees(op.cashPaise)}
          />
          <Line
            label={dateTime24(command.occurredAt)}
            value={op.counterId}
          />
          {op.lines.map((l: any, index: number) => {
            const b = s.batches[l.batchId],
              p = b ? s.products[b.productId] : undefined;
            return (
              <Line
                key={index}
                label={`${p?.name ?? "Unknown product"} ${p?.strength ?? ""}`.trim()}
                value={`${l.quantity} ${l.unit}`}
                note={
                  <Txt size={13} num weight={600} color={palette.ink3}>
                    {b?.code ?? l.batchId}
                  </Txt>
                }
              />
            );
          })}
        </>
      )}
      {observation && (
        <>
          <Line strong label="Counter" value={observation.counterId} />
          <Line
            label={`${dateTime24(observation.startedAt)} – ${dateTime24(observation.endedAt)}`}
            value=""
          />
          <Txt size={14} color={palette.ink2} style={{ marginTop: 8 }}>
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
export function ReviewsScreen({ onBack }: { onBack?: () => void }) {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    run = useRun();
  const [selected, setSelected] = useState<Approval | null>(null),
    [reason, R] = useState(""),
    [reviewId, V] = useState(""),
    [confirmCancel, setConfirmCancel] = useState(false);
  const hi = s.language === "hi";
  // After a sheet closes from an action, the next row slides under the finger. Ignore the list
  // briefly so a double tap on Approve does not open the next request.
  const listLockedUntil = useRef(0);
  const sheetOpen = !!selected || !!reviewId;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !sheetOpen) listLockedUntil.current = Date.now() + 600;
    wasOpen.current = sheetOpen;
  }, [sheetOpen]);
  const listOpen = (open: () => void) => () => {
    if (Date.now() < listLockedUntil.current) return;
    open();
  };
  const pending = Object.values(state.approvals).filter(
    (a) =>
      (a.status === "pending" || a.status === "approved") &&
      approvalLive(state, a),
  );
  const entryTime = (at: string) =>
    indiaDate(at) === indiaDate(new Date().toISOString())
      ? new Date(at).toLocaleTimeString("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
        })
      : new Date(at).toLocaleDateString(hi ? "hi-IN" : "en-IN", {
          day: "numeric",
          month: "short",
          timeZone: "Asia/Kolkata",
        });
  // Kind and customer for the row title, the amount asked for, and the items on the order.
  const approvalParts = (a: Approval) => {
    const p = a.payload,
      o = state.orders[String(p.orderId)],
      inv = state.invoices[String(p.invoiceId)],
      customer =
        state.customers[
          String(p.customerId ?? o?.customerId ?? inv?.customerId ?? "")
        ]?.name;
    const kind =
      a.kind === "credit"
        ? hi
          ? "उधार"
          : "Credit"
        : a.kind === "discount"
          ? hi
            ? "छूट"
            : "Discount"
          : a.kind === "refund"
            ? hi
              ? "वापसी"
              : "Return"
            : hi
              ? "स्टॉक बदलाव"
              : "Stock change";
    let amount: string | undefined;
    if (typeof p.amountPaise === "number") amount = rupees(p.amountPaise);
    else if (a.kind === "refund" && inv) {
      try {
        amount = rupees(
          refundQuote(state, inv, p.lines as ReturnLine[]).payablePaise,
        );
      } catch {}
    }
    const names = o
      ? o.lines
          .map((l) => state.products[state.batches[l.batchId]?.productId]?.name)
          .filter(Boolean)
      : inv
        ? (p.lines as ReturnLine[])
            .map((l) => inv.lines[l.index]?.name)
            .filter(Boolean)
        : [];
    return {
      heading: customer
        ? `${kind} · ${customer}`
        : inv
          ? `${kind} · ${inv.number}`
          : kind,
      amount,
      items: names.join(", "),
    };
  };
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
      onBack={onBack}
      title={t("reviews")}
      subtitle="Approvals and evidence that need a human decision."
    >
      <Section title="Approval requests">
        {pending
          .filter((a) => a.status === "pending")
          .map((a) => {
            const x = approvalParts(a);
            return (
              <Entry
                key={a.id}
                time={entryTime(a.requestedAt)}
                title={x.heading}
                detail={
                  <Txt size={14} color={palette.ink2} numberOfLines={2}>
                    {[approvalReason(a.reason, hi), x.items].filter(Boolean).join(" · ")}
                  </Txt>
                }
                who={{
                  id: a.requestedBy,
                  name: state.members[a.requestedBy]?.name,
                }}
                amount={x.amount}
                onPress={listOpen(() => {
                  setSelected(a);
                  setConfirmCancel(false);
                })}
              >
                <Badge tone="waiting">{hi ? "इंतज़ार" : "Waiting"}</Badge>
              </Entry>
            );
          })}
        {!pending.some((a) => a.status === "pending") && (
          <Empty icon="checkmark-done-outline" title="No approvals waiting" />
        )}
      </Section>
      {pending.some((a) => a.status === "approved") && (
        <Section title={hi ? "मंज़ूर, इस्तेमाल बाकी" : "Approved, not yet used"}>
          {pending
            .filter((a) => a.status === "approved")
            .map((a) => {
              const x = approvalParts(a);
              return (
                <Entry
                  key={a.id}
                  time={entryTime(a.decidedAt ?? a.requestedAt)}
                  title={
                    <Txt size={16} weight={600} color={palette.ink2}>
                      {x.heading}
                    </Txt>
                  }
                  detail={
                    <Txt size={14} color={palette.ink3} numberOfLines={2}>
                      {[approvalReason(a.reason, hi), x.items].filter(Boolean).join(" · ")}
                    </Txt>
                  }
                  who={{
                    id: a.requestedBy,
                    name: state.members[a.requestedBy]?.name,
                  }}
                  amount={x.amount}
                  amountColor={palette.ink2}
                  onPress={listOpen(() => {
                    setSelected(a);
                    setConfirmCancel(false);
                  })}
                >
                  <Badge tone="approved">{hi ? "मंज़ूर" : "Approved"}</Badge>
                </Entry>
              );
            })}
        </Section>
      )}
      <Section title="Exceptions and camera pilot">
        {Object.values(state.reviews)
          .filter((r) => r.status === "open")
          .map((r) => (
            <ListRow
              key={r.id}
              onPress={listOpen(() => V(r.id))}
              leading={
                <Icon
                  name={
                    r.kind === "camera"
                      ? "videocam-outline"
                      : "alert-circle-outline"
                  }
                  size={22}
                  color={palette.waiting}
                />
              }
              title={reviewTitle(r.title, hi)}
              detail={reviewDetail(r.detail, hi)}
            />
          ))}
        <Txt size={13} color={palette.ink3} style={{ marginTop: 12 }}>
          Camera observations are review candidates. Employee alerts and
          automatic theft conclusions are disabled.
        </Txt>
      </Section>
      <Section title="Shop backups">
        <Txt size={14} color={palette.ink2} style={{ marginTop: 8, marginBottom: 4 }}>
          Bring back sales that only reached the shop PC.
        </Txt>
        <View style={{ alignItems: "flex-start" }}>
        <Button
          variant="secondary"
          small
          icon="cloud-download-outline"
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
      </Section>
      <Sheet
        visible={!!selected}
        title="Review approval"
        onClose={() => {
          setSelected(null);
          setConfirmCancel(false);
        }}
      >
        {selected && (
          <>
            <ApprovalDetails approval={selected} />
            <View style={{ height: 24 }} />
            {selected.status === "pending" ? (
              <>
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
                <View style={{ height: 32 }} />
                <View style={{ alignItems: "flex-end" }}>
                  <Button
                    variant="danger"
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
                </View>
              </>
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
              <>
                <RefundForm
                  approval={selected}
                  onDone={() => setSelected(null)}
                />
                <View style={{ height: 32 }} />
                {confirmCancel ? (
                  <View style={{ gap: 12 }}>
                    <Txt color={palette.ink2}>
                      {hi
                        ? "यह वापसी मंज़ूरी रद्द हो जाएगी और पैसा नहीं लौटाया जा सकेगा। पक्का?"
                        : "This cancels the approved return. No money can be given back on it. Sure?"}
                    </Txt>
                    <Button variant="quiet" onPress={() => setConfirmCancel(false)}>
                      {hi ? "नहीं" : "Keep it"}
                    </Button>
                    <View style={{ height: 12 }} />
                    <View style={{ alignItems: "flex-end" }}>
                      <Button
                        variant="danger"
                        onPress={() =>
                          void run(async () => {
                            await s.command({
                              type: "approval.decide",
                              approvalId: selected.id,
                              approve: false,
                              reason:
                                "Cancelled by the owner before the refund",
                            });
                            setConfirmCancel(false);
                            setSelected(null);
                          })
                        }
                      >
                        {hi ? "हाँ, रद्द करें" : "Yes, cancel approval"}
                      </Button>
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: "flex-end" }}>
                    <Button
                      variant="danger"
                      onPress={() => setConfirmCancel(true)}
                    >
                      {hi ? "मंज़ूरी रद्द करें" : "Cancel approval"}
                    </Button>
                  </View>
                )}
              </>
            ) : (
              <Txt color={palette.ink2}>
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
            <Txt color={palette.ink2} style={{ marginBottom: 20 }}>
              {reviewDetail(state.reviews[reviewId]?.detail ?? "", hi)}
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
              <>
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
                <View style={{ height: 32 }} />
                <View style={{ alignItems: "flex-end" }}>
                  <Button
                    variant="danger"
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
                </View>
              </>
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
  const hi = s.language === "hi";
  const actor = s.identity!.actor;
  const actorName = s.state!.members[actor.id]?.name ?? "";
  const assigned = s.state!.devices[s.identity!.deviceId]?.counterId ?? counter;
  const pendingReviews = Object.values(s.state!.approvals).filter(
    (a) => a.status === "pending",
  ).length;
  const lead = (name: React.ComponentProps<typeof Icon>["name"]) => (
    <Icon name={name} size={22} color={palette.ink2} />
  );
  const ownerIcons = {
    overview: "grid-outline",
    inventory: "cube-outline",
    money: "cash-outline",
    reviews: "checkmark-done-outline",
    administration: "settings-outline",
  } as const;
  return (
    <Page title={t("more")}>
      <Row style={{ gap: 14, marginBottom: 28 }}>
        <StaffMark id={actor.id} name={actorName} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={19} weight={600}>
            {actorName}
          </Txt>
          <Txt size={14} color={palette.ink2}>
            {actor.role === "owner"
              ? hi
                ? "मालिक"
                : "Owner"
              : hi
                ? "स्टाफ"
                : "Staff"}
            {` · ${s.state!.settings.name}`}
          </Txt>
          <Txt size={13} color={palette.ink3} num>
            {assigned}
          </Txt>
        </View>
      </Row>
      {actor.role === "owner" && (
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
            <ListRow
              key={p}
              leading={lead(ownerIcons[p])}
              title={t(p)}
              onPress={() => navigate(p)}
              trailing={
                p === "reviews" && pendingReviews > 0 ? (
                  <Badge tone="waiting">
                    {`${pendingReviews} ${t("pending")}`}
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </Section>
      )}
      {actor.role !== "owner" && (
        <Section title={hi ? "नकद दराज़" : "Cash drawer"}>
          <DrawerPanel />
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
      <Section title="My cash collections">
        <Amount
          size={28}
          weight={700}
          value={rupees(
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
        />
      </Section>
      <View style={{ marginBottom: 32 }}>
        <ListRow
          leading={lead("language-outline")}
          title={t("language")}
          chevron={false}
        >
          <Row style={{ flexWrap: "wrap", gap: 8 }}>
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
        </ListRow>
      </View>
      <Section title="Device and synchronisation">
        <ListRow
          leading={lead("phone-portrait-outline")}
          title={
            <Txt size={16} weight={600} num>
              {s.demo ? "Preview device" : s.identity!.deviceId}
            </Txt>
          }
          detail={
            <Txt size={14} color={palette.ink2}>
              Offline authorisation expires{" "}
              {dateTime24(s.identity!.expiresAt)}
            </Txt>
          }
        />
        <ListRow
          leading={lead("information-circle-outline")}
          title={
            <Txt size={16} weight={600} num>
              {appVersion(s.language === "hi")}
            </Txt>
          }
        />
        {s.pending.map((p) => (
          <ListRow
            key={p.command.id}
            title={
              <Badge warning={p.status === "review"}>
                {p.status === "local"
                  ? "Saved on this phone"
                  : p.status === "gateway"
                    ? "Backed up at shop"
                    : "Owner recovery required"}
              </Badge>
            }
            detail={
              <Txt size={13} color={palette.ink3} num>
                {p.command.id.slice(0, 12)} {p.error}
              </Txt>
            }
          />
        ))}
        <View style={{ marginTop: 16 }}>
          <Button secondary onPress={() => void s.sync()} icon="sync-outline">
            {t("sync")}
          </Button>
        </View>
      </Section>
      <View style={{ marginTop: 32 }}>
        <Button variant="danger" onPress={() => void run(s.logout)}>
          {t("logout")}
        </Button>
      </View>
    </Page>
  );
}
export function AdministrationScreen({ onBack }: { onBack?: () => void }) {
  const s = useSession(),
    state = s.state!,
    run = useRun();
  const [settings, S] = useState(state.settings),
    [name, N] = useState(""),
    [username, U] = useState(""),
    [password, P] = useState(""),
    [staffErrors, setStaffErrors] = useState<Record<string, string>>({}),
    [collect, C] = useState(true),
    [employee, setEmployee] = useState<string | null>(null);
  const usernameRef = useRef<TextInput>(null),
    passwordRef = useRef<TextInput>(null);
  return (
    <Page
      onBack={onBack}
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
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!settings.readinessConfirmed }}
          onPress={() =>
            S({ ...settings, readinessConfirmed: !settings.readinessConfirmed })
          }
          style={{ minHeight: 48, justifyContent: "center", marginBottom: 16 }}
        >
          <Row style={{ alignItems: "flex-start" }}>
            <Icon
              name={settings.readinessConfirmed ? "checkbox" : "square-outline"}
              size={24}
              color={settings.readinessConfirmed ? palette.blue : palette.ink3}
            />
            <Txt style={{ flex: 1 }} size={14} color={palette.ink2}>
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
        <Field
          label="Employee name"
          value={name}
          error={staffErrors.name}
          onChange={(v: string) => {
            N(v);
            setStaffErrors((e) => ({ ...e, name: "" }));
          }}
          returnKeyType="next"
          onSubmit={() => usernameRef.current?.focus()}
        />
        <Field
          label="Unique username"
          value={username}
          error={staffErrors.username}
          hint={
            s.language === "hi"
              ? "3 से 30 अक्षर: अंग्रेज़ी अक्षर, अंक, _ या ."
              : "3 to 30 characters: letters, numbers, _ or ."
          }
          onChange={(v: string) => {
            U(v);
            setStaffErrors((e) => ({ ...e, username: "" }));
          }}
          identifier
          inputRef={usernameRef}
          returnKeyType="next"
          onSubmit={() => passwordRef.current?.focus()}
        />
        <Field
          label="Temporary password"
          value={password}
          error={staffErrors.password}
          hint={
            s.language === "hi"
              ? "कम से कम 12 अक्षर"
              : "At least 12 characters"
          }
          onChange={(v: string) => {
            P(v);
            setStaffErrors((e) => ({ ...e, password: "" }));
          }}
          secret
          inputRef={passwordRef}
          returnKeyType="done"
        />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: collect }}
          onPress={() => C(!collect)}
          style={{ minHeight: 48, justifyContent: "center", marginBottom: 16 }}
        >
          <Row>
            <Icon
              name={collect ? "checkbox" : "square-outline"}
              size={24}
              color={collect ? palette.blue : palette.ink3}
            />
            <Txt size={15}>May collect payments</Txt>
          </Row>
        </Pressable>
        <Button
          onPress={() =>
            void run(async () => {
              const hi = s.language === "hi";
              const found: Record<string, string> = {};
              if (!name.trim())
                found.name = hi ? "कर्मचारी का नाम भरें" : "Enter the employee's name";
              if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username))
                found.username = hi
                  ? "यूज़रनेम 3 से 30 अक्षर का हो: अंग्रेज़ी अक्षर, अंक, _ या ."
                  : "Username must be 3 to 30 characters: letters, numbers, _ or .";
              if (password.length < 12)
                found.password = hi
                  ? "पासवर्ड कम से कम 12 अक्षर का हो"
                  : "Password must be at least 12 characters";
              setStaffErrors(found);
              if (Object.keys(found).length) return;
              if (s.demo)
                throw new Error(
                  "Account creation requires a signed-in live shop.",
                );
              await s.request("/employees", {
                method: "POST",
                body: JSON.stringify({
                  name: name.trim(),
                  username,
                  password,
                  canCollect: collect,
                }),
              });
              await s.refresh();
              N("");
              U("");
              P("");
              setStaffErrors({});
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
            <ListRow
              key={m.id}
              onPress={() => setEmployee(m.id)}
              leading={<StaffMark id={m.id} name={m.name} size={36} />}
              title={m.name}
              detail={`Owner${m.username ? ` · ${m.username}` : ""}`}
            />
          ))}
        {Object.values(state.members)
          .filter((m) => m.role === "employee")
          .map((m) => (
            <ListRow
              key={m.id}
              onPress={() => setEmployee(m.id)}
              leading={<StaffMark id={m.id} name={m.name} size={36} />}
              title={m.name}
              detail={`${m.username ? `${m.username} · ` : ""}${
                m.canCollect ? "Can collect" : "Cannot collect"
              }${m.mustChangePassword ? " · Temporary password" : ""}`}
              trailing={
                <Badge tone={m.active ? "paid" : "neutral"}>
                  {m.active ? "Active" : "Disabled"}
                </Badge>
              }
            />
          ))}
      </Section>
      <Section title="Registered devices">
        {Object.values(state.devices).map((d) => (
          <ListRow
            key={d.id}
            title={
              <Row style={{ gap: 8 }}>
                <Txt size={16} weight={600} style={{ flexShrink: 1 }}>
                  {deviceText(deviceLabel(state, d), s.language)}
                </Txt>
                <Txt size={14} num weight={600} color={palette.ink2}>
                  {d.counterId}
                </Txt>
              </Row>
            }
            detail={
              <Txt size={13} color={palette.ink3} num>
                {s.language === "hi" ? "सीरीज़" : "Series"} {d.series} ·{" "}
                {d.pendingCount} {s.language === "hi" ? "बाकी" : "pending"} ·{" "}
                {s.language === "hi" ? "आख़िरी बार दिखा" : "Last seen"}{" "}
                {dateTime24(d.lastSeen)}
              </Txt>
            }
            trailing={d.revoked ? <Badge tone="declined">Revoked</Badge> : undefined}
          >
            {!d.revoked && (
              <View style={{ alignItems: "flex-end", marginTop: 4 }}>
                <Button
                  small
                  variant="danger"
                  onPress={() =>
                    void run(() =>
                      s.command({ type: "device.revoke", deviceId: d.id }),
                    )
                  }
                >
                  Revoke
                </Button>
              </View>
            )}
          </ListRow>
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
          {!!m.username && (
            <Row style={{ gap: 8 }}>
              <StaffMark id={m.id} name={m.name} size={36} />
              <Txt color={palette.ink2}>
                Username:{" "}
                <Txt num weight={600}>
                  {m.username}
                </Txt>
              </Txt>
            </Row>
          )}
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
                accessibilityRole="checkbox"
                accessibilityState={{ checked: m.canCollect }}
                onPress={() =>
                  void update({ active: m.active, canCollect: !m.canCollect })
                }
                style={{ minHeight: 48, justifyContent: "center" }}
              >
                <Row>
                  <Icon
                    name={m.canCollect ? "checkbox" : "square-outline"}
                    size={24}
                    color={m.canCollect ? palette.blue : palette.ink3}
                  />
                  <Txt style={{ flex: 1 }}>
                    May collect payments and handle the drawer
                  </Txt>
                </Row>
              </Pressable>
              <Section title="Forgot password">
                <Txt size={14} color={palette.ink2} style={{ marginBottom: 12 }}>
                  Set a temporary password. They are signed out on every phone
                  and choose their own password when they next sign in.
                </Txt>
                <Field
                  label="Temporary password"
                  value={password}
                  error={
                    password.length > 0 && password.length < 12
                      ? s.language === "hi"
                        ? "पासवर्ड कम से कम 12 अक्षर का हो"
                        : "Password must be at least 12 characters"
                      : undefined
                  }
                  hint={
                    s.language === "hi"
                      ? "कम से कम 12 अक्षर"
                      : "At least 12 characters"
                  }
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
                {!!done && (
                  <Txt color={palette.blue} style={{ marginTop: 12 }}>
                    {done}
                  </Txt>
                )}
              </Section>
              <View style={{ height: 16 }} />
              <View style={{ alignItems: "flex-end" }}>
                <Button
                  variant={m.active ? "danger" : "secondary"}
                  onPress={() =>
                    void update({ active: !m.active, canCollect: m.canCollect })
                  }
                >
                  {m.active ? "Disable and sign out" : "Enable"}
                </Button>
              </View>
            </>
          )}
        </View>
      )}
    </Sheet>
  );
}

/** "App 0.1.0 · build 1452340": which build a phone runs, when helping someone over the phone. */
function appVersion(hi = false) {
  const config = Constants.expoConfig;
  const build =
    Platform.OS === "android"
      ? config?.android?.versionCode
      : Platform.OS === "ios"
        ? config?.ios?.buildNumber
        : undefined;
  return `${hi ? "ऐप" : "App"} ${config?.version ?? ""}${build ? ` · ${hi ? "बिल्ड" : "build"} ${build}` : ""}`;
}
