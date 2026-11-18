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
import { VoiceEntry, Strip } from "./voice-entry";
import { fonts } from "./theme";
import { useBarcodeScanner, CAMERA_OFF } from "./scanner";
import { CustomerPicker } from "./payments";
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
  Amount,
  TotalRule,
  Section,
  Stamp,
  stampDate,
  palette,
  radius,
  space,
  useText,
  SHOWN_PRODUCTS,
  useWord,
  itemCount,
} from "./ui";
import {
  D,
  consumeVoiceItem,
  spokenUnit,
  spokenItemTitle,
  spokenQuantity,
  readableQuantity,
  readableUnit,
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
  receiptPage,
  paymentLine,
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
/** A 48px round-cornered stepper button for quantities. */
function StepButton({
  icon,
  label,
  onPress,
}: {
  icon: "add" | "remove";
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? palette.rule : palette.blueTint,
      })}
    >
      <Icon name={icon} size={26} color={palette.blue} />
    </Pressable>
  );
}
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
    [heldNotice, setHeldNotice] = useState<{
      tone: "paid" | "waiting";
      text: string;
    } | null>(null),
    [unit, setUnit] = useState(""),
    [checkout, setCheckout] = useState(false),
    [basketOpen, setBasketOpen] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false);
  const [activeVoice, setActiveVoice] = useState<string | null>(null);
  useEffect(() => {
    if (!heldNotice) return;
    const id = setTimeout(() => setHeldNotice(null), 10000);
    return () => clearTimeout(id);
  }, [heldNotice]);
  const selling = useSaleEntry(
    `sale-entry:${s.demo ? "demo:" : ""}${state.businessId}:${s.identity!.actor.id}`,
  );
  const basket = selling.entry.basket;
  const setBasket = (lines: OrderLine[]) =>
    void selling.update((v) => ({
      ...v,
      basket: lines,
      customerId: lines.length ? v.customerId : undefined,
    }));
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
      customerId: undefined,
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
        setHeldNotice({
          tone: "waiting",
          text:
            recovery.kind === "saved_locally"
              ? "This cash sale is already saved on this phone and waiting to sync. Do not collect again."
              : "This sale was billed, handed over or cancelled elsewhere. Check Orders; do not collect it again here.",
        }),
      );
    }
  }, [selling.ready, selling.entry.checkout?.orderId, recovery.kind]);
  async function setAside() {
    await finishEntry();
    setHeldNotice({
      tone: "waiting",
      text: "Sale set aside. It will be confirmed automatically when the connection returns. Do not bill these items again; check Orders later.",
    });
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
  // Medicines whose only stock has expired: shown with a label, never offered for sale.
  const expiredOnly = useMemo(() => {
    const ids = new Set<string>();
    for (const b of Object.values(state.batches))
      if (D(b.quantity).gt(0) && b.expiry < today && !sellable.has(b.productId))
        ids.add(b.productId);
    return ids;
  }, [state.batches, sellable, today]);
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
  /** Base units of a batch already in the basket (all lines), and what a new line would add. */
  const baseUnits = (l: {
    batchId: string;
    quantity: string;
    unit: string;
  }) => {
    const b = state.batches[l.batchId];
    const factor = b && state.products[b.productId]?.units[l.unit];
    try {
      return factor ? D(l.quantity || 0).mul(factor) : D(0);
    } catch {
      return D(0);
    }
  };
  const inBasket = (batchId: string) =>
    basket
      .filter((l) => l.batchId === batchId)
      .reduce((n, l) => n.plus(baseUnits(l)), D(0));
  /** A basket may never hold more of a batch (summed over its lines) than the batch has. */
  const basketOversold = basket.some((l) =>
    inBasket(l.batchId).gt(state.batches[l.batchId]?.quantity ?? 0),
  );
  /** Stock left on the batch for a new line; null when the batch is not being added. */
  const stockLeft = selected
    ? D(state.batches[selected.id]?.quantity ?? 0).minus(inBasket(selected.id))
    : null;
  const overStock =
    !!selected &&
    !!stockLeft &&
    baseUnits({ batchId: selected.id, quantity: qty, unit }).gt(stockLeft);
  const onlyInStock = (n: { toFixed(): string }) =>
    s.language === "hi"
      ? `स्टॉक में सिर्फ़ ${n.toFixed()} हैं`
      : `Only ${n.toFixed()} in stock`;
  const select = (
    batch: Batch,
    spoken: SpokenItem | null | undefined = voiceItem,
  ) => {
    setSelected(batch);
    setScanWarning("");
    s.setError("");
    const product = state.products[batch.productId];
    setQty(spoken ? spokenQuantity(spoken.quantity) : "1");
    setUnit(
      spoken ? (spokenUnit(spoken.unit, product) ?? "") : product.baseUnit,
    );
  };
  const stepQty = (dir: 1 | -1) => {
    const n = Number(qty) || 0;
    const next = dir > 0 ? n + 1 : n - 1 > 0 ? n - 1 : n;
    setQty(String(Math.round(next * 100) / 100));
    s.setError("");
  };
  /** The line total for what the add sheet currently shows, when it can be priced. */
  let lineAmount: number | null = null;
  /** Why the sheet's line cannot be added (e.g. 2.5 tablets); shown inside the sheet. */
  let lineError = "";
  if (selected && unit && Number(qty) > 0) {
    try {
      lineAmount = quote(
        state,
        [{ batchId: selected.id, quantity: qty, unit, confirmed: true }],
        new Date().toISOString(),
      )[0].netPaise;
    } catch (e) {
      lineError = (e as Error).message;
    }
  }
  const add = async () => {
    if (!selected || addLock.current || busy) return;
    if (overStock || lineError) return;
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
      s.setError("");
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
      <Row style={{ justifyContent: "space-between", marginBottom: 8 }}>
        {wide ? (
          <Txt size={19} weight={600}>
            {t("basket")}
          </Txt>
        ) : (
          <View />
        )}
        <Badge>{itemCount(basket.length, s.language)}</Badge>
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
              <View
                key={i}
                style={{
                  borderBottomWidth: 1,
                  borderColor: palette.rule,
                  minHeight: 60,
                  paddingVertical: 8,
                }}
              >
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size={16} weight={600}>
                      {p?.name ?? "Unavailable product"}{" "}
                      <Txt size={14} color={palette.ink2}>
                        {p?.strength}
                      </Txt>
                    </Txt>
                    <Txt size={14} color={palette.ink2} num>
                      {line.quantity} × {line.unit} ·{" "}
                      <Txt size={14} weight={600} num color={palette.ink2}>
                        {b?.code ?? "Unavailable batch"}
                      </Txt>
                    </Txt>
                  </View>
                  {amount === null ? (
                    <Txt size={14} weight={600} color={palette.declined}>
                      {s.language === "hi" ? "फिर जाँचें" : "Recheck item"}
                    </Txt>
                  ) : (
                    <Amount value={rupees(amount)} size={16} />
                  )}
                  <Pressable
                    onPress={() =>
                      setBasket(basket.filter((_, index) => index !== i))
                    }
                    accessibilityLabel={
                      s.language === "hi" ? "सामान हटाएँ" : "Remove item"
                    }
                    accessibilityRole="button"
                    hitSlop={4}
                    style={{
                      width: 48,
                      height: 48,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: -8,
                    }}
                  >
                    <Icon name="close" size={22} color={palette.ink3} />
                  </Pressable>
                </Row>
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={{ marginTop: "auto", paddingTop: 20 }}>
        <TotalRule />
        <Row
          style={{
            justifyContent: "space-between",
            paddingVertical: 8,
            marginBottom: 12,
          }}
        >
          <Txt size={16} weight={600}>
            {t("total")}
          </Txt>
          <Amount value={rupees(total)} size={32} weight={700} />
        </Row>
        <Button
          disabled={
            !basket.length ||
            !basketValid ||
            basketOversold ||
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
        {basketOversold && (
          <Txt size={13} color={palette.declined} style={{ marginTop: 8 }}>
            {s.language === "hi"
              ? "किसी बैच का स्टॉक कम है। मात्रा घटाएँ।"
              : "Not enough stock in a batch. Reduce the quantity."}
          </Txt>
        )}
        <Txt size={13} muted center style={{ marginTop: 12 }}>
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
  const basketEmpty = basket.length === 0;
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flex: 1,
            minWidth: 0,
            paddingHorizontal: wide ? 30 : space.gutter,
            paddingTop: 12,
          }}
        >
          <Row style={{ gap: 8, marginBottom: 12 }}>
            <Row
              style={{
                flex: 1,
                minWidth: 0,
                gap: 6,
                backgroundColor: palette.paper,
                borderWidth: 1.5,
                borderColor: palette.ruleStrong,
                borderRadius: radius.md,
                paddingLeft: 12,
                minHeight: 56,
              }}
            >
              <Icon name="search-outline" size={20} color={palette.ink2} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("search")}
                placeholderTextColor={palette.ink3}
                accessibilityLabel={t("search")}
                selectionColor={palette.blue}
                cursorColor={palette.blue}
                autoCorrect={false}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 54,
                  fontSize: 16,
                  fontFamily: fonts.regular,
                  color: palette.ink,
                }}
              />
              <Pressable
                accessibilityLabel={
                  s.language === "hi" ? "बारकोड स्कैन करें" : "Scan barcode"
                }
                accessibilityRole="button"
                onPress={() => void openScanner()}
                style={{
                  width: 48,
                  height: 48,
                  marginRight: 3,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="barcode-outline" size={26} color={palette.blue} />
              </Pressable>
            </Row>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                s.language === "hi" ? "बोलें / लिखें" : "Voice / text"
              }
              disabled={!selling.ready}
              onPress={() => setVoiceOpen(true)}
              style={({ pressed }) => ({
                width: 56,
                height: 56,
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? palette.bluePressed : palette.blue,
                opacity: selling.ready ? 1 : 0.4,
              })}
            >
              <Icon name="mic" size={26} color="#FFFFFF" />
            </Pressable>
          </Row>
          <Row style={{ marginBottom: 8, gap: 8 }}>
            <Chip active={filter === "all"} onPress={() => setFilter("all")}>
              {t("all")}
            </Chip>
            <Chip active={filter === "low"} onPress={() => setFilter("low")}>
              {t("lowStock")}
            </Chip>
            <View style={{ flex: 1 }} />
            <Txt size={13} muted num>
              {s.language === "hi"
                ? `${products.length} परिणाम`
                : `${products.length} ${products.length === 1 ? "result" : "results"}`}
            </Txt>
          </Row>
          {!!heldNotice && (
            <Strip tone={heldNotice.tone}>{heldNotice.text}</Strip>
          )}
          {!!selling.error && (
            <View style={{ gap: 8, marginBottom: 8 }}>
              <Strip tone="declined">{selling.error}</Strip>
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
            <Strip
              tone="waiting"
              icon="barcode-outline"
              actions={
                <Row style={{ flexWrap: "wrap", marginTop: 8 }}>
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
              }
            >
              {scanNotice.message}
              {!!scanNotice.detail && (
                <Txt size={13} weight={400} color={palette.ink2}>
                  {"\n"}
                  {scanNotice.detail}
                </Txt>
              )}
            </Strip>
          )}
          {selling.reviewRecovery && (
            <Strip
              tone="waiting"
              actions={
                <Row style={{ marginTop: 8 }}>
                  <Button
                    secondary
                    small
                    onPress={() => selling.setReviewRecovery(false)}
                  >
                    {s.language === "hi"
                      ? "ऑर्डर जाँचे — यह बिक्री अधूरी है"
                      : "I checked Orders — this sale is unfinished"}
                  </Button>
                </Row>
              }
            >
              {s.language === "hi"
                ? "बिक्री का ड्राफ्ट वापस मिला। पहले ऑर्डर जाँचें कि भुगतान या बिल पहले ही दर्ज तो नहीं हुआ।"
                : "Recovered sale draft. Check Orders for a recorded bill or payment before using it again."}
            </Strip>
          )}
          {recovery.kind === "uncertain" && (
            <Strip
              tone="waiting"
              actions={
                <Row style={{ flexWrap: "wrap", marginTop: 8 }}>
                  <Button secondary small onPress={() => void s.sync()}>
                    Check now
                  </Button>
                  <Button secondary small onPress={() => void setAside()}>
                    Set aside and start a new sale
                  </Button>
                </Row>
              }
            >
              No server response yet for this sale's payment. It may already be
              recorded, so do not collect again.
            </Strip>
          )}
          {(selling.entry.voice.items.length > 0 ||
            !!selling.entry.voice.jobId) && (
            <View style={{ marginBottom: 8 }}>
              <Button secondary small onPress={() => setVoiceOpen(true)}>
                {selling.entry.voice.jobId
                  ? s.language === "hi"
                    ? "आवाज़ का ड्राफ्ट बन रहा है…"
                    : "Voice draft processing…"
                  : s.language === "hi"
                    ? `${selling.entry.voice.items.length} बोले सामान की जाँच बाकी`
                    : `${selling.entry.voice.items.length} spoken ${selling.entry.voice.items.length === 1 ? "item" : "items"} to review`}
              </Button>
            </View>
          )}
          {activeVoice !== null && (
            <View style={{ marginBottom: 8 }}>
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
            </View>
          )}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
            // After a search, the first tap on Add must add, not just close the keyboard.
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {products.length > SHOWN_PRODUCTS && (
              <Txt size={13} muted style={{ marginVertical: 8 }}>
                {s.language === "hi"
                  ? `${products.length.toLocaleString("en-IN")} में से ${SHOWN_PRODUCTS} दिख रहे हैं · नाम, साल्ट या बारकोड से खोजें`
                  : `Showing ${SHOWN_PRODUCTS} of ${products.length.toLocaleString("en-IN")} · search by name, salt or barcode`}
              </Txt>
            )}
            {products.slice(0, SHOWN_PRODUCTS).map((p) => {
              const available = sellable.get(p.id) ?? [];
              const count = available.reduce(
                (n, b) => n + Number(b.quantity),
                0,
              );
              const low = count <= Number(p.reorderAt);
              return (
                <View
                  key={p.id}
                  style={{
                    paddingVertical: 12,
                    minHeight: 76,
                    borderBottomWidth: 1,
                    borderColor: palette.rule,
                  }}
                >
                  <Row style={{ alignItems: "flex-start", gap: 12 }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Txt size={17} weight={600}>
                        {p.name}{" "}
                        <Txt size={16} weight={400} color={palette.ink2}>
                          {p.strength}
                        </Txt>
                      </Txt>
                      <Txt size={14} color={palette.ink2}>
                        {/* Separate children so the form word is translated on its own. */}
                        {p.generic}
                        {p.generic && p.form ? " · " : ""}
                        {p.form}
                      </Txt>
                      <Row style={{ gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                        {expiredOnly.has(p.id) ? (
                          <Txt size={13} weight={600} color={palette.declined}>
                            {s.language === "hi"
                              ? "सारा माल एक्सपायर है, न बेचें"
                              : "All stock expired · do not sell"}
                          </Txt>
                        ) : (
                          <Txt
                            size={13}
                            num
                            weight={low ? 600 : 500}
                            color={low ? palette.waiting : palette.ink2}
                          >
                            {s.language === "hi"
                              ? `${count} ${w(p.baseUnit)} उपलब्ध`
                              : `${count} ${p.baseUnit}${count === 1 ? "" : "s"} available`}
                            {low ? ` · ${t("lowStock")}` : ""}
                          </Txt>
                        )}
                        {p.schedule !== "OTC" && <Badge tone="info">Rx</Badge>}
                      </Row>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 8 }}>
                      <Txt size={13} muted>
                        <Amount
                          value={
                            available[0] ? rupees(available[0].pricePaise) : "—"
                          }
                          size={16}
                        />
                        {" "}/ {s.language === "hi" ? w(p.baseUnit) : p.baseUnit}
                      </Txt>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !available.length || busy }}
                        disabled={!available.length || busy}
                        onPress={() => {
                          setActiveVoice(null);
                          select(available[0], null);
                        }}
                        style={({ pressed }) => ({
                          minHeight: 48,
                          minWidth: 88,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          paddingHorizontal: 14,
                          borderRadius: radius.md,
                          backgroundColor: palette.blueTint,
                          opacity:
                            !available.length || busy ? 0.4 : pressed ? 0.65 : 1,
                        })}
                      >
                        <Icon name="add" size={20} color={palette.blue} />
                        <Txt size={15} weight={600} color={palette.blue}>
                          {t("add")}
                        </Txt>
                      </Pressable>
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
        </View>
        {!wide && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("basket")}
            accessibilityState={{ disabled: basketEmpty }}
            disabled={basketEmpty}
            onPress={() => setBasketOpen(true)}
            style={({ pressed }) => ({
              minHeight: 64,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: space.gutter,
              backgroundColor: basketEmpty
                ? palette.desk
                : pressed
                  ? "#242932"
                  : palette.ink,
              borderTopWidth: 1,
              borderColor: basketEmpty ? palette.rule : palette.ink,
            })}
          >
            {basketEmpty ? (
              <>
                <Txt size={16} weight={600} color={palette.ink2}>
                  {t("basket")}
                </Txt>
                <Txt size={14} color={palette.ink2}>
                  No items yet
                </Txt>
              </>
            ) : (
              <>
                <View style={{ gap: 0 }}>
                  <Txt size={16} weight={600} color="#FFFFFF">
                    {t("basket")}
                  </Txt>
                  <Txt size={14} color="#D5DBE6" num>
                    {itemCount(basket.length, s.language)}
                  </Txt>
                </View>
                <Row style={{ gap: 8 }}>
                  <Amount
                    value={rupees(total)}
                    size={24}
                    weight={700}
                    color="#FFFFFF"
                  />
                  <Icon name="chevron-up" size={22} color="#FFFFFF" />
                </Row>
              </>
            )}
          </Pressable>
        )}
      </View>
      {wide && (
        <View
          style={{
            width: 340,
            borderLeftWidth: 1,
            borderColor: palette.rule,
            backgroundColor: palette.paper,
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
            {!!scanWarning && <Strip tone="declined">{scanWarning}</Strip>}
            {voiceItem && (
              <Strip tone="waiting" icon="mic-outline">
                {(s.language === "hi" ? "बोला गया: " : "Spoken: ") +
                  `${spokenItemTitle(voiceItem)} · ${readableQuantity(voiceItem.quantity)} ${w(readableUnit(voiceItem.unit))}`}
                {"\n"}
                {s.language === "hi"
                  ? "नाम, ताकत, रूप, मात्रा और इकाई जाँचें।"
                  : "Verify medicine, strength, form, quantity and unit."}
              </Strip>
            )}
            <Txt size={14} color={palette.ink2} style={{ marginBottom: 10 }}>
              Select the batch printed on the medicine you are supplying.
            </Txt>
            <View style={{ gap: 8, marginBottom: 24 }}>
              {(sellable.get(selected.productId) ?? []).map((b) => {
                const on = selected.id === b.id;
                return (
                  <Pressable
                    key={b.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      setSelected(b);
                    }}
                    style={{
                      minHeight: 60,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: radius.md,
                      borderWidth: on ? 2 : 1,
                      borderColor: on ? palette.blue : palette.ruleStrong,
                      backgroundColor: on ? palette.blueTint : palette.paper,
                    }}
                  >
                    <Icon
                      name={on ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={on ? palette.blue : palette.ink3}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt size={16} weight={600} num>
                        {b.code}
                      </Txt>
                      <Txt size={14} color={palette.ink2} num>
                        {s.language === "hi" ? "एक्सपायरी" : "Exp"} {b.expiry}
                      </Txt>
                    </View>
                    <Txt size={14} weight={500} color={palette.ink2} num>
                      {s.language === "hi"
                        ? `${b.quantity} स्टॉक में`
                        : `${b.quantity} in stock`}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            {!unit && (
              <Strip tone="declined">
                {s.language === "hi"
                  ? "बोली गई इकाई नहीं मिली। सही इकाई नीचे चुनें।"
                  : "Spoken unit was not recognised. Choose the actual unit below."}
              </Strip>
            )}
            <Txt size={14} weight={500} color={palette.ink2}>
              {t("quantity")}
            </Txt>
            <Row style={{ gap: 12, marginTop: 6, marginBottom: 20 }}>
              <StepButton
                icon="remove"
                label={s.language === "hi" ? "मात्रा घटाएँ" : "Decrease quantity"}
                onPress={() => stepQty(-1)}
              />
              <TextInput
                value={qty}
                onChangeText={(v) => {
                  setQty(v);
                  s.setError("");
                }}
                accessibilityLabel={t("quantity")}
                keyboardType="decimal-pad"
                selectTextOnFocus
                selectionColor={palette.blue}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 56,
                  paddingVertical: 0,
                  textAlign: "center",
                  textAlignVertical: "center",
                  includeFontPadding: false,
                  fontSize: 28,
                  fontFamily: fonts.semibold,
                  fontVariant: ["tabular-nums"],
                  color: palette.ink,
                  borderWidth: 1,
                  borderColor: palette.ruleStrong,
                  borderRadius: radius.md,
                  backgroundColor: palette.paper,
                }}
              />
              <StepButton
                icon="add"
                label={s.language === "hi" ? "मात्रा बढ़ाएँ" : "Increase quantity"}
                onPress={() => stepQty(1)}
              />
            </Row>
            <Txt size={14} weight={500} color={palette.ink2}>
              {t("unit")}
            </Txt>
            <Row style={{ flexWrap: "wrap", gap: 8, marginTop: 6, marginBottom: 20 }}>
              {Object.keys(state.products[selected.productId].units).map(
                (u) => (
                  <Chip
                    key={u}
                    active={unit === u}
                    onPress={() => {
                      setUnit(u);
                      s.setError("");
                    }}
                  >
                    {u}
                  </Chip>
                ),
              )}
            </Row>
            {overStock ? (
              <Strip tone="declined">
                {onlyInStock(stockLeft!.lt(0) ? D(0) : stockLeft!)}
              </Strip>
            ) : (
              !!lineError && <Strip tone="declined">{lineError}</Strip>
            )}
            <Button
              disabled={
                !Number(qty) || !unit || busy || overStock || !!lineError
              }
              onPress={() => void add()}
              icon="checkmark"
            >
              {(s.language === "hi"
                ? `बैच ${selected.code} जाँचा · जोड़ें`
                : `Batch ${selected.code} checked · Add`) +
                (lineAmount === null ? "" : ` · ${rupees(lineAmount)}`)}
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
          customerId={selling.entry.customerId}
          onCustomer={(id) =>
            void selling.update((v) => ({ ...v, customerId: id || undefined }))
          }
          onComplete={(i) => void finishEntry(i)}
          onHeld={(message) => {
            setHeldNotice(message ? { tone: "paid", text: message } : null);
            void finishEntry();
          }}
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
  customerId: draftCustomerId,
  onCustomer,
}: {
  lines: OrderLine[];
  onComplete: (i: Invoice) => void;
  /** The bill is parked; `message` is a confirmation to show on the Sell screen. */
  onHeld: (message?: string) => void;
  /** Collect an order already in Orders. Otherwise `attempt` and `pin` are required. */
  existingOrderId?: string;
  attempt?: CheckoutAttempt;
  pin?: (attempt: CheckoutAttempt) => Promise<boolean>;
  /** A new sale's customer from its saved draft, and where to save a change to it. */
  customerId?: string;
  onCustomer?: (id: string) => void;
}) {
  const s = useSession(),
    t = useText(),
    state = s.state!;
  const approvedDiscount = Object.values(state.approvals).find(
    (a) =>
      a.kind === "discount" &&
      a.status === "approved" &&
      a.payload.orderId === existingOrderId &&
      a.payload.orderVersion === state.orders[existingOrderId ?? ""]?.version,
  );
  // The owner gives a discount straight at checkout; staff must ask the owner first.
  const isOwner = s.identity?.actor.role === "owner";
  const [ownerDiscount, setOwnerDiscount] = useState("");
  let ownerDiscountPaise = 0;
  if (isOwner && !approvedDiscount) {
    try {
      ownerDiscountPaise = ownerDiscount.trim() ? exactPaise(ownerDiscount) : 0;
    } catch {
      /* keep the bill whole while the amount is being typed */
    }
  }
  const discountPaise = approvedDiscount
    ? Number(approvedDiscount.payload.amountPaise ?? 0)
    : ownerDiscountPaise;
  // An approved discount larger than the bill must never crash this screen: show the bill
  // without it and ask for the discount to be declined and requested again.
  let discountTooBig = false;
  let quoted;
  try {
    quoted = quote(state, lines, new Date().toISOString(), discountPaise);
  } catch (e) {
    if (!discountPaise) throw e;
    discountTooBig = true;
    quoted = quote(state, lines, new Date().toISOString());
  }
  const total = quoted.reduce((n, l) => n + l.netPaise, 0);
  // Coming back to an order whose credit the owner approved: start on that credit, with its amount.
  const approvedCredit = Object.values(state.approvals).find(
    (a) =>
      a.kind === "credit" &&
      a.status === "approved" &&
      a.payload.orderId === existingOrderId &&
      a.payload.orderVersion === state.orders[existingOrderId ?? ""]?.version,
  );
  const approvedCreditPaise = Number(approvedCredit?.payload.amountPaise ?? 0);
  const [method, setMethod] = useState(approvedCredit ? "credit" : "cash"),
    [customerId, setCustomerId] = useState(
      existingOrderId
        ? (state.orders[existingOrderId]?.customerId ?? "")
        : (draftCustomerId ??
            state.orders[attempt?.orderId ?? ""]?.customerId ??
            ""),
    ),
    [cash, setCash] = useState(
      approvedCredit
        ? (Math.max(0, total - approvedCreditPaise) / 100).toString()
        : "0",
    ),
    [received, setReceived] = useState(""),
    [credit, setCredit] = useState(
      approvedCredit ? (approvedCreditPaise / 100).toString() : "0",
    ),
    [ref, setRef] = useState(""),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [patient, setPatient] = useState(""),
    [address, setAddress] = useState(""),
    [doctor, setDoctor] = useState(""),
    [doctorAddress, setDoctorAddress] = useState(""),
    [prescriptionRef, setPrescriptionRef] = useState("");
  const setCustomer = (id: string) => {
    setCustomerId(id);
    setError("");
    s.setError("");
    onCustomer?.(id);
  };
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
    if (existingOrderId) {
      const current = state.orders[existingOrderId];
      if ((current.customerId ?? "") === customerId) return current;
      // A customer chosen while collecting belongs on the order, or credit cannot name them.
      return s.command({
        type: "order.save",
        orderId: current.id,
        version: current.version,
        lines: current.lines,
        customerId: customerId || undefined,
        prescription: current.prescription,
        counterId: current.counterId,
      });
    }
    const pinned = await pinAttempt(true);
    const current = state.orders[pinned.orderId];
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
    try {
      return await s.command({
        type: "order.save",
        orderId: pinned.orderId,
        version: current?.version ?? 0,
        ...content,
        counterId:
          state.devices[s.identity!.deviceId]?.counterId ?? "counter-1",
      });
    } catch (e) {
      // Nothing reached the server, so the sale can still be billed in cash on this phone.
      if (!attempt?.online && (e as any).notSent)
        await pin!({ ...pinned, online: false });
      throw e;
    }
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
      if (discountTooBig)
        throw new Error(
          isOwner && !approvedDiscount
            ? "This discount is more than the bill. Reduce it."
            : "This discount is more than the bill. Ask the owner to decline it and request again.",
        );
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
      if (method === "credit" && cashPaise + creditPaise !== total)
        throw new Error(`Cash and credit must add up to ${rupees(total)}`);
      // Only an approval for exactly this order, version, customer and amount can be used.
      const creditApproval =
        method === "credit"
          ? Object.values(s.state!.approvals).find(
              (a) =>
                a.kind === "credit" &&
                a.status === "approved" &&
                a.payload.orderId === order.id &&
                a.payload.orderVersion === order.version &&
                a.payload.customerId === customerId &&
                a.payload.amountPaise === creditPaise,
            )
          : undefined;
      if (method === "credit" && !isOwner) {
        if (!customerId) throw new Error("Select a customer for credit");
        const waiting = Object.values(s.state!.approvals).some(
          (a) =>
            a.kind === "credit" &&
            a.status === "pending" &&
            a.payload.orderId === order.id,
        );
        if (waiting)
          throw new Error(
            "This credit is already waiting for the owner. You will see it on screen when they decide.",
          );
        if (!creditApproval) {
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
          onHeld("Sent to the owner for approval. The bill is waiting in Orders.");
          return;
        }
      }
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
        creditApprovalId: creditApproval?.id,
        discountPaise,
        discountApprovalId: approvedDiscount?.id,
      });
      onComplete(invoice);
    });
  const short = change !== null && change < 0;
  const changeInk = short ? palette.declined : palette.paid;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Txt size={14} weight={500} color={palette.ink2}>
          {t("total")}
        </Txt>
        <Amount value={rupees(total)} size={40} weight={700} />
        <TotalRule />
      </View>
      {isOwner && !approvedDiscount && !!existingOrderId && (
        <Field
          label={s.language === "hi" ? "छूट (₹) · वैकल्पिक" : "Discount (₹) · optional"}
          value={ownerDiscount}
          onChange={(v: string) => {
            setOwnerDiscount(v);
            setError("");
          }}
          number
        />
      )}
      <CustomerPicker value={customerId} onChange={setCustomer} />
      <Row style={{ flexWrap: "wrap", gap: 8 }}>
        {["cash", "upi", "split", "credit"].map((m) => (
          <Chip
            key={m}
            active={method === m}
            onPress={() => {
              setMethod(m);
              setError("");
              s.setError("");
              if (m === "credit") {
                setCredit((total / 100).toString());
                setCash("0");
              }
            }}
          >
            {m === "split" ? "Cash + UPI" : t(m as "cash")}
          </Chip>
        ))}
      </Row>
      {method === "cash" && (
        <View style={{ gap: 4 }}>
          <Field
            label="Cash received (₹) · optional"
            value={received}
            onChange={(v: string) => {
              setReceived(v);
              setError("");
            }}
            number
          />
          <Row style={{ flexWrap: "wrap", gap: 8 }}>
            {quickAmounts(total).map((v) => (
              <Chip
                key={v}
                active={received === (v / 100).toString()}
                onPress={() => {
                  setReceived((v / 100).toString());
                  setError("");
                }}
              >
                {rupees(v)}
              </Chip>
            ))}
          </Row>
          {change !== null && (
            <Row
              style={{
                justifyContent: "space-between",
                marginTop: 12,
                paddingVertical: 12,
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderColor: palette.rule,
              }}
            >
              <Txt size={16} weight={600} color={changeInk}>
                {short ? "Short by" : "Return to customer"}
              </Txt>
              <Amount
                value={rupees(Math.abs(change!))}
                size={32}
                weight={700}
                color={changeInk}
              />
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
          label="Credit for this bill (₹)"
          value={credit}
          onChange={(v) => {
            setCredit(v);
            try {
              setCash((Math.max(0, total - exactPaise(v)) / 100).toString());
            } catch {
              /* keep cash while the amount is being typed */
            }
          }}
          number
        />
      )}
      {method === "credit" && !approvedCredit && !isOwner && (
        <Strip tone="waiting" icon="time-outline">
          {s.language === "hi"
            ? "उधार के लिए मालिक की मंज़ूरी चाहिए। सेल ऑर्डर में रुकी रहेगी और मंज़ूरी आते ही स्क्रीन पर दिखेगा।"
            : "Credit needs the owner's approval. The sale waits in Orders, and you will see it on screen as soon as they decide."}
        </Strip>
      )}
      {(method === "upi" || method === "split") && (
        <>
          <Field
            label="UPI transaction reference"
            value={ref}
            onChange={setRef}
          />
          <Pressable
            onPress={() => setVerified(!verified)}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Row>
              <Icon
                name={verified ? "checkbox" : "square-outline"}
                size={24}
                color={verified ? palette.blue : palette.ink3}
              />
              <Txt size={14} style={{ flex: 1 }}>
                I checked receipt in the merchant payment app
              </Txt>
            </Row>
          </Pressable>
          <Txt size={13} muted>
            Recorded as manually verified, not bank-confirmed.
          </Txt>
        </>
      )}
      {rx && !state.orders[existingOrderId ?? ""]?.prescription && (
        <Section title="Prescription register">
          <View style={{ marginTop: 12 }}>
            <Field label="Patient name" value={patient} onChange={setPatient} />
            <Field
              label="Patient address"
              value={address}
              onChange={setAddress}
            />
            <Field
              label="Prescriber name"
              value={doctor}
              onChange={setDoctor}
            />
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
        </Section>
      )}
      {discountTooBig && (
        <Strip tone="declined">
          {isOwner && !approvedDiscount
            ? s.language === "hi"
              ? "यह छूट बिल से ज़्यादा है। छूट कम करें।"
              : "This discount is more than the bill. Reduce it."
            : s.language === "hi"
              ? "यह छूट बिल से ज़्यादा है। मालिक से इसे मना करवाकर फिर से माँगें।"
              : "This discount is more than the bill. Ask the owner to decline it and request again."}
        </Strip>
      )}
      {!!error && <Strip tone="declined">{error}</Strip>}
      {awaitingServer && (
        <Strip tone="waiting">
          Waiting for the server to confirm this sale. Do not collect payment
          again.
        </Strip>
      )}
      <View style={{ gap: 12, marginTop: 8 }}>
        <Button
          disabled={busy || awaitingServer || discountTooBig}
          onPress={() => void finish()}
          icon="checkmark"
        >
          {busy
            ? "Saving…"
            : method === "credit" && !approvedCredit && !isOwner
              ? "Ask the owner to approve credit"
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
      </View>
      <Txt size={13} muted>
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
      const state = s.state!;
      const extras = {
        customerName: state.customers[invoice.customerId ?? ""]?.name,
        payments: Object.values(state.payments).filter(
          (p) => p.invoiceId === invoice.id,
        ),
      };
      // A page the size of the bill: the customer sees the whole receipt, not a blank letter page.
      const page = receiptPage(invoice, extras);
      const html = receiptHtml(invoice, false, { ...extras, page });
      if (Platform.OS === "web") {
        await Print.printAsync({ html });
      } else {
        const file = await Print.printToFileAsync({
          html,
          width: page.width,
          height: page.height,
          margins: { left: 0, top: 0, right: 0, bottom: 0 },
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
      // The bill record does not hold how it was paid; the paper receipt should say so, like the PDF.
      const paid = paymentLine(
        invoice,
        Object.values(s.state!.payments).filter(
          (p) => p.invoiceId === invoice.id,
        ),
      );
      const r = await fetch(`${url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lease: s.identity!.lease,
          invoice: paid ? { ...invoice, paid } : invoice,
        }),
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
  const offlineBill = s.pending.some(
    (e) => `${e.command.id}:invoice` === invoice?.id,
  );
  // A bill is on credit when its recorded payments fall short of the total.
  const paidPaise = invoice
    ? Object.values(s.state!.payments)
        .filter((p) => p.invoiceId === invoice.id)
        .reduce((n, p) => n + p.amountPaise, 0)
    : 0;
  const onCredit = !!invoice && !offlineBill && paidPaise < invoice.totalPaise;
  return (
    <Sheet visible={!!invoice} title={t("receipt")} onClose={onClose}>
      {invoice && (
        <>
          <Row
            style={{
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 16,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size={13} muted>
                Bill no.
              </Txt>
              <Txt size={22} weight={700} num>
                {invoice.number}
              </Txt>
            </View>
            <View style={{ paddingTop: 8, paddingRight: 6 }}>
              <Stamp
                tone={onCredit ? "waiting" : "paid"}
                size="lg"
                land
                date={stampDate(invoice.occurredAt, s.language)}
              >
                {onCredit ? "Credit" : "Paid"}
              </Stamp>
            </View>
          </Row>
          {offlineBill ? (
            <Strip tone="waiting" icon="cloud-offline-outline">
              Saved on this phone · sends when online
            </Strip>
          ) : (
            <Row style={{ gap: 6, marginBottom: 8 }}>
              <Icon name="checkmark-circle" size={18} color={palette.paid} />
              <Txt size={14} color={palette.ink2}>
                Bill saved
              </Txt>
            </Row>
          )}
          <View style={{ marginTop: 8 }}>
            {invoice.lines.map((l, i) => (
              <Row
                key={i}
                style={{
                  justifyContent: "space-between",
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderColor: palette.rule,
                  minHeight: 60,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={16} weight={600}>
                    {l.name}{" "}
                    <Txt size={14} color={palette.ink2}>
                      {l.strength}
                    </Txt>
                  </Txt>
                  <Txt size={14} color={palette.ink2} num>
                    {l.quantity} {l.unit} ·{" "}
                    <Txt size={14} weight={600} num color={palette.ink2}>
                      {l.batchCode}
                    </Txt>
                  </Txt>
                </View>
                <Amount value={rupees(l.netPaise)} size={16} />
              </Row>
            ))}
          </View>
          <View style={{ marginTop: 16 }}>
            <TotalRule />
            <Row
              style={{ justifyContent: "space-between", paddingVertical: 8 }}
            >
              <Txt size={16} weight={600}>
                {t("total")}
              </Txt>
              <Amount value={rupees(invoice.totalPaise)} size={32} weight={700} />
            </Row>
          </View>
          <View style={{ gap: 12, marginTop: 24 }}>
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
                <Txt size={14} color={palette.ink2}>
                  Print status: {printStatus}
                </Txt>
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
                    <Pressable
                      onPress={() => setPaperChecked(!paperChecked)}
                      style={{ minHeight: 48, justifyContent: "center" }}
                    >
                      <Row>
                        <Icon
                          name={paperChecked ? "checkbox" : "square-outline"}
                          color={paperChecked ? palette.blue : palette.ink3}
                        />
                        <Txt size={14}>I checked the printer and paper</Txt>
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
              <Txt size={14} color={palette.ink2}>
                {error}
              </Txt>
            )}
          </View>
        </>
      )}
    </Sheet>
  );
}
