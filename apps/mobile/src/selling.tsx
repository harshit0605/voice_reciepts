import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  ScrollView,
  Pressable,
  TextInput,
  useWindowDimensions,
  Platform,
  Alert,
  Linking,
} from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { useSession, uid } from "./session";
import { useSaleEntry } from "./sale-entry";
import { VoiceEntry } from "./voice-entry";
import { useBarcodeScanner, CAMERA_OFF } from "./scanner";
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
  colors,
  styles,
  useText,
  SHOWN_PRODUCTS,
  useWord,
} from "./ui";
import {
  D,
  consumeVoiceItem,
  spokenUnit,
  spokenQuantity,
  emptyVoice,
  recoverCheckout,
  billsLocally,
  orderMatches,
  commandOrderId,
  matchScan,
  type CheckoutAttempt,
  type SpokenItem,
  quote,
  rupees,
  receiptHtml,
  indiaDate,
  type OrderLine,
  type Invoice,
  type State,
  type Batch,
  type Order,
  groupBatches,
  matchesSearch,
  bySearch,
} from "@counterwell/core";
function exactPaise(input: string) {
  const amount = D(input || 0).mul(100);
  if (!amount.isFinite() || !amount.isInteger() || amount.lt(0))
    throw new Error("Enter an amount with at most two decimals");
  return amount.toNumber();
}
/** The bill total and the next round notes a customer is likely to hand over. */
function quickAmounts(totalPaise: number) {
  return [
    ...new Set(
      [1, 1000, 5000, 10000, 50000].map(
        (step) => Math.ceil(totalPaise / step) * step,
      ),
    ),
  ]
    .filter((v) => v > 0)
    .slice(0, 4);
}
export function SellScreen({ onInvoice }: { onInvoice: (i: Invoice) => void }) {
  const s = useSession(),
    state = s.state!,
    t = useText(),
    w = useWord(),
    wide = useWindowDimensions().width >= 1180;
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Batch | null>(null),
    [qty, setQty] = useState("1"),
    [unit, setUnit] = useState(""),
    [checkout, setCheckout] = useState(false),
    [basketOpen, setBasketOpen] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false);
  const [activeVoice, setActiveVoice] = useState<string | null>(null);
  const selling = useSaleEntry(
    `sale-entry:${s.demo ? "demo:" : ""}${state.businessId}:${s.identity!.actor.id}`,
  );
  const basket = selling.entry.basket;
  const setBasket = (lines: OrderLine[]) =>
    void selling.update((v) => ({ ...v, basket: lines }));
  const addLock = useRef(false);
  const busy = selling.saving || !selling.ready || !!selling.error;
  const voiceItem = selling.entry.voice.items.find((i) => i.id === activeVoice);
  async function finishEntry(invoice?: Invoice) {
    setCheckout(false);
    const saved = await selling.update((v) => ({
      ...v,
      basket: [],
      voice: { ...emptyVoice(uid()), appliedJobIds: v.voice.appliedJobIds },
      checkoutInterrupted: false,
      checkout: undefined,
    }));
    if (!saved)
      s.setError(
        "Sale was recorded, but the local entry draft could not be cleared. Check Orders before entering it again.",
      );
    selling.setReviewRecovery(false);
    if (invoice) onInvoice(invoice);
  }
  const recovery = recoverCheckout(
    selling.entry.checkout,
    state,
    s.identity!.actor.id,
    s.pending.map((p) => p.command.id),
    s.uncertain,
  );
  const settled = useRef("");
  // Finish a restored or late-confirmed attempt once, from recorded state, instead of relying on staff to check Orders.
  useEffect(() => {
    const attempt = selling.entry.checkout;
    if (!selling.ready || !attempt) return;
    const key = `${attempt.orderId}:${recovery.kind}`;
    if (settled.current === key) return;
    if (recovery.kind === "billed") {
      settled.current = key;
      void finishEntry(recovery.invoice);
    } else if (
      recovery.kind === "saved_locally" ||
      recovery.kind === "elsewhere"
    ) {
      settled.current = key;
      void finishEntry().then(() =>
        s.setError(
          recovery.kind === "saved_locally"
            ? "This cash sale is already saved on this phone and waiting to sync. Do not collect again."
            : "This sale was billed, handed over or cancelled elsewhere. Check Orders; do not collect it again here.",
        ),
      );
    }
  }, [selling.ready, selling.entry.checkout?.orderId, recovery.kind]);
  async function setAside() {
    await finishEntry();
    s.setError(
      "Sale set aside. It will be confirmed automatically when the connection returns. Do not bill these items again; check Orders later.",
    );
  }
  const today = indiaDate(new Date().toISOString());
  const [scanNotice, setScanNotice] = useState<{
    message: string;
    detail?: string;
    settings?: boolean;
  } | null>(null);
  const [scanWarning, setScanWarning] = useState("");
  const scanner = useBarcodeScanner((raw) => onScan(raw));
  async function openScanner() {
    setScanNotice(null);
    const r = await scanner.open();
    if (!r.opened) setScanNotice({ message: CAMERA_OFF, settings: r.settings });
  }
  function onScan(raw: string) {
    const m = matchScan(state, raw, today);
    if (!m.products.length) {
      setScanNotice({
        message:
          "No product has this barcode. Search by name, or ask the owner to add the barcode.",
        detail: m.key,
      });
      return;
    }
    if (m.products.length > 1) {
      setQuery(m.key);
      setScanNotice({
        message:
          "Several products share this barcode. Choose the one you are supplying.",
      });
      return;
    }
    const product = m.products[0];
    const stock = sellable.get(product.id) ?? [];
    if (!stock.length) {
      setScanNotice({
        message: "No sellable stock is recorded for this product.",
        detail: `${product.name} ${product.strength}`,
      });
      return;
    }
    setActiveVoice(null);
    const exact = m.batch && stock.find((b) => b.id === m.batch!.id);
    select(exact ?? stock[0], null);
    setScanWarning(
      m.batchIssue === "expired"
        ? "The scanned pack's batch is expired. Do not supply it."
        : m.batchIssue === "no_stock"
          ? "The scanned pack's batch has no recorded stock. Check the pack and choose the batch you are supplying."
          : m.batchIssue === "unrecorded"
            ? "The scanned pack's batch is not in stock records. Check the pack and choose the batch you are supplying."
            : "",
    );
  }
  // Sellable (in stock, unexpired) batches per product, earliest expiry first.
  const sellable = useMemo(() => {
    const out = groupBatches(state.batches);
    for (const [id, list] of out) {
      const ok = list.filter((b) => D(b.quantity).gt(0) && b.expiry >= today);
      if (ok.length) out.set(id, ok);
      else out.delete(id);
    }
    return out;
  }, [state.batches, today]);
  const stockOf = (id: string) =>
    (sellable.get(id) ?? []).reduce((n, b) => n + Number(b.quantity), 0);
  const products = useMemo(() => {
    const rank = bySearch(query);
    return Object.values(state.products)
      .filter(
        (p) =>
          p.active &&
          matchesSearch(p, query) &&
          (filter !== "low" || stockOf(p.id) <= Number(p.reorderAt)),
      )
      .sort(
        (a, b) =>
          Number(sellable.has(b.id)) - Number(sellable.has(a.id)) || rank(a, b),
      );
  }, [state.products, sellable, query, filter]);
  let total = 0,
    basketValid = true;
  try {
    total = quote(state, basket, new Date().toISOString()).reduce(
      (n, l) => n + l.netPaise,
      0,
    );
  } catch {
    basketValid = false;
  }
  const select = (
    batch: Batch,
    spoken: SpokenItem | null | undefined = voiceItem,
  ) => {
    setSelected(batch);
    setScanWarning("");
    const product = state.products[batch.productId];
    setQty(spoken ? spokenQuantity(spoken.quantity) : "1");
    setUnit(
      spoken ? (spokenUnit(spoken.unit, product) ?? "") : product.baseUnit,
    );
  };
  const add = async () => {
    if (!selected || addLock.current || busy) return;
    addLock.current = true;
    try {
      // Pressing the button that names the batch is the physical-batch confirmation.
      const line = {
        batchId: selected.id,
        quantity: qty,
        unit,
        confirmed: true,
      };
      quote(state, [line], new Date().toISOString());
      const saved = await selling.update((entry) =>
        activeVoice
          ? consumeVoiceItem(entry, activeVoice, line)
          : { ...entry, basket: [...entry.basket, line] },
      );
      if (!saved) return;
      setSelected(null);
      // Start the next item with an empty search.
      setQuery("");
      if (activeVoice) {
        setActiveVoice(null);
        setVoiceOpen(true);
      }
    } catch (e) {
      s.setError((e as Error).message);
    } finally {
      addLock.current = false;
    }
  };
  const basketContent = (
    <>
      <Row style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <Txt size={18} bold>
          {t("basket")}
        </Txt>
        <Badge>{basket.length} items</Badge>
      </Row>
      {basket.length === 0 ? (
        <Empty
          icon="basket-outline"
          title={t("emptyBasket")}
          detail={t("emptyHelp")}
        />
      ) : (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {basket.map((line, i) => {
            const b = state.batches[line.batchId],
              p = b ? state.products[b.productId] : undefined;
            let amount: number | null = null;
            try {
              amount = quote(state, [line], new Date().toISOString())[0]
                .netPaise;
            } catch {}
            return (
              <View key={i} style={styles.listRow}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt bold>
                      {p?.name ?? "Unavailable product"} {p?.strength}
                    </Txt>
                    <Txt size={12} muted style={{ marginTop: 5 }}>
                      {line.quantity} {line.unit} ·{" "}
                      {b?.code ?? "Unavailable batch"}
                    </Txt>
                  </View>
                  <Txt bold>
                    {amount === null
                      ? s.language === "hi"
                        ? "फिर जाँचें"
                        : "Recheck item"
                      : rupees(amount)}
                  </Txt>
                  <Pressable
                    onPress={() =>
                      setBasket(basket.filter((_, index) => index !== i))
                    }
                    accessibilityLabel="Remove item"
                  >
                    <Icon name="close-circle-outline" size={18} />
                  </Pressable>
                </Row>
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={{ marginTop: "auto", paddingTop: 24 }}>
        <Row style={{ justifyContent: "space-between", marginBottom: 18 }}>
          <Txt muted>{t("total")}</Txt>
          <Txt size={27} bold>
            {rupees(total)}
          </Txt>
        </Row>
        <Button
          disabled={
            !basket.length ||
            !basketValid ||
            busy ||
            selling.reviewRecovery ||
            recovery.kind === "uncertain" ||
            selling.entry.voice.items.length > 0 ||
            !!selling.entry.voice.jobId ||
            !!selling.entry.voice.input.trim()
          }
          onPress={() => {
            setCheckout(true);
            setBasketOpen(false);
          }}
          icon="arrow-forward"
        >
          {t("checkout")}
        </Button>
        <Txt size={10} muted style={{ textAlign: "center", marginTop: 12 }}>
          {selling.entry.voice.items.length > 0 ||
          selling.entry.voice.jobId ||
          selling.entry.voice.input.trim()
            ? s.language === "hi"
              ? "बचे बोले या लिखे सामान की जाँच करें या हटाएँ।"
              : "Review or clear remaining voice/text items before checkout."
            : "GST included · Confirm before collecting"}
        </Txt>
      </View>
    </>
  );
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1, minWidth: 0, padding: wide ? 30 : 20 }}>
        <Row style={{ justifyContent: "space-between", marginBottom: 23 }}>
          <View style={{ flex: 1 }}>
            <Txt size={28} bold style={{ letterSpacing: -0.8 }}>
              {t("newSale")}
            </Txt>
            <Txt muted size={12} style={{ marginTop: 5 }}>
              {s.language === "hi"
                ? "दवाएँ जोड़ें, जाँचें और बिल बनाएँ।"
                : "Add medicines, check the batch, and bill."}
            </Txt>
          </View>
          <Button
            secondary
            small
            disabled={!selling.ready}
            icon="mic-outline"
            onPress={() => setVoiceOpen(true)}
          >
            {s.language === "hi" ? "बोलें / लिखें" : "Voice / text"}
          </Button>
        </Row>
        <Row
          style={{
            backgroundColor: "white",
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 10,
            paddingHorizontal: 14,
            marginBottom: 18,
          }}
        >
          <Icon name="search-outline" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("search")}
            placeholderTextColor={colors.muted}
            style={{
              flex: 1,
              minWidth: 0,
              paddingVertical: 16,
              fontSize: 14,
              color: colors.ink,
            }}
          />
          <Pressable
            accessibilityLabel="Scan barcode"
            onPress={() => void openScanner()}
            style={{ padding: 6 }}
          >
            <Icon name="barcode-outline" color={colors.accent} />
          </Pressable>
        </Row>
        <Row style={{ marginBottom: 22 }}>
          <Chip active={filter === "all"} onPress={() => setFilter("all")}>
            {t("all")}
          </Chip>
          <Chip active={filter === "low"} onPress={() => setFilter("low")}>
            {t("lowStock")}
          </Chip>
          <View style={{ flex: 1 }} />
          <Txt size={11} muted>
            {products.length} results
          </Txt>
        </Row>
        {!!selling.error && (
          <View style={{ gap: 8 }}>
            <Txt style={{ color: colors.red }}>{selling.error}</Txt>
            <Button
              secondary
              small
              onPress={() => void selling.update((v) => v)}
            >
              Retry saving draft
            </Button>
          </View>
        )}
        {scanNotice && (
          <View
            style={{
              padding: 12,
              backgroundColor: colors.amberBg,
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Txt>{scanNotice.message}</Txt>
            {!!scanNotice.detail && (
              <Txt muted size={12}>
                {scanNotice.detail}
              </Txt>
            )}
            <Row style={{ flexWrap: "wrap" }}>
              {scanNotice.settings && (
                <Button
                  secondary
                  small
                  onPress={() => void Linking.openSettings()}
                >
                  Open Settings
                </Button>
              )}
              <Button secondary small onPress={() => setScanNotice(null)}>
                Dismiss
              </Button>
            </Row>
          </View>
        )}
        {selling.reviewRecovery && (
          <View
            style={{
              padding: 12,
              backgroundColor: colors.amberBg,
              gap: 10,
              marginBottom: 12,
            }}
          >
            <Txt>
              {s.language === "hi"
                ? "बिक्री का ड्राफ्ट वापस मिला। पहले ऑर्डर जाँचें कि भुगतान या बिल पहले ही दर्ज तो नहीं हुआ।"
                : "Recovered sale draft. Check Orders for a recorded bill or payment before using it again."}
            </Txt>
            <Button
              secondary
              small
              onPress={() => selling.setReviewRecovery(false)}
            >
              {s.language === "hi"
                ? "ऑर्डर जाँचे — यह बिक्री अधूरी है"
                : "I checked Orders — this sale is unfinished"}
            </Button>
          </View>
        )}
        {recovery.kind === "uncertain" && (
          <View
            style={{
              padding: 12,
              backgroundColor: colors.amberBg,
              gap: 10,
              marginBottom: 12,
            }}
          >
            <Txt>
              No server response yet for this sale's payment. It may already be
              recorded, so do not collect again.
            </Txt>
            <Row style={{ flexWrap: "wrap" }}>
              <Button secondary small onPress={() => void s.sync()}>
                Check now
              </Button>
              <Button secondary small onPress={() => void setAside()}>
                Set aside and start a new sale
              </Button>
            </Row>
          </View>
        )}
        {(selling.entry.voice.items.length > 0 ||
          !!selling.entry.voice.jobId) && (
          <Button secondary small onPress={() => setVoiceOpen(true)}>
            {selling.entry.voice.jobId
              ? s.language === "hi"
                ? "आवाज़ का ड्राफ्ट बन रहा है…"
                : "Voice draft processing…"
              : `${selling.entry.voice.items.length} ${s.language === "hi" ? "बोले सामान की जाँच बाकी" : "spoken items to review"}`}
          </Button>
        )}
        {activeVoice !== null && (
          <Button
            secondary
            small
            onPress={() => {
              setActiveVoice(null);
              setVoiceOpen(true);
            }}
          >
            {s.language === "hi"
              ? "आवाज़ समीक्षा पर वापस जाएँ"
              : "Return to voice review"}
          </Button>
        )}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
          // After a search, the first tap on Add must add, not just close the keyboard.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {products.length > SHOWN_PRODUCTS && (
            <Txt size={11} muted style={{ marginTop: 12 }}>
              {s.language === "hi"
                ? `${products.length.toLocaleString("en-IN")} में से ${SHOWN_PRODUCTS} दिख रहे हैं · नाम, साल्ट या बारकोड से खोजें`
                : `Showing ${SHOWN_PRODUCTS} of ${products.length.toLocaleString("en-IN")} · search by name, salt or barcode`}
            </Txt>
          )}
          {products.slice(0, SHOWN_PRODUCTS).map((p) => {
            const available = sellable.get(p.id) ?? [];
            const count = available.reduce((n, b) => n + Number(b.quantity), 0);
            return (
              <View
                key={p.id}
                style={{
                  paddingVertical: 17,
                  borderBottomWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <Row>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: colors.surface,
                      borderRadius: 11,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon
                      name={
                        p.baseUnit === "bottle"
                          ? "flask-outline"
                          : p.baseUnit === "tablet"
                            ? "medical-outline"
                            : "cube-outline"
                      }
                      color={colors.accent}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt bold size={15}>
                      {p.name}{" "}
                      <Txt muted size={12}>
                        {p.strength}
                      </Txt>
                    </Txt>
                    <Txt size={11} muted style={{ marginTop: 5 }}>
                      {p.generic} · {p.form}
                    </Txt>
                    <Row style={{ gap: 6, marginTop: 7 }}>
                      <View
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          backgroundColor:
                            count <= Number(p.reorderAt)
                              ? colors.amber
                              : colors.accent,
                        }}
                      />
                      <Txt size={10} muted>
                        {s.language === "hi"
                          ? `${count} ${w(p.baseUnit)} उपलब्ध`
                          : `${count} ${p.baseUnit}${count === 1 ? "" : "s"} available`}
                      </Txt>
                      {p.schedule !== "OTC" && (
                        <Txt size={10} muted>
                          · Rx
                        </Txt>
                      )}
                    </Row>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 9 }}>
                    <Txt bold size={14}>
                      {available[0] ? rupees(available[0].pricePaise) : "—"}
                      <Txt muted size={10}>
                        {" "}
                        / {p.baseUnit}
                      </Txt>
                    </Txt>
                    <Button
                      small
                      secondary
                      disabled={!available.length || busy}
                      onPress={() => {
                        setActiveVoice(null);
                        select(available[0], null);
                      }}
                      icon="add"
                    >
                      {t("add")}
                    </Button>
                  </View>
                </Row>
              </View>
            );
          })}
          {!products.length && (
            <Empty
              title={t("noResults")}
              detail="Try a brand name, salt or barcode."
            />
          )}
        </ScrollView>
        {!wide && (
          <Button
            disabled={!basket.length}
            onPress={() => setBasketOpen(true)}
            icon="basket-outline"
          >
            {t("basket")} · {basket.length} · {rupees(total)}
          </Button>
        )}
      </View>
      {wide && (
        <View
          style={{
            width: 340,
            borderLeftWidth: 1,
            borderColor: colors.line,
            backgroundColor: "white",
            padding: 25,
          }}
        >
          {basketContent}
        </View>
      )}
      <Sheet
        visible={basketOpen}
        title={t("basket")}
        onClose={() => setBasketOpen(false)}
      >
        {basketContent}
      </Sheet>
      <Sheet
        visible={!!selected}
        title={
          selected
            ? `${state.products[selected.productId].name} ${state.products[selected.productId].strength}`
            : ""
        }
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            {!!scanWarning && (
              <Txt style={{ color: colors.red, marginBottom: 12 }}>
                {scanWarning}
              </Txt>
            )}
            <Txt muted size={12} style={{ marginBottom: 14 }}>
              Select the batch printed on the medicine you are supplying.
            </Txt>
            <ScrollView horizontal style={{ marginBottom: 20 }}>
              {(sellable.get(selected.productId) ?? []).map((b) => (
                <Chip
                  key={b.id}
                  active={selected.id === b.id}
                  onPress={() => {
                    setSelected(b);
                  }}
                >
                  {b.code} · {b.expiry}
                </Chip>
              ))}
            </ScrollView>
            {voiceItem && (
              <View style={{ gap: 8, marginBottom: 14 }}>
                <Txt muted>
                  {s.language === "hi" ? "बोला गया: " : "Spoken: "}
                  {voiceItem.name} {voiceItem.strength} · {voiceItem.quantity}{" "}
                  {voiceItem.unit}
                </Txt>
                <Txt size={12} style={{ color: colors.amber }}>
                  {s.language === "hi"
                    ? "नाम, ताकत, रूप, मात्रा और इकाई जाँचें।"
                    : "Verify medicine, strength, form, quantity and unit."}
                </Txt>
              </View>
            )}
            {!unit && (
              <Txt style={{ color: colors.red, marginBottom: 12 }}>
                {s.language === "hi"
                  ? "बोली गई इकाई नहीं मिली। सही इकाई नीचे चुनें।"
                  : "Spoken unit was not recognised. Choose the actual unit below."}
              </Txt>
            )}
            <Field
              label={t("quantity")}
              value={qty}
              onChange={(v) => {
                setQty(v);
              }}
              number
            />
            <Row style={{ flexWrap: "wrap", marginBottom: 20 }}>
              {Object.keys(state.products[selected.productId].units).map(
                (u) => (
                  <Chip
                    key={u}
                    active={unit === u}
                    onPress={() => {
                      setUnit(u);
                    }}
                  >
                    {u}
                  </Chip>
                ),
              )}
            </Row>

            <Button
              disabled={!Number(qty) || !unit || busy}
              onPress={() => void add()}
              icon="checkmark"
            >
              {s.language === "hi"
                ? `बैच ${selected.code} जाँचा · जोड़ें`
                : `Batch ${selected.code} checked · Add`}
            </Button>
          </>
        )}
      </Sheet>
      <Sheet
        visible={checkout}
        title={t("checkout")}
        onClose={() => setCheckout(false)}
      >
        <Checkout
          lines={basket}
          attempt={selling.entry.checkout}
          pin={(attempt) =>
            selling.update((v) => ({ ...v, checkout: attempt }))
          }
          onComplete={(i) => void finishEntry(i)}
          onHeld={() => void finishEntry()}
        />
      </Sheet>
      {scanner.sheet}
      <VoiceEntry
        work={selling.entry.voice}
        change={(change) =>
          selling.update((v) => ({ ...v, voice: change(v.voice) }))
        }
        visible={voiceOpen}
        close={() => setVoiceOpen(false)}
        onPick={(id, productId) => {
          const batch = sellable.get(productId)?.[0],
            spoken = selling.entry.voice.items.find((i) => i.id === id);
          if (!batch) {
            s.setError("No eligible stock is available for this product");
            return;
          }
          setActiveVoice(id);
          select(batch, spoken);
          setVoiceOpen(false);
        }}
      />
    </View>
  );
}
export function Checkout({
  lines,
  onComplete,
  onHeld,
  existingOrderId,
  attempt,
  pin,
}: {
  lines: OrderLine[];
  onComplete: (i: Invoice) => void;
  onHeld: () => void;
  /** Collect an order already in Orders. Otherwise `attempt` and `pin` are required. */
  existingOrderId?: string;
  attempt?: CheckoutAttempt;
  pin?: (attempt: CheckoutAttempt) => Promise<boolean>;
}) {
  const s = useSession(),
    t = useText(),
    state = s.state!;
  const [method, setMethod] = useState("cash"),
    [customerId, setCustomer] = useState(
      state.orders[existingOrderId ?? ""]?.customerId ?? "",
    ),
    [cash, setCash] = useState("0"),
    [received, setReceived] = useState(""),
    [credit, setCredit] = useState("0"),
    [ref, setRef] = useState(""),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [patient, setPatient] = useState(""),
    [address, setAddress] = useState(""),
    [doctor, setDoctor] = useState(""),
    [doctorAddress, setDoctorAddress] = useState(""),
    [prescriptionRef, setPrescriptionRef] = useState("");
  const approvedDiscount = Object.values(state.approvals).find(
    (a) =>
      a.kind === "discount" &&
      a.status === "approved" &&
      a.payload.orderId === existingOrderId &&
      a.payload.orderVersion === state.orders[existingOrderId ?? ""]?.version,
  );
  const discountPaise = Number(approvedDiscount?.payload.amountPaise ?? 0);
  const total = quote(
    state,
    lines,
    new Date().toISOString(),
    discountPaise,
  ).reduce((n, l) => n + l.netPaise, 0);
  let change: number | null = null;
  try {
    if (received.trim()) change = exactPaise(received) - total;
  } catch {}
  const rx = lines.some(
    (l) =>
      state.products[state.batches[l.batchId].productId].schedule !== "OTC",
  );
  const prescription =
    state.orders[existingOrderId ?? ""]?.prescription ??
    (rx
      ? {
          patient,
          address,
          prescriber: doctor,
          prescriberAddress: doctorAddress,
          reference: prescriptionRef,
        }
      : undefined);
  const orderId = existingOrderId ?? attempt?.orderId;
  const awaitingServer =
    !!s.uncertain && !!orderId && commandOrderId(s.uncertain) === orderId;
  const submitting = useRef(false);
  // Save the identity in the draft before anything is sent, so a retry, restart or method change reuses it.
  async function pinAttempt(online: boolean): Promise<CheckoutAttempt> {
    const next = {
      orderId: attempt?.orderId ?? uid(),
      cashCommandId: attempt?.cashCommandId ?? uid(),
      online: !!attempt?.online || online,
    };
    if ((!attempt || attempt.online !== next.online) && !(await pin!(next)))
      throw new Error(
        "Draft could not be saved. Retry before collecting payment.",
      );
    return next;
  }
  async function hold(): Promise<Order> {
    if (existingOrderId) return state.orders[existingOrderId];
    const { orderId } = await pinAttempt(true);
    const current = state.orders[orderId];
    const content = {
      lines,
      customerId: customerId || undefined,
      prescription,
    };
    if (current) {
      if (current.status !== "held")
        throw new Error(
          "This sale is no longer open here. Check Orders before collecting.",
        );
      if (orderMatches(current, content)) return current;
    }
    return s.command({
      type: "order.save",
      orderId,
      version: current?.version ?? 0,
      ...content,
      counterId: state.devices[s.identity!.deviceId]?.counterId ?? "counter-1",
    });
  }
  async function guarded(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const finish = () =>
    guarded(async () => {
      if (
        rx &&
        (!prescription?.patient ||
          !prescription.prescriber ||
          !prescription.reference ||
          !prescription.address ||
          !prescription.prescriberAddress)
      )
        throw new Error("Complete the prescription register details");
      if (method === "cash" && change !== null && change < 0)
        throw new Error("Cash received is less than the bill total");
      if (billsLocally(method, attempt, existingOrderId)) {
        const i = await s.cashSale(
          lines,
          customerId || undefined,
          prescription,
          await pinAttempt(false),
        );
        onComplete(i);
        return;
      }
      if (
        (method === "upi" || method === "split") &&
        (!verified || !ref.trim())
      )
        throw new Error(
          "Verify UPI in the merchant app and enter its reference",
        );
      if (method === "credit" && !customerId)
        throw new Error("Select a customer for credit");
      const order = await hold();
      const creditPaise = method === "credit" ? exactPaise(credit) : 0;
      const cashPaise =
        method === "cash"
          ? total
          : method === "split" || method === "credit"
            ? exactPaise(cash)
            : 0;
      const upiPaise =
        method === "upi" || method === "split" ? total - cashPaise : 0;
      if (method === "credit") {
        if (!customerId) throw new Error("Select a customer for credit");
        const approval = Object.values(s.state!.approvals).find(
          (a) =>
            a.kind === "credit" &&
            a.status === "approved" &&
            a.payload.orderId === order.id &&
            a.payload.orderVersion === order.version &&
            a.payload.amountPaise === creditPaise,
        );
        if (!approval) {
          await s.command({
            type: "approval.request",
            approvalId: uid(),
            kind: "credit",
            payload: {
              orderId: order.id,
              orderVersion: order.version,
              customerId,
              amountPaise: creditPaise,
            },
            reason: "Customer requested credit",
          });
          onHeld();
          return;
        }
      }
      const approval = Object.values(s.state!.approvals).find(
        (a) =>
          a.kind === "credit" &&
          a.status === "approved" &&
          a.payload.orderId === order.id,
      );
      const invoice = await s.command({
        type: "checkout",
        orderId: order.id,
        version: order.version,
        deviceId: s.identity!.deviceId,
        sequence: await s.reserveSequence(),
        cashPaise,
        upiPaise,
        upiReference: ref || undefined,
        upiVerified: verified,
        creditPaise,
        creditApprovalId: approval?.id,
        discountPaise,
        discountApprovalId: approvedDiscount?.id,
      });
      onComplete(invoice);
    });
  return (
    <View style={{ gap: 16 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt size={18}>{t("total")}</Txt>
        <Txt size={30} bold>
          {rupees(total)}
        </Txt>
      </Row>
      <Txt size={12} muted>
        Customer
      </Txt>
      <ScrollView horizontal>
        <Row>
          <Chip active={!customerId} onPress={() => setCustomer("")}>
            {t("walkin")}
          </Chip>
          {Object.values(state.customers).map((c) => (
            <Chip
              key={c.id}
              active={customerId === c.id}
              onPress={() => setCustomer(c.id)}
            >
              {c.name}
            </Chip>
          ))}
        </Row>
      </ScrollView>
      <Row style={{ flexWrap: "wrap" }}>
        {["cash", "upi", "split", "credit"].map((m) => (
          <Chip
            key={m}
            active={method === m}
            onPress={() => {
              setMethod(m);
              if (m === "credit") setCredit((total / 100).toFixed(2));
            }}
          >
            {m === "split" ? "Cash + UPI" : t(m as "cash")}
          </Chip>
        ))}
      </Row>
      {method === "cash" && (
        <View style={{ gap: 10 }}>
          <Field
            label="Cash received (₹) · optional"
            value={received}
            onChange={setReceived}
            number
          />
          <Row style={{ flexWrap: "wrap" }}>
            {quickAmounts(total).map((v) => (
              <Chip
                key={v}
                active={received === (v / 100).toString()}
                onPress={() => setReceived((v / 100).toString())}
              >
                {rupees(v)}
              </Chip>
            ))}
          </Row>
          {change !== null && (
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={{ color: change < 0 ? colors.red : colors.ink }}>
                {change < 0 ? "Short by" : "Return to customer"}
              </Txt>
              <Txt
                size={22}
                bold
                style={{ color: change < 0 ? colors.red : colors.ink }}
              >
                {rupees(Math.abs(change))}
              </Txt>
            </Row>
          )}
        </View>
      )}
      {(method === "split" || method === "credit") && (
        <Field
          label="Cash collected (₹)"
          value={cash}
          onChange={setCash}
          number
        />
      )}
      {method === "credit" && (
        <Field
          label="New customer credit (₹)"
          value={credit}
          onChange={setCredit}
          number
        />
      )}
      {(method === "upi" || method === "split") && (
        <>
          <Field
            label="UPI transaction reference"
            value={ref}
            onChange={setRef}
          />
          <Pressable onPress={() => setVerified(!verified)}>
            <Row>
              <Icon
                name={verified ? "checkbox" : "square-outline"}
                color={colors.accent}
              />
              <Txt size={12}>I checked receipt in the merchant payment app</Txt>
            </Row>
          </Pressable>
          <Txt muted size={11}>
            Recorded as manually verified, not bank-confirmed.
          </Txt>
        </>
      )}
      {rx && !state.orders[existingOrderId ?? ""]?.prescription && (
        <View>
          <Txt bold style={{ marginBottom: 12 }}>
            Prescription register
          </Txt>
          <Field label="Patient name" value={patient} onChange={setPatient} />
          <Field
            label="Patient address"
            value={address}
            onChange={setAddress}
          />
          <Field label="Prescriber name" value={doctor} onChange={setDoctor} />
          <Field
            label="Prescriber address"
            value={doctorAddress}
            onChange={setDoctorAddress}
          />
          <Field
            label="Prescription reference"
            value={prescriptionRef}
            onChange={setPrescriptionRef}
          />
        </View>
      )}
      {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
      {awaitingServer && (
        <Txt style={{ color: colors.amber }}>
          Waiting for the server to confirm this sale. Do not collect payment
          again.
        </Txt>
      )}
      <Button
        disabled={busy || awaitingServer}
        onPress={() => void finish()}
        icon="checkmark"
      >
        {busy
          ? "Saving…"
          : method === "credit"
            ? "Collect with credit approval"
            : "Confirm payment & create bill"}
      </Button>
      {!existingOrderId && (
        <Button
          secondary
          disabled={busy || awaitingServer}
          onPress={() =>
            void guarded(async () => {
              await hold();
              onHeld();
            })
          }
        >
          {t("hold")}
        </Button>
      )}
      <Txt size={11} muted>
        Check the medicines and payment before confirming. Finalised bills are
        corrected through a recorded return.
      </Txt>
    </View>
  );
}
export function ReceiptSheet({
  invoice,
  onClose,
}: {
  invoice: Invoice | null;
  onClose: () => void;
}) {
  const s = useSession(),
    t = useText();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [printId, setPrintId] = useState(""),
    [printStatus, setPrintStatus] = useState(""),
    [paperChecked, setPaperChecked] = useState(false),
    [reprintReason, setReprintReason] = useState("");
  // The sheet stays mounted; print state belongs to one bill and must not carry over to the next.
  const shown = useRef(invoice?.id);
  shown.current = invoice?.id;
  useEffect(() => {
    setError("");
    setBusy(false);
    setPrintId("");
    setPrintStatus("");
    setPaperChecked(false);
    setReprintReason("");
  }, [invoice?.id]);
  async function share() {
    if (!invoice) return;
    try {
      if (Platform.OS === "web") {
        await Print.printAsync({ html: receiptHtml(invoice) });
      } else {
        const file = await Print.printToFileAsync({
          html: receiptHtml(invoice),
        });
        // Name the PDF after the bill so WhatsApp and Files show "Bill 2627-002-000003.pdf".
        const named = new FileSystem.File(
          FileSystem.Paths.cache,
          `Bill ${invoice.number}.pdf`,
        );
        if (named.exists) named.delete();
        new FileSystem.File(file.uri).move(named);
        await Sharing.shareAsync(named.uri, {
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
          dialogTitle: `Bill ${invoice.number}`,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function print() {
    if (!invoice) return;
    setBusy(true);
    try {
      if (s.demo)
        throw new Error(
          "Connect a real shop gateway to print. PDF preview is available.",
        );
      const url = s.state!.settings.gatewayUrl;
      if (!url) throw new Error("Configure the shop gateway in Administration");
      const r = await fetch(`${url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lease: s.identity!.lease, invoice }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await r.json();
      if (shown.current !== invoice.id) return;
      if (!r.ok) throw new Error(result.error);
      setPrintId(result.id);
      setPrintStatus(result.status);
      setError(
        `Print job ${result.status}. Check the printer before requesting a reprint.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function checkPrint(reprint = false) {
    try {
      if (!invoice) return;
      const r = await fetch(
        `${s.state!.settings.gatewayUrl}/prints/${reprint ? "reprint" : "status"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lease: s.identity!.lease,
            id: printId,
            reason: reprintReason,
            paperChecked,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const result = await r.json();
      if (shown.current !== invoice.id) return;
      if (!r.ok) throw new Error(result.error);
      setPrintId(result.id);
      setPrintStatus(result.status);
      setError(result.error ?? "");
      setPaperChecked(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Sheet visible={!!invoice} title={t("receipt")} onClose={onClose}>
      {invoice && (
        <>
          <View style={{ alignItems: "center", gap: 9, marginBottom: 25 }}>
            <View
              style={{
                backgroundColor: colors.tint,
                padding: 16,
                borderRadius: 30,
              }}
            >
              <Icon name="checkmark" size={26} color={colors.accent} />
            </View>
            <Txt size={22} bold>
              Bill saved
            </Txt>
            <Txt muted>{invoice.number}</Txt>
            <Txt size={32} bold>
              {rupees(invoice.totalPaise)}
            </Txt>
          </View>
          {invoice.lines.map((l, i) => (
            <Row
              key={i}
              style={{
                justifyContent: "space-between",
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderColor: colors.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Txt bold>
                  {l.name} {l.strength}
                </Txt>
                <Txt muted size={11}>
                  {l.quantity} {l.unit} · {l.batchCode}
                </Txt>
              </View>
              <Txt>{rupees(l.netPaise)}</Txt>
            </Row>
          ))}
          <View style={{ gap: 10, marginTop: 24 }}>
            <Button onPress={() => void share()} icon="share-outline">
              {Platform.OS === "web" ? "Open printable receipt" : t("share")}
            </Button>
            <Button
              secondary
              onPress={() => void print()}
              disabled={busy}
              icon="print-outline"
            >
              {t("print")}
            </Button>
            {!!printId && (
              <>
                <Txt>Print status: {printStatus}</Txt>
                <Button secondary onPress={() => void checkPrint()}>
                  Check print status
                </Button>
                {["uncertain", "printed", "failed"].includes(printStatus) && (
                  <>
                    <Field
                      label="Reprint reason"
                      value={reprintReason}
                      onChange={setReprintReason}
                    />
                    <Pressable onPress={() => setPaperChecked(!paperChecked)}>
                      <Row>
                        <Icon
                          name={paperChecked ? "checkbox" : "square-outline"}
                        />
                        <Txt>I checked the printer and paper</Txt>
                      </Row>
                    </Pressable>
                    <Button
                      secondary
                      disabled={!paperChecked || reprintReason.length < 3}
                      onPress={() => void checkPrint(true)}
                    >
                      Request audited reprint
                    </Button>
                  </>
                )}
              </>
            )}
            {!!error && (
              <Txt size={12} muted>
                {error}
              </Txt>
            )}
          </View>
        </>
      )}
    </Sheet>
  );
}
