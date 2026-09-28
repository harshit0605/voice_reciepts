import React, { useState } from "react";
import { View, Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { useSession, uid } from "./session";
import { Txt, Button, Field, Row, Chip, Sheet, colors, styles } from "./ui";
import {
  D,
  NOTES,
  rupees,
  indiaDate,
  expectedCash,
  denominationTotal,
  differenceText,
  dayReportHtml,
  openDrawerSession,
  lastClosedDrawer,
  type DayReport,
  type Denominations,
  type DrawerSession,
  type Eod,
} from "@counterwell/core";

export const clock = (at?: string) =>
  at
    ? new Date(at).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
export const dayLabel = (date: string, hi = false) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(hi ? "hi-IN" : "en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
/** Red when short, amber when over, green when it matches. */
export const differenceColour = (paise?: number) =>
  paise === undefined
    ? colors.muted
    : paise < 0
      ? colors.red
      : paise > 0
        ? colors.amber
        : colors.accent;
const paiseOf = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  return D(value.trim()).mul(100).toNumber();
};
const whole = (value: string) => {
  if (!value.trim()) return 0;
  return /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : null;
};

/** Count notes one kind at a time, or type the total. */
function useCashCount() {
  const hi = useSession().language === "hi";
  const [byNotes, setByNotes] = useState(true),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [coins, setCoins] = useState(""),
    [total, setTotal] = useState("");
  let paise: number | null = null,
    denominations: Denominations | undefined;
  if (byNotes) {
    const d: Denominations = {};
    let valid = true;
    for (const n of NOTES) {
      const count = whole(notes[n] ?? "");
      if (count === null) valid = false;
      else if (count) d[String(n)] = count;
    }
    const c = coins.trim() ? paiseOf(coins) : 0;
    if (c === null) valid = false;
    else if (c) d.coins = c;
    if (valid && Object.keys(d).length) {
      denominations = d;
      paise = denominationTotal(d);
    } else if (valid) paise = 0;
  } else paise = paiseOf(total);
  const reset = () => {
    setNotes({});
    setCoins("");
    setTotal("");
  };
  const element = (
    <View style={{ gap: 4 }}>
      <Row style={{ marginBottom: 8 }}>
        <Chip active={byNotes} onPress={() => setByNotes(true)}>
          {hi ? "नोट गिनें" : "Count notes"}
        </Chip>
        <Chip active={!byNotes} onPress={() => setByNotes(false)}>
          {hi ? "कुल लिखें" : "Type the total"}
        </Chip>
      </Row>
      {byNotes ? (
        <>
          {NOTES.map((n) => (
            <Row key={n} style={{ alignItems: "center" }}>
              <Txt bold style={{ width: 64 }}>
                ₹{n} ×
              </Txt>
              <View style={{ flex: 1 }}>
                <Field
                  value={notes[n] ?? ""}
                  onChange={(v) => setNotes({ ...notes, [n]: v })}
                  number
                  placeholder="0"
                />
              </View>
              <Txt muted style={{ width: 92, textAlign: "right" }}>
                {rupees(n * 100 * (whole(notes[n] ?? "") ?? 0))}
              </Txt>
            </Row>
          ))}
          <Row style={{ alignItems: "center" }}>
            <Txt bold style={{ width: 64 }}>
              {hi ? "सिक्के" : "Coins"}
            </Txt>
            <View style={{ flex: 1 }}>
              <Field value={coins} onChange={setCoins} number placeholder="₹" />
            </View>
            <View style={{ width: 92 }} />
          </Row>
        </>
      ) : (
        <Field
          label="Total cash (₹)"
          value={total}
          onChange={setTotal}
          number
        />
      )}
      <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
        <Txt muted>{hi ? "गिनी गई नकदी" : "Cash counted"}</Txt>
        <Txt size={24} bold>
          {paise === null ? "—" : rupees(paise)}
        </Txt>
      </Row>
    </View>
  );
  return { element, paise, denominations, reset };
}

type Step = "open" | "count" | "move" | "close" | null;
const MOVES = [
  ["withdrawal", "Paid out", "पैसे दिए"],
  ["safe_transfer", "Taken to safe or owner", "तिजोरी / मालिक को"],
  ["introduced", "Put in", "पैसे डाले"],
] as const;
const MOVE_REASONS: Record<string, [string, string][]> = {
  withdrawal: [
    ["Delivery charge", "डिलीवरी खर्च"],
    ["Supplier paid in cash", "सप्लायर को नकद"],
    ["Shop expense", "दुकान खर्च"],
  ],
  safe_transfer: [["Excess cash to owner", "ज़्यादा नकदी मालिक को"]],
  introduced: [
    ["Change from bank", "बैंक से खुले पैसे"],
    ["Owner added float", "मालिक ने नकदी डाली"],
  ],
};

/**
 * The shared drawer for whoever is at the counter. Counting is blind: nobody sees what the
 * drawer should hold before entering their count, and staff never see it at all.
 */
export function DrawerPanel() {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi",
    me = s.identity!.actor,
    owner = me.role === "owner";
  const drawer = openDrawerSession(state);
  const previous = lastClosedDrawer(state);
  const [step, setStep] = useState<Step>(null),
    [done, setDone] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState<"withdrawal" | "safe_transfer" | "introduced">(
      "withdrawal",
    ),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [kept, setKept] = useState(""),
    [note, setNote] = useState("");
  const count = useCashCount();
  const canUse = owner || me.canCollect;
  const close = () => {
    setStep(null);
    setDone(null);
    setError("");
    setAmount("");
    setReason("");
    setKept("");
    setNote("");
    count.reset();
  };
  async function run(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setDone(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const needCount = () => {
    if (count.paise === null)
      throw new Error(hi ? "गिनती सही से भरें" : "Enter the count correctly");
    return count.paise;
  };
  // Shown to the owner only, after the count is saved.
  const result = (counted: number, expected: number) =>
    owner
      ? `${hi ? "गिना" : "Counted"} ${rupees(counted)} · ${hi ? "होना चाहिए" : "should be"} ${rupees(expected)} · ${differenceText(counted - expected)}`
      : hi
        ? "गिनती सेव हुई। मालिक को नतीजा दिखेगा।"
        : "Count saved. The owner sees the result.";

  const lastCheck = drawer?.checks?.at(-1);
  const myLastCheck = drawer?.checks?.filter((c) => c.by === me.id).at(-1);
  return (
    <View style={{ gap: 12 }}>
      {drawer ? (
        <View style={styles.panel}>
          {owner && (
            <>
              <Txt muted size={12}>
                {hi ? "दराज़ में होना चाहिए" : "Should be in the drawer"}
              </Txt>
              <Txt size={34} bold style={{ marginTop: 6 }}>
                {rupees(expectedCash(state, drawer.id))}
              </Txt>
            </>
          )}
          <Txt size={12} muted style={{ marginTop: owner ? 8 : 0 }}>
            {hi
              ? `${clock(drawer.openedAt)} पर ${state.members[drawer.openedBy]?.name ?? ""} ने ${rupees(drawer.openingPaise)} से खोला`
              : `Opened ${clock(drawer.openedAt)} by ${state.members[drawer.openedBy]?.name ?? "someone"} with ${rupees(drawer.openingPaise)}`}
            {indiaDate(drawer.openedAt) !== indiaDate(new Date().toISOString())
              ? ` · ${dayLabel(indiaDate(drawer.openedAt), hi)}`
              : ""}
          </Txt>
          {owner && !!drawer.openingDifferencePaise && (
            <Txt
              size={12}
              style={{
                marginTop: 6,
                color: differenceColour(drawer.openingDifferencePaise),
              }}
            >
              {hi
                ? `खोलते समय पिछली बार छोड़ी नकदी से ${differenceText(drawer.openingDifferencePaise)}`
                : `At opening: ${differenceText(drawer.openingDifferencePaise)} against the cash left at the last close`}
            </Txt>
          )}
          {owner && lastCheck && (
            <Txt
              size={12}
              style={{
                marginTop: 6,
                color: differenceColour(lastCheck.differencePaise),
              }}
            >
              {hi
                ? `आख़िरी गिनती ${clock(lastCheck.at)} · ${state.members[lastCheck.by]?.name ?? ""} · ${differenceText(lastCheck.differencePaise)}`
                : `Last count ${clock(lastCheck.at)} by ${state.members[lastCheck.by]?.name ?? "someone"}: ${differenceText(lastCheck.differencePaise)}`}
            </Txt>
          )}
          {!owner && myLastCheck && (
            <Txt size={12} muted style={{ marginTop: 6 }}>
              {hi
                ? `आपने ${clock(myLastCheck.at)} पर ${rupees(myLastCheck.countedPaise)} गिने`
                : `You counted ${rupees(myLastCheck.countedPaise)} at ${clock(myLastCheck.at)}`}
            </Txt>
          )}
        </View>
      ) : (
        <View style={styles.panel}>
          <Txt bold>{hi ? "दराज़ बंद है" : "The drawer is closed"}</Txt>
          <Txt size={12} muted style={{ marginTop: 6 }}>
            {previous
              ? hi
                ? `आख़िरी बार ${dayLabel(indiaDate(previous.closedAt!), hi)} ${clock(previous.closedAt)} पर ${state.members[previous.closedBy ?? ""]?.name ?? ""} ने बंद किया`
                : `Last closed ${dayLabel(indiaDate(previous.closedAt!))} ${clock(previous.closedAt)} by ${state.members[previous.closedBy ?? ""]?.name ?? "someone"}`
              : hi
                ? "पहली नकद बिक्री से पहले दराज़ की नकदी गिनकर खोलें।"
                : "Count the cash in it and open it before the first cash sale."}
          </Txt>
          {owner && previous?.discrepancyPaise !== undefined && (
            <Txt
              size={12}
              style={{
                marginTop: 6,
                color: differenceColour(previous.discrepancyPaise),
              }}
            >
              {hi ? "बंद करते समय" : "At close"}:{" "}
              {differenceText(previous.discrepancyPaise)}
              {previous.keptPaise !== undefined
                ? ` · ${hi ? "दराज़ में छोड़े" : "left in drawer"} ${rupees(previous.keptPaise)}`
                : ""}
            </Txt>
          )}
        </View>
      )}
      {!canUse ? (
        <Txt muted size={12}>
          {hi
            ? "दराज़ के लिए पैसे लेने की अनुमति चाहिए।"
            : "Drawer access needs payment collection permission."}
        </Txt>
      ) : drawer ? (
        <Row style={{ flexWrap: "wrap" }}>
          <Button
            small
            icon="calculator-outline"
            onPress={() => setStep("count")}
          >
            {hi ? "नकदी गिनें" : "Count cash"}
          </Button>
          <Button
            small
            secondary
            icon="swap-vertical-outline"
            onPress={() => setStep("move")}
          >
            {hi ? "पैसे डाले / निकाले" : "Cash in / out"}
          </Button>
          <Button
            small
            secondary
            icon="lock-closed-outline"
            onPress={() => setStep("close")}
          >
            {hi ? "दराज़ बंद करें" : "Close drawer"}
          </Button>
        </Row>
      ) : (
        <Button icon="lock-open-outline" onPress={() => setStep("open")}>
          {hi ? "गिनकर दराज़ खोलें" : "Count and open drawer"}
        </Button>
      )}
      <Sheet
        visible={!!step}
        title={
          step === "open"
            ? hi
              ? "दराज़ खोलें"
              : "Open the drawer"
            : step === "count"
              ? hi
                ? "नकदी गिनें"
                : "Count the cash"
              : step === "move"
                ? hi
                  ? "पैसे डाले या निकाले"
                  : "Cash in or out"
                : hi
                  ? "दराज़ बंद करें"
                  : "Close the drawer"
        }
        onClose={close}
      >
        {done ? (
          <View style={{ gap: 14 }}>
            <View style={styles.panel}>
              <Txt bold size={16}>
                {done}
              </Txt>
            </View>
            <Button onPress={close}>{hi ? "ठीक है" : "Done"}</Button>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {step !== "move" && (
              <Txt muted size={12}>
                {step === "open"
                  ? hi
                    ? "पहली बिक्री से पहले दराज़ की सारी नकदी गिनें।"
                    : "Count all the cash in the drawer before the first sale."
                  : hi
                    ? "दराज़ की सारी नकदी गिनें। गिनती सेव होने के बाद बदली नहीं जा सकती।"
                    : "Count all the cash in the drawer. A saved count cannot be changed."}
              </Txt>
            )}
            {step === "move" ? (
              <>
                <Row style={{ flexWrap: "wrap" }}>
                  {MOVES.map(([k, en, hindi]) => (
                    <Chip
                      key={k}
                      active={kind === k}
                      onPress={() => {
                        setKind(k);
                        setReason("");
                      }}
                    >
                      {hi ? hindi : en}
                    </Chip>
                  ))}
                </Row>
                <Field
                  label="Amount (₹)"
                  value={amount}
                  onChange={setAmount}
                  number
                />
                <Row style={{ flexWrap: "wrap" }}>
                  {MOVE_REASONS[kind].map(([en, hindi]) => (
                    <Chip
                      key={en}
                      active={reason === en}
                      onPress={() => setReason(en)}
                    >
                      {hi ? hindi : en}
                    </Chip>
                  ))}
                </Row>
                <Field label="Reason" value={reason} onChange={setReason} />
                <Txt muted size={12}>
                  {hi
                    ? "आपके नाम से दर्ज होगा और मालिक को दिन की रिपोर्ट में दिखेगा।"
                    : "Recorded with your name and shown to the owner in the day report."}
                </Txt>
              </>
            ) : (
              count.element
            )}
            {step === "count" && (
              <Field label="Note, if any" value={note} onChange={setNote} />
            )}
            {step === "close" && (
              <>
                <Field
                  label="Leave in the drawer for the next opening (₹)"
                  value={kept}
                  onChange={setKept}
                  number
                />
                <Row style={{ flexWrap: "wrap" }}>
                  {[0, drawer?.openingPaise ?? 0, 100000, 200000]
                    .filter((v, i, all) => all.indexOf(v) === i)
                    .map((v) => (
                      <Chip
                        key={v}
                        active={kept === (v / 100).toString()}
                        onPress={() => setKept((v / 100).toString())}
                      >
                        {rupees(v)}
                      </Chip>
                    ))}
                </Row>
                <Txt muted size={12}>
                  {hi
                    ? "बाकी नकदी मालिक या तिजोरी में जाती है। अगली बार खोलते समय गिनती इससे मिलाई जाएगी।"
                    : "The rest goes to the owner or the safe. The next opening count is compared with this."}
                </Txt>
              </>
            )}
            {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
            <Button
              disabled={busy}
              icon="checkmark"
              onPress={() =>
                void run(async () => {
                  if (step === "open") {
                    const paise = needCount();
                    const res = (await s.command({
                      type: "drawer.open",
                      drawerId: uid(),
                      openingPaise: paise,
                      ...(count.denominations
                        ? { denominations: count.denominations }
                        : {}),
                    })) as DrawerSession;
                    return owner && res.openingDifferencePaise
                      ? `${hi ? "दराज़ खुली" : "Drawer opened"} · ${differenceText(res.openingDifferencePaise)} ${hi ? "पिछली बार छोड़ी नकदी से" : "against the cash left at the last close"}`
                      : hi
                        ? `${rupees(paise)} से दराज़ खुली`
                        : `Drawer opened with ${rupees(paise)}`;
                  }
                  if (step === "count") {
                    const paise = needCount();
                    const check = (await s.command({
                      type: "drawer.count",
                      drawerId: drawer!.id,
                      countedPaise: paise,
                      ...(count.denominations
                        ? { denominations: count.denominations }
                        : {}),
                      ...(note.trim() ? { note: note.trim() } : {}),
                    })) as { expectedPaise?: number };
                    return result(paise, check.expectedPaise ?? paise);
                  }
                  if (step === "move") {
                    const paise = paiseOf(amount);
                    if (!paise)
                      throw new Error(hi ? "रकम लिखें" : "Enter the amount");
                    if (reason.trim().length < 3)
                      throw new Error(hi ? "कारण लिखें" : "Enter the reason");
                    await s.command({
                      type: "cash.move",
                      drawerId: drawer!.id,
                      kind,
                      amountPaise: paise,
                      reason: reason.trim(),
                    });
                    return `${hi ? "दर्ज हुआ" : "Recorded"}: ${rupees(paise)} · ${reason.trim()}`;
                  }
                  const paise = needCount();
                  const keptPaise = kept.trim() ? paiseOf(kept) : undefined;
                  if (keptPaise === null)
                    throw new Error(
                      hi
                        ? "छोड़ी गई रकम सही लिखें"
                        : "Enter the cash left correctly",
                    );
                  const closed = (await s.command({
                    type: "drawer.close",
                    drawerId: drawer!.id,
                    countedPaise: paise,
                    ...(keptPaise !== undefined ? { keptPaise } : {}),
                    ...(count.denominations
                      ? { denominations: count.denominations }
                      : {}),
                  })) as { expectedPaise?: number };
                  return owner && closed.expectedPaise !== undefined
                    ? `${hi ? "दराज़ बंद" : "Drawer closed"} · ${result(paise, closed.expectedPaise)}`
                    : hi
                      ? "दराज़ बंद हुई। मालिक को दिन की रिपोर्ट मिलेगी।"
                      : "Drawer closed. The owner gets the day report.";
                })
              }
            >
              {busy
                ? hi
                  ? "सेव हो रहा है…"
                  : "Saving…"
                : step === "open"
                  ? hi
                    ? "गिनती सेव करें · दराज़ खोलें"
                    : "Save count · Open drawer"
                  : step === "count"
                    ? hi
                      ? "गिनती सेव करें"
                      : "Save count"
                    : step === "move"
                      ? hi
                        ? "दर्ज करें"
                        : "Record"
                      : hi
                        ? "गिनती सेव करें · बंद करें"
                        : "Save count · Close drawer"}
            </Button>
          </View>
        )}
      </Sheet>
    </View>
  );
}

async function sharePdf(html: string, name: string) {
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }
  const file = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const named = new FileSystem.File(FileSystem.Paths.cache, `${name}.pdf`);
  if (named.exists) named.delete();
  new FileSystem.File(file.uri).move(named);
  await Sharing.shareAsync(named.uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: name,
  });
}

function Line({
  label,
  value,
  strong = false,
  colour,
}: {
  label: string;
  value: string;
  strong?: boolean;
  colour?: string;
}) {
  return (
    <Row style={{ justifyContent: "space-between", paddingVertical: 5 }}>
      <Txt muted={!strong} bold={strong} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt bold={strong} style={colour ? { color: colour } : undefined}>
        {value}
      </Txt>
    </Row>
  );
}

/** One day's report: live, or a saved revision with what changed since the one before. */
export function DayReportView({
  report,
  eod,
  previous,
}: {
  report: DayReport;
  eod?: Eod;
  previous?: Eod;
}) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi";
  const [error, setError] = useState("");
  const change =
    previous && eod
      ? eod.totals.netSalesPaise - previous.totals.netSalesPaise
      : 0;
  const cashChange =
    previous && eod
      ? eod.totals.cashCollectedPaise - previous.totals.cashCollectedPaise
      : 0;
  const r = report;
  return (
    <View style={{ gap: 18 }}>
      <View>
        <Txt size={20} bold>
          {dayLabel(r.date, hi)}
        </Txt>
        <Txt muted size={12} style={{ marginTop: 4 }}>
          {eod
            ? `${hi ? "संस्करण" : "Revision"} ${eod.revision} · ${clock(eod.createdAt)}${eod.provisional ? (hi ? " · फ़ोन सिंक होना बाकी" : " · waiting for phones to sync") : hi ? " · सभी फ़ोन सिंक" : " · all phones synced"}`
            : hi
              ? "अभी तक का हिसाब"
              : "So far today"}
        </Txt>
        {!!previous && (change !== 0 || cashChange !== 0) && (
          <Txt size={12} style={{ marginTop: 6, color: colors.amber }}>
            {hi
              ? `संस्करण ${previous.revision} से बदलाव: बिक्री ${change >= 0 ? "+" : "−"}${rupees(Math.abs(change))}, नकद ${cashChange >= 0 ? "+" : "−"}${rupees(Math.abs(cashChange))}`
              : `Since revision ${previous.revision}: sales ${change >= 0 ? "+" : "−"}${rupees(Math.abs(change))}, cash ${cashChange >= 0 ? "+" : "−"}${rupees(Math.abs(cashChange))}`}
          </Txt>
        )}
      </View>
      <View style={styles.panel}>
        <Line
          label={hi ? "शुद्ध बिक्री" : "Net sales"}
          value={rupees(r.sales.netPaise)}
          strong
        />
        <Line label={hi ? "बिल" : "Bills"} value={String(r.sales.bills)} />
        <Line label={hi ? "नकद" : "Cash"} value={rupees(r.sales.cashPaise)} />
        <Line label="UPI" value={rupees(r.sales.upiPaise)} />
        <Line
          label={hi ? "उधार" : "Credit"}
          value={rupees(r.sales.creditPaise)}
        />
        <Line
          label={hi ? "वापसी" : "Returns"}
          value={rupees(r.sales.returnsPaise)}
        />
        <Line
          label={hi ? "छूट" : "Discounts"}
          value={rupees(r.sales.discountsPaise)}
        />
      </View>
      {r.drawers.map((d) => (
        <View key={d.id} style={styles.panel}>
          <Txt bold style={{ marginBottom: 6 }}>
            {hi ? "नकद दराज़" : "Cash drawer"} ·{" "}
            {indiaDate(d.openedAt) !== r.date
              ? `${dayLabel(indiaDate(d.openedAt), hi)} `
              : ""}
            {clock(d.openedAt)} {d.openedBy}
          </Txt>
          <Line
            label={hi ? "शुरुआती नकदी" : "Opening cash"}
            value={rupees(d.openingPaise)}
          />
          {!!d.openingDifferencePaise && (
            <Line
              label={
                hi
                  ? "पिछली बार छोड़ी नकदी से"
                  : "Against cash left at last close"
              }
              value={differenceText(d.openingDifferencePaise)}
              colour={differenceColour(d.openingDifferencePaise)}
            />
          )}
          <Line
            label={
              d.closedAt
                ? hi
                  ? "बंद करते समय होनी चाहिए थी"
                  : "Should have held at close"
                : hi
                  ? "अभी होनी चाहिए"
                  : "Should hold now"
            }
            value={rupees(d.expectedPaise)}
          />
          {d.countedPaise !== undefined ? (
            <>
              <Line
                label={`${hi ? "गिनी" : "Counted"} ${clock(d.closedAt)} · ${d.closedBy ?? ""}`}
                value={rupees(d.countedPaise)}
              />
              <Line
                label={hi ? "अंतर" : "Difference"}
                value={differenceText(d.differencePaise)}
                strong
                colour={differenceColour(d.differencePaise)}
              />
            </>
          ) : (
            <Line
              label={hi ? "बंद" : "Closed"}
              value={hi ? "अभी नहीं" : "Not yet"}
            />
          )}
          {d.keptPaise !== undefined && (
            <Line
              label={hi ? "अगली बार के लिए छोड़ी" : "Left for the next opening"}
              value={rupees(d.keptPaise)}
            />
          )}
          {!!d.lateChangePaise && (
            <Line
              label={
                hi
                  ? "बंद होने के बाद देर से आई बिक्री"
                  : "Late sales after close"
              }
              value={rupees(d.lateChangePaise)}
              colour={colors.amber}
            />
          )}
          {d.checks.map((c, i) => (
            <Line
              key={i}
              label={`${hi ? "गिनती" : "Count"} ${clock(c.at)} · ${c.name}: ${rupees(c.countedPaise)}`}
              value={differenceText(c.differencePaise)}
              colour={differenceColour(c.differencePaise)}
            />
          ))}
        </View>
      ))}
      {r.movements.length > 0 && (
        <View style={styles.panel}>
          <Txt bold style={{ marginBottom: 6 }}>
            {hi ? "दराज़ में डाले / निकाले पैसे" : "Cash put in and taken out"}
          </Txt>
          {r.movements.map((m, i) => (
            <Line
              key={i}
              label={`${clock(m.at)} · ${m.name} · ${m.reason}`}
              value={`${m.kind === "introduced" ? "+" : "−"}${rupees(m.amountPaise)}`}
            />
          ))}
        </View>
      )}
      <View style={styles.panel}>
        <Txt bold style={{ marginBottom: 6 }}>
          {hi ? "स्टाफ़" : "Staff"}
        </Txt>
        {r.staff.map((p) => (
          <View
            key={p.id}
            style={{
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <Txt bold>{p.name}</Txt>
              <Txt bold>{rupees(p.salesPaise)}</Txt>
            </Row>
            <Txt size={12} muted style={{ marginTop: 4 }}>
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
                  ? `${hi ? "निकाले" : "paid out"} ${rupees(p.cashOutPaise)}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Txt>
          </View>
        ))}
        {!r.staff.length && (
          <Txt muted>{hi ? "कोई गतिविधि नहीं" : "No activity"}</Txt>
        )}
      </View>
      {r.cancelled.length > 0 && (
        <View style={styles.panel}>
          <Txt bold style={{ marginBottom: 6 }}>
            {hi ? "रद्द ऑर्डर" : "Cancelled orders"}
          </Txt>
          {r.cancelled.map((o) => (
            <Line
              key={o.orderId}
              label={`${clock(o.at)} · ${o.name} · ${o.reason}`}
              value={rupees(o.valuePaise)}
            />
          ))}
        </View>
      )}
      <View style={styles.panel}>
        <Line
          label={hi ? "नया उधार" : "New credit given"}
          value={rupees(r.credit.givenPaise)}
        />
        <Line
          label={hi ? "उधार वापस मिला" : "Credit repaid"}
          value={rupees(r.credit.repaidPaise)}
        />
        <Line
          label={hi ? "ग्राहकों पर कुल बाकी" : "Owed by customers"}
          value={rupees(r.credit.outstandingPaise)}
          strong
        />
      </View>
      <Txt muted size={11}>
        {hi
          ? "दराज़ का अंतर साझा दराज़ का है; अपने आप किसी एक व्यक्ति पर नहीं आता।"
          : "A drawer difference belongs to the shared drawer. It does not by itself show who is responsible."}
      </Txt>
      {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
      <Button
        icon="share-outline"
        onPress={() =>
          void sharePdf(
            dayReportHtml(
              r,
              state.settings.name,
              eod?.revision,
              eod?.provisional,
            ),
            `Day report ${r.date}${eod ? ` rev ${eod.revision}` : ""}`,
          ).catch((e) => setError((e as Error).message))
        }
      >
        {hi ? "रिपोर्ट PDF भेजें" : "Share report PDF"}
      </Button>
    </View>
  );
}
