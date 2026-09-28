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
export function OverviewScreen() {
  const s = useSession(),
    state = s.state!,
    t = useText();
  const [operations, O] = useState<any>(null);
  useEffect(() => {
    if (!s.demo)
      void s
        .request("/operations")
        .then(O)
        .catch(() => {});
  }, [state.revision, s.demo]);
  const today = indiaDate(new Date().toISOString()),
    data = totals(state, today);
  const [period, setPeriod] = useState<"today" | "all">("today");
  const metrics = period === "today" ? data : totals(state);
  const invoices = Object.values(state.invoices)
    .filter((i) => period === "all" || indiaDate(i.occurredAt) === today)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const low = Object.values(state.products).filter((p) =>
    Object.values(state.batches)
      .filter((b) => b.productId === p.id)
      .reduce((n, b) => n.plus(b.quantity), D(0))
      .lte(p.reorderAt),
  );
  return (
    <Page
      title={t("overview")}
      subtitle="A clear view of sales, collections, and what needs attention."
      action={
        <Row>
          <Chip active={period === "today"} onPress={() => setPeriod("today")}>
            {t("today")}
          </Chip>
          <Chip active={period === "all"} onPress={() => setPeriod("all")}>
            All time
          </Chip>
        </Row>
      }
    >
      <View
        style={{
          backgroundColor: colors.accent,
          borderRadius: 16,
          padding: 28,
          marginBottom: 28,
        }}
      >
        <Txt style={{ color: "#BFE1CE" }} size={12}>
          {t("sales")}
        </Txt>
        <Txt
          size={44}
          bold
          style={{ color: "white", marginTop: 10, letterSpacing: -1.5 }}
        >
          {rupees(metrics.netSalesPaise)}
        </Txt>
        <Txt size={12} style={{ color: "#BFE1CE", marginTop: 10 }}>
          {metrics.invoiceCount} completed bills · after returns
        </Txt>
      </View>
      <Row
        style={{
          justifyContent: "space-between",
          paddingBottom: 26,
          borderBottomWidth: 1,
          borderColor: colors.line,
          flexWrap: "wrap",
          gap: 22,
        }}
      >
        {[
          ["Cash collected", metrics.cashCollectedPaise],
          ["UPI collected", metrics.upiCollectedPaise],
          ["Customer dues", metrics.creditOutstandingPaise],
        ].map(([label, value]) => (
          <View key={label}>
            <Txt size={11} muted>
              {label}
            </Txt>
            <Txt size={22} bold style={{ marginTop: 8 }}>
              {rupees(Number(value))}
            </Txt>
          </View>
        ))}
      </Row>
      <View style={{ height: 26 }} />
      <Section title="Needs attention">
        <Row style={styles.listRow}>
          <Icon name="cube-outline" />
          <View style={{ flex: 1 }}>
            <Txt bold>{low.length} medicines at reorder level</Txt>
            <Txt muted size={12} style={{ marginTop: 4 }}>
              Review quantities before your next supplier order.
            </Txt>
          </View>
        </Row>
        <Row style={styles.listRow}>
          <Icon name="sync-outline" />
          <View style={{ flex: 1 }}>
            <Txt bold>{metrics.pendingDevices} devices with pending sales</Txt>
            <Txt muted size={12} style={{ marginTop: 4 }}>
              EOD remains provisional until every device has synced.
            </Txt>
          </View>
        </Row>
      </Section>
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
          <Txt muted>
            Pending extractions:{" "}
            {operations.jobs
              .filter((j: any) => ["pending", "running"].includes(j.status))
              .reduce((n: number, j: any) => n + j.count, 0)}{" "}
            · Failed:{" "}
            {operations.jobs
              .filter((j: any) => j.status === "failed")
              .reduce((n: number, j: any) => n + j.count, 0)}
          </Txt>
        </Section>
      )}
      <Section title="Recent sales">
        {invoices.slice(0, 8).map((i) => (
          <Row
            key={i.id}
            style={[styles.listRow, { justifyContent: "space-between" }]}
          >
            <View>
              <Txt bold>{i.number}</Txt>
              <Txt muted size={12} style={{ marginTop: 4 }}>
                {itemCount(i.lines.length, s.language)} ·{" "}
                {new Date(i.occurredAt).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Txt>
            </View>
            <Txt bold>{rupees(i.totalPaise)}</Txt>
          </Row>
        ))}
        {!invoices.length && (
          <Empty
            title="Your first bill will appear here"
            detail="Completed sales update this view. Customer repayments are counted as collections, not new sales."
          />
        )}
      </Section>
      <Txt muted size={11}>
        Estimated gross margin:{" "}
        {metrics.estimatedGrossMarginPaise === null
          ? "Unavailable until costs and returns are reconciled"
          : rupees(metrics.estimatedGrossMarginPaise)}
        . This is not net profit.
      </Txt>
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
  const [returnInvoice, setReturnInvoice] = useState<Invoice | null>(null);
  const me = s.identity!.actor;
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
          Open · {open.length}
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
        : filter === "bills" &&
          Object.values(state.invoices)
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .map((i) => (
              <View key={i.id} style={styles.listRow}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Pressable onPress={() => onInvoice(i)}>
                    <Txt bold>{i.number}</Txt>
                    <Txt size={12} muted style={{ marginTop: 5 }}>
                      {i.lines.map((l) => l.name).join(", ")}
                    </Txt>
                  </Pressable>
                  <Txt bold>{rupees(i.totalPaise)}</Txt>
                </Row>
                <Pressable
                  onPress={() => setReturnInvoice(i)}
                  style={{ paddingTop: 12 }}
                >
                  <Txt size={11} style={{ color: colors.accent }}>
                    Request return
                  </Txt>
                </Pressable>
              </View>
            ))}
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
    </Page>
  );
}
function ReturnForm({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: () => void;
}) {
  const s = useSession(),
    run = useRun();
  const [quantities, Q] = useState(invoice.lines.map(() => "0")),
    [reason, R] = useState("");
  return (
    <>
      <Txt muted>
        Enter only physically returned quantities in base units. Owner approval
        and refund execution are separate.
      </Txt>
      {invoice.lines.map((l, index) => (
        <View key={index} style={styles.listRow}>
          <Txt bold>
            {l.name} {l.strength} · {l.batchCode}
          </Txt>
          <Txt muted>Originally supplied: {l.baseQuantity}</Txt>
          <Field
            label="Returned base units"
            value={quantities[index]}
            onChange={(v) => Q(quantities.map((q, i) => (i === index ? v : q)))}
            number
          />
        </View>
      ))}
      <Field label="Reason" value={reason} onChange={R} />
      <Button
        disabled={reason.length < 3}
        onPress={() =>
          void run(async () => {
            const lines = quantities
              .map((quantity, index) => ({ quantity, index }))
              .filter((l) => D(l.quantity || 0).gt(0));
            if (!lines.length)
              throw new Error("Enter at least one returned quantity");
            await s.command({
              type: "approval.request",
              approvalId: uid(),
              kind: "refund",
              reason,
              payload: { invoiceId: invoice.id, lines },
            });
            onDone();
          })
        }
      >
        Request owner approval
      </Button>
    </>
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
      {Object.values(state.customers).map((c) => (
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
              <Txt bold>{rupees(balance(state, c.id))}</Txt>
              <Txt size={10} muted>
                outstanding
              </Txt>
            </View>
          </Row>
        </Pressable>
      ))}
      <Sheet visible={add} title="Add customer" onClose={() => setAdd(false)}>
        <Field label={t("name")} value={name} onChange={setName} />
        <Field label={t("phone")} value={phone} onChange={setPhone} />
        <Field label={t("address")} value={address} onChange={setAddress} />
        <Button
          onPress={() =>
            void run(async () => {
              await s.command({
                type: "customer.create",
                customer: { id: uid(), name, phone, address },
              });
              setAdd(false);
              setName("");
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
            <Txt size={30} bold style={{ marginBottom: 20 }}>
              {rupees(balance(state, selected))}
            </Txt>
            <Field
              label="Repayment amount (₹)"
              value={amount}
              onChange={setAmount}
              number
            />
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
              .map((l) => (
                <Row
                  key={l.id}
                  style={[styles.listRow, { justifyContent: "space-between" }]}
                >
                  <Txt size={12}>{l.kind.replaceAll("_", " ")}</Txt>
                  <Txt>{rupees(l.amountPaise)}</Txt>
                </Row>
              ))}
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
    run = useRun();
  const active = Object.values(state.drawers).find((d) => !d.closedAt);
  const [amount, A] = useState(""),
    [reason, R] = useState(""),
    [kind, K] = useState<"introduced" | "withdrawal" | "safe_transfer">(
      "withdrawal",
    ),
    [count, C] = useState("");
  return (
    <Page
      title={t("money")}
      subtitle="One shared drawer. Every recorded movement has an actor."
    >
      {active ? (
        <>
          <View style={[styles.panel, { marginBottom: 24 }]}>
            <Txt muted size={12}>
              {t("expected")}
            </Txt>
            <Txt size={38} bold style={{ marginTop: 9 }}>
              {rupees(expectedCash(state, active.id))}
            </Txt>
            <Txt size={12} muted style={{ marginTop: 10 }}>
              Opening float {rupees(active.openingPaise)}
            </Txt>
          </View>
          <Section title="Record cash movement">
            <Row style={{ flexWrap: "wrap", marginBottom: 4 }}>
              {(["introduced", "withdrawal", "safe_transfer"] as const).map(
                (k) => (
                  <Chip key={k} active={kind === k} onPress={() => K(k)}>
                    {k.replace("_", " ")}
                  </Chip>
                ),
              )}
            </Row>
            <Field label="Amount (₹)" value={amount} onChange={A} number />
            <Field label={t("reason")} value={reason} onChange={R} />
            <Button
              onPress={() =>
                void run(async () => {
                  await s.command({
                    type: "cash.move",
                    drawerId: active.id,
                    kind,
                    amountPaise: money(amount),
                    reason,
                  });
                  A("");
                  R("");
                })
              }
            >
              Record movement
            </Button>
          </Section>
          <Section title="Close and reconcile drawer">
            <Field
              label="Physically counted cash (₹)"
              value={count}
              onChange={C}
              number
            />
            <Txt size={12} muted>
              A difference belongs to the shared drawer, not automatically to a
              specific employee.
            </Txt>
            <Button
              secondary
              onPress={() =>
                void run(() =>
                  s.command({
                    type: "drawer.close",
                    drawerId: active.id,
                    countedPaise: money(count),
                  }),
                )
              }
            >
              Close drawer
            </Button>
          </Section>
        </>
      ) : (
        <Section title="Open today's drawer">
          <Field label="Opening cash (₹)" value={amount} onChange={A} number />
          <Button
            onPress={() =>
              void run(() =>
                s.command({
                  type: "drawer.open",
                  drawerId: uid(),
                  openingPaise: money(amount),
                }),
              )
            }
          >
            Open drawer
          </Button>
        </Section>
      )}
      <Section
        title="End-of-day reports"
        action={
          <Button
            small
            secondary
            onPress={() =>
              void run(() =>
                s.command({
                  type: "eod.close",
                  date: indiaDate(new Date().toISOString()),
                }),
              )
            }
          >
            Create report
          </Button>
        }
      >
        {Object.values(state.eods)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((e) => (
            <View key={e.id} style={styles.listRow}>
              <Row style={{ justifyContent: "space-between" }}>
                <Txt bold>
                  {e.date} · Revision {e.revision}
                </Txt>
                <Badge warning={e.provisional}>
                  {e.provisional ? "Provisional" : "Synced at close"}
                </Badge>
              </Row>
              <Txt muted size={12} style={{ marginTop: 8 }}>
                Sales {rupees(e.totals.netSalesPaise)} · Cash{" "}
                {rupees(e.totals.cashCollectedPaise)} · UPI{" "}
                {rupees(e.totals.upiCollectedPaise)}
              </Txt>
            </View>
          ))}
      </Section>
      <Section title="Drawer history">
        {Object.values(state.drawers)
          .filter((d) => d.closedAt)
          .map((d) => (
            <View key={d.id} style={styles.listRow}>
              <Txt bold>{indiaDate(d.openedAt)}</Txt>
              <Txt muted size={12} style={{ marginTop: 6 }}>
                Counted {rupees(d.countedPaise ?? 0)} · Expected at close{" "}
                {rupees(d.expectedAtClose ?? 0)} · Current ledger{" "}
                {rupees(expectedCash(state, d.id))}
              </Txt>
              <Txt style={{ marginTop: 6, color: colors.amber }}>
                Difference at close {rupees(d.discrepancyPaise ?? 0)}
              </Txt>
            </View>
          ))}
      </Section>
    </Page>
  );
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
          <Txt bold>{i.number}</Txt>
          {(p.lines as { index: number; quantity: string }[]).map((l, n) => {
            const item = i.lines[l.index];
            return (
              <Txt key={n}>
                {item?.name} {item?.strength} · {item?.batchCode} · {l.quantity}{" "}
                base units
              </Txt>
            );
          })}
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
          <Txt bold>
            {s.members[q.actorId]?.name} · {rupees(op.cashPaise)}
          </Txt>
          <Txt muted>
            {new Date(command.occurredAt).toLocaleString()} · {op.counterId}
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
    [reviewId, V] = useState(""),
    [refundCash, RC] = useState(""),
    [refundUpi, RU] = useState("0"),
    [refundRef, RF] = useState("");
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
                <Txt bold>
                  {a.kind[0].toUpperCase() + a.kind.slice(1)} request
                </Txt>
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
              {selected.kind.toUpperCase()}
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
              <>
                <Txt muted size={12} style={{ marginBottom: 12 }}>
                  Reduce unpaid invoice credit first. Enter only the money
                  actually returned to the customer.
                </Txt>
                <Field
                  label="Cash refunded (₹)"
                  value={refundCash}
                  onChange={RC}
                  number
                />
                <Field
                  label="UPI refunded (₹)"
                  value={refundUpi}
                  onChange={RU}
                  number
                />
                <Field
                  label="Refund UPI reference, if used"
                  value={refundRef}
                  onChange={RF}
                />
                <Button
                  onPress={() =>
                    void run(async () => {
                      await s.command({
                        type: "refund.execute",
                        approvalId: selected.id,
                        cashPaise: money(refundCash),
                        upiPaise: money(refundUpi),
                        upiReference: refundRef || undefined,
                      });
                      setSelected(null);
                    })
                  }
                >
                  Record executed refund
                </Button>
              </>
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
    [collect, C] = useState(true);
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
        <Field label="Unique username" value={username} onChange={U} />
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
          .filter((m) => m.role === "employee")
          .map((m) => (
            <Row
              key={m.id}
              style={[styles.listRow, { justifyContent: "space-between" }]}
            >
              <View>
                <Txt bold>{m.name}</Txt>
                <Txt muted size={11}>
                  {m.active ? "Active" : "Disabled"} ·{" "}
                  {m.canCollect ? "Can collect" : "Cannot collect"}
                </Txt>
              </View>
              <Button
                secondary
                small
                onPress={() =>
                  void run(async () => {
                    if (s.demo)
                      throw new Error("Manage real accounts after signing in");
                    await s.request(`/employees/${m.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        active: !m.active,
                        canCollect: m.canCollect,
                      }),
                    });
                    await s.refresh();
                  })
                }
              >
                {m.active ? "Disable" : "Enable"}
              </Button>
            </Row>
          ))}
      </Section>
      <Section title="Registered devices">
        {Object.values(state.devices).map((d) => (
          <View key={d.id} style={styles.listRow}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Txt bold>{d.name}</Txt>
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
    </Page>
  );
}
