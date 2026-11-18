import React, { useEffect, useState } from "react";
import { View, Platform, Pressable, TextInput } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { useSession, uid } from "./session";
import {
  Txt,
  Button,
  Field,
  Row,
  Chip,
  Sheet,
  Section,
  Amount,
  Badge,
  Stamp,
  StaffMark,
  Entry,
  Line,
  TotalRule,
  Icon,
  palette,
  stampDate,
  clock as hhmm,
  deviceText,
  styles,
  type Tone,
} from "./ui";
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
  phonesHoldingReport,
  deviceLabel,
  type DayReport,
  type Denominations,
  type DrawerSession,
  type Eod,
} from "@counterwell/core";

export const clock = (at?: string) =>
  at
    ? new Date(at).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
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
    ? palette.ink3
    : paise < 0
      ? palette.declined
      : paise > 0
        ? palette.waiting
        : palette.paid;
/** The stamp ink for a drawer difference: short is declined, over is waiting, a match is paid. */
const differenceTone = (paise?: number): Tone =>
  paise === undefined
    ? "neutral"
    : paise < 0
      ? "declined"
      : paise > 0
        ? "waiting"
        : "paid";
const paiseOf = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  return D(value.trim()).mul(100).toNumber();
};
const whole = (value: string) => {
  if (!value.trim()) return 0;
  return /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : null;
};

const STEP = 48;
/** A − / + stepper around a numeric input, every target 48 tall. Shared with the returns form. */
export function CountStepper({
  value,
  onChange,
  label,
  decimal = false,
  placeholder = "0",
  wide = false,
  hi,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  decimal?: boolean;
  placeholder?: string;
  wide?: boolean;
  hi: boolean;
}) {
  const bump = (by: number) => {
    const n = Number(value.trim() || "0");
    if (Number.isNaN(n)) return;
    const next = Math.max(0, Math.round((n + by) * 100) / 100);
    onChange(String(next));
  };
  const button = (icon: "remove" | "add", by: number, name: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() => bump(by)}
      style={({ pressed }) => ({
        width: STEP,
        height: STEP,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        backgroundColor: pressed ? palette.rule : palette.blueTint,
      })}
    >
      <Icon name={icon} size={22} color={palette.blue} />
    </Pressable>
  );
  return (
    <Row style={{ gap: 4 }}>
      {button("remove", -1, `${label} ${hi ? "घटाएँ" : "minus one"}`)}
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.ink3}
        selectionColor={palette.blue}
        keyboardType={decimal ? "decimal-pad" : "number-pad"}
        maxFontSizeMultiplier={1.4}
        style={[
          styles.input,
          {
            width: 64,
            height: STEP,
            minHeight: STEP,
            paddingHorizontal: 4,
            paddingVertical: 0,
            textAlign: "center",
            fontVariant: ["tabular-nums"],
          },
        ]}
      />
      {button("add", 1, `${label} ${hi ? "बढ़ाएँ" : "plus one"}`)}
    </Row>
  );
}

/** One line of the count register: the denomination, the stepper, and what it adds up to. */
function CountRow({
  label,
  value,
  onChange,
  amount,
  hi,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  amount: string;
  hi: boolean;
  wide?: boolean;
}) {
  return (
    <Row
      style={{
        gap: 8,
        minHeight: 60,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderColor: palette.rule,
      }}
    >
      <View style={{ width: 62 }}>
        <Txt num weight={600}>
          {label}
        </Txt>
      </View>
      <CountStepper
        label={label}
        value={value}
        onChange={onChange}
        placeholder={wide ? "₹" : "0"}
        decimal={wide}
        wide={wide}
        hi={hi}
      />
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Amount value={amount} size={16} weight={500} color={palette.ink2} />
      </View>
    </Row>
  );
}

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
  /** Changes whenever any count input changes, so a stale error can be cleared. */
  const version = JSON.stringify([byNotes, notes, coins, total]);
  const reset = () => {
    setNotes({});
    setCoins("");
    setTotal("");
  };
  const element = (
    <View>
      <Row style={{ marginBottom: 12 }}>
        <Chip active={byNotes} onPress={() => setByNotes(true)}>
          {hi ? "नोट गिनें" : "Count notes"}
        </Chip>
        <Chip active={!byNotes} onPress={() => setByNotes(false)}>
          {hi ? "कुल लिखें" : "Type the total"}
        </Chip>
      </Row>
      {byNotes ? (
        <View style={{ borderTopWidth: 1, borderColor: palette.rule }}>
          {NOTES.map((n) => (
            <CountRow
              key={n}
              label={`₹${n} ×`}
              value={notes[n] ?? ""}
              onChange={(v) => setNotes({ ...notes, [n]: v })}
              amount={rupees(n * 100 * (whole(notes[n] ?? "") ?? 0))}
              hi={hi}
            />
          ))}
          <CountRow
            label={hi ? "सिक्के" : "Coins"}
            value={coins}
            onChange={setCoins}
            amount={rupees(coins.trim() ? (paiseOf(coins) ?? 0) : 0)}
            hi={hi}
            wide
          />
        </View>
      ) : (
        <Field
          label="Total cash (₹)"
          value={total}
          onChange={setTotal}
          number
        />
      )}
      <View style={{ marginTop: 12 }}>
        <TotalRule />
        <Row
          style={{
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: 8,
          }}
        >
          <Txt size={14} weight={500} color={palette.ink2} style={{ flex: 1 }}>
            {hi ? "गिनी गई नकदी" : "Cash counted"}
          </Txt>
          {paise === null ? (
            <Txt num size={40} weight={700}>
              —
            </Txt>
          ) : (
            <Amount value={rupees(paise)} size={40} weight={700} />
          )}
        </Row>
      </View>
    </View>
  );
  return { element, paise, denominations, reset, version };
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
  // "Bills are still sending" is only true while something is waiting to be sent.
  useEffect(() => {
    if (!s.pending.length)
      setError((e) =>
        e.includes("still sending") || e.includes("भेजे जा रहे") ? "" : e,
      );
  }, [s.pending.length]);
  // Editing the count dismisses an earlier "enter the count correctly".
  useEffect(() => setError(""), [count.version]);
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

  const checks = (drawer?.checks ?? []).filter((c) => owner || c.by === me.id);
  const openerName = drawer
    ? (state.members[drawer.openedBy]?.name ?? (hi ? "" : "someone"))
    : "";
  return (
    <View style={{ gap: 16 }}>
      {drawer ? (
        <View style={{ gap: 12 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Badge tone="paid">{hi ? "खुली" : "Open"}</Badge>
            <Txt size={13} muted num>
              {hhmm(drawer.openedAt)}
            </Txt>
          </Row>
          <Row style={{ alignItems: "flex-start" }}>
            <StaffMark id={drawer.openedBy} name={openerName} size={32} />
            <View style={{ flex: 1 }}>
              <Txt size={14} color={palette.ink2}>
                {hi
                  ? `${clock(drawer.openedAt)} पर ${openerName} ने ${rupees(drawer.openingPaise)} से खोला`
                  : `Opened ${clock(drawer.openedAt)} by ${openerName} with ${rupees(drawer.openingPaise)}`}
                {indiaDate(drawer.openedAt) !== indiaDate(new Date().toISOString())
                  ? ` · ${dayLabel(indiaDate(drawer.openedAt), hi)}`
                  : ""}
              </Txt>
            </View>
          </Row>
          {owner && (
            <View style={{ gap: 2 }}>
              <Txt size={14} weight={500} color={palette.ink2}>
                {hi ? "दराज़ में होना चाहिए" : "Should be in the drawer"}
              </Txt>
              <Amount
                value={rupees(expectedCash(state, drawer.id))}
                size={40}
                weight={700}
              />
            </View>
          )}
          {owner && !!drawer.openingDifferencePaise && (
            <Txt
              size={14}
              color={differenceColour(drawer.openingDifferencePaise)}
            >
              {hi
                ? `खोलते समय पिछली बार छोड़ी नकदी से ${differenceText(drawer.openingDifferencePaise)}`
                : `At opening: ${differenceText(drawer.openingDifferencePaise)} against the cash left at the last close`}
            </Txt>
          )}
          {checks.length > 0 && (
            <View>
              {checks.map((c) => (
                <Entry
                  key={c.at}
                  time={hhmm(c.at)}
                  title={
                    owner
                      ? `${hi ? "गिनती" : "Count"} · ${rupees(c.countedPaise)}`
                      : `${hi ? "आपने गिने" : "You counted"} ${rupees(c.countedPaise)}`
                  }
                  who={{
                    id: c.by,
                    name: state.members[c.by]?.name,
                  }}
                  detail={
                    owner ? (
                      <Txt
                        size={14}
                        weight={600}
                        color={differenceColour(c.differencePaise)}
                      >
                        {differenceText(c.differencePaise)}
                      </Txt>
                    ) : undefined
                  }
                />
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Badge tone="neutral">{hi ? "बंद" : "Closed"}</Badge>
          <Txt bold size={19}>
            {hi ? "दराज़ बंद है" : "The drawer is closed"}
          </Txt>
          <Txt size={14} color={palette.ink2}>
            {previous
              ? hi
                ? `आख़िरी बार ${dayLabel(indiaDate(previous.closedAt!), hi)} ${clock(previous.closedAt)} पर ${state.members[previous.closedBy ?? ""]?.name ?? ""} ने बंद किया`
                : `Last closed ${dayLabel(indiaDate(previous.closedAt!))} ${clock(previous.closedAt)} by ${state.members[previous.closedBy ?? ""]?.name ?? "someone"}`
              : hi
                ? "पहली नकद बिक्री से पहले दराज़ की नकदी गिनकर खोलें।"
                : "Count the cash in it and open it before the first cash sale."}
          </Txt>
          {owner && previous?.discrepancyPaise !== undefined && (
            <Txt size={14} color={differenceColour(previous.discrepancyPaise)}>
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
        <Txt muted size={13}>
          {hi
            ? "दराज़ के लिए पैसे लेने की अनुमति चाहिए।"
            : "Drawer access needs payment collection permission."}
        </Txt>
      ) : drawer ? (
        <View style={{ gap: 12 }}>
          <Button icon="calculator-outline" onPress={() => setStep("count")}>
            {hi ? "नकदी गिनें" : "Count cash"}
          </Button>
          <Row style={{ flexWrap: "wrap" }}>
            <Button
              small
              secondary
              icon="swap-vertical-outline"
              onPress={() => setStep("move")}
            >
              {hi ? "पैसे डालें / निकालें" : "Cash in / out"}
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
        </View>
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
          <View style={{ gap: 24 }}>
            <Row style={{ alignItems: "flex-start" }}>
              <Icon name="checkmark-circle" size={26} color={palette.paid} />
              <Txt bold size={16} style={{ flex: 1 }}>
                {done}
              </Txt>
            </Row>
            <Button onPress={close}>{hi ? "ठीक है" : "Done"}</Button>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {step !== "move" && (
              <Txt size={14} color={palette.ink2}>
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
                <Txt size={14} color={palette.ink2}>
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
                <Txt size={14} color={palette.ink2}>
                  {hi
                    ? "बाकी नकदी मालिक या तिजोरी में जाती है। अगली बार खोलते समय गिनती इससे मिलाई जाएगी।"
                    : "The rest goes to the owner or the safe. The next opening count is compared with this."}
                </Txt>
              </>
            )}
            {!!error && <Txt color={palette.declined}>{error}</Txt>}
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
                  if (!(await s.flushOutbox()))
                    throw new Error(
                      hi
                        ? "कुछ बिल अभी भेजे जा रहे हैं। फ़ोन में 'अप टू डेट' दिखने तक रुकें, फिर दराज़ बंद करें।"
                        : "Some bills are still sending. Wait until the phone says Up to date, then close.",
                    );
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

/** One day's report: live, or a saved revision with what changed since the one before. */
/** Why a report is still provisional: which phones have not synced since, and recoveries to check. */
function WaitingFor({ eod }: { eod: Eod }) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi";
  const phones = phonesHoldingReport(state, eod);
  const recoveries = Object.values(state.quarantine).filter(
    (q) => q.status === "pending",
  ).length;
  if (!phones.length && !recoveries) return null;
  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Badge tone="waiting">{hi ? "इंतज़ार" : "Waiting"}</Badge>
      {phones.map((d) => (
        <Txt key={d.id} size={14} color={palette.waiting}>
          {hi
            ? `इंतज़ार: ${deviceText(deviceLabel(state, d), "hi")} · आख़िरी बार ${dayLabel(indiaDate(d.lastSeen), hi)} ${clock(d.lastSeen)}${d.pendingCount ? ` · ${d.pendingCount} बिल भेजना बाकी` : ""}`
            : `Waiting for ${deviceLabel(state, d)} · last seen ${dayLabel(indiaDate(d.lastSeen), hi)} ${clock(d.lastSeen)}${d.pendingCount ? ` · ${d.pendingCount} unsent` : ""}`}
        </Txt>
      ))}
      {recoveries > 0 && (
        <Txt size={14} color={palette.waiting}>
          {hi
            ? `${recoveries} वापस मिली बिक्री की जाँच बाकी (समीक्षा में)`
            : `${recoveries} recovered ${recoveries === 1 ? "sale" : "sales"} to check in Reviews`}
        </Txt>
      )}
      {phones.length > 0 && (
        <Txt size={13} muted>
          {hi
            ? "जो फ़ोन अब इस्तेमाल नहीं होता, उसे प्रबंधन में हटाएँ।"
            : "Revoke a phone that is no longer used in Administration."}
        </Txt>
      )}
    </View>
  );
}
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
    <View>
      <View style={{ marginBottom: 24 }}>
        <Txt size={28} weight={700}>
          {dayLabel(r.date, hi)}
        </Txt>
        <Row style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          <Txt size={14} color={palette.ink2} num>
            {eod
              ? `${hi ? "संस्करण" : "Revision"} ${eod.revision} · ${clock(eod.createdAt)}`
              : hi
                ? "अभी तक का हिसाब"
                : "So far today"}
          </Txt>
          {eod && (
            <Badge tone={eod.provisional ? "waiting" : "paid"}>
              {eod.provisional
                ? hi
                  ? "फ़ोन सिंक होना बाकी"
                  : "waiting for phones to sync"
                : hi
                  ? "सभी फ़ोन सिंक"
                  : "all phones synced"}
            </Badge>
          )}
        </Row>
        {!!previous && (change !== 0 || cashChange !== 0) && (
          <Txt size={14} color={palette.waiting} style={{ marginTop: 8 }}>
            {hi
              ? `संस्करण ${previous.revision} से बदलाव: बिक्री ${change >= 0 ? "+" : "−"}${rupees(Math.abs(change))}, नकद ${cashChange >= 0 ? "+" : "−"}${rupees(Math.abs(cashChange))}`
              : `Since revision ${previous.revision}: sales ${change >= 0 ? "+" : "−"}${rupees(Math.abs(change))}, cash ${cashChange >= 0 ? "+" : "−"}${rupees(Math.abs(cashChange))}`}
          </Txt>
        )}
        {eod?.provisional && <WaitingFor eod={eod} />}
      </View>
      <View style={{ marginBottom: 32 }}>
        <Txt size={14} weight={500} color={palette.ink2}>
          {hi ? "शुद्ध बिक्री" : "Net sales"}
        </Txt>
        <Amount value={rupees(r.sales.netPaise)} size={40} weight={700} />
        <View style={{ marginTop: 8 }}>
          <TotalRule />
        </View>
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
        <Section
          key={d.id}
          title={hi ? "नकद दराज़" : "Cash drawer"}
          action={
            <Badge tone={d.closedAt ? "neutral" : "paid"}>
              {d.closedAt ? (hi ? "बंद" : "Closed") : hi ? "खुली" : "Open"}
            </Badge>
          }
        >
          <Row style={{ paddingVertical: 12 }}>
            <StaffMark id={d.openedBy} name={d.openedBy} size={32} />
            <Txt size={14} color={palette.ink2} style={{ flex: 1 }}>
              <Txt size={14} weight={600}>
                {d.openedBy}
              </Txt>
              {` · ${hi ? "खोली" : "opened"} ${
                indiaDate(d.openedAt) !== r.date
                  ? `${dayLabel(indiaDate(d.openedAt), hi)} `
                  : ""
              }${clock(d.openedAt)}`}
            </Txt>
          </Row>
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
              color={differenceColour(d.openingDifferencePaise)}
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
              <TotalRule />
              <Row
                style={{
                  justifyContent: "space-between",
                  minHeight: 60,
                  paddingVertical: 12,
                }}
              >
                <Txt size={15} weight={600}>
                  {hi ? "अंतर" : "Difference"}
                </Txt>
                <Stamp
                  tone={differenceTone(d.differencePaise)}
                  size="md"
                  date={
                    d.closedAt ? stampDate(d.closedAt, s.language) : undefined
                  }
                >
                  {differenceText(d.differencePaise)}
                </Stamp>
              </Row>
            </>
          ) : (
            <Row
              style={{
                justifyContent: "space-between",
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: palette.rule,
              }}
            >
              <Txt size={15} color={palette.ink2}>
                {hi ? "बंद" : "Closed"}
              </Txt>
              <Badge tone="waiting">{hi ? "अभी नहीं" : "Not yet"}</Badge>
            </Row>
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
              color={palette.waiting}
            />
          )}
          {d.checks.map((c, i) => (
            <Entry
              key={i}
              time={hhmm(c.at)}
              title={`${hi ? "गिनती" : "Count"} · ${rupees(c.countedPaise)}`}
              who={{ id: c.by, name: c.name }}
              amount={differenceText(c.differencePaise)}
              amountColor={differenceColour(c.differencePaise)}
            />
          ))}
        </Section>
      ))}
      {r.movements.length > 0 && (
        <Section
          title={hi ? "दराज़ में डाले / निकाले पैसे" : "Cash put in and taken out"}
        >
          {r.movements.map((m, i) => (
            <Entry
              key={i}
              time={hhmm(m.at)}
              title={
                hi
                  ? (Object.values(MOVE_REASONS)
                      .flat()
                      .find(([en]) => en === m.reason)?.[1] ?? m.reason)
                  : m.reason
              }
              who={{ name: m.name }}
              amount={`${m.kind === "introduced" ? "+" : "−"}${rupees(m.amountPaise)}`}
            />
          ))}
        </Section>
      )}
      <Section title={hi ? "स्टाफ़" : "Staff"}>
        {r.staff.map((p) => (
          <View
            key={p.id}
            style={{
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderColor: palette.rule,
              minHeight: 60,
            }}
          >
            <Row style={{ alignItems: "flex-start" }}>
              <StaffMark id={p.id} name={p.name} size={32} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt bold>{p.name}</Txt>
                <Txt size={14} color={palette.ink2}>
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
              <Amount value={rupees(p.salesPaise)} size={16} />
            </Row>
          </View>
        ))}
        {!r.staff.length && (
          <Txt muted style={{ paddingVertical: 12 }}>
            {hi ? "कोई गतिविधि नहीं" : "No activity"}
          </Txt>
        )}
      </Section>
      {r.cancelled.length > 0 && (
        <Section title={hi ? "रद्द ऑर्डर" : "Cancelled orders"}>
          {r.cancelled.map((o) => (
            <Entry
              key={o.orderId}
              time={hhmm(o.at)}
              title={o.reason}
              who={{ name: o.name }}
              amount={rupees(o.valuePaise)}
            />
          ))}
        </Section>
      )}
      <View style={{ marginBottom: 24 }}>
        <Line
          label={hi ? "नया उधार" : "New credit given"}
          value={rupees(r.credit.givenPaise)}
        />
        <Line
          label={hi ? "उधार वापस मिला" : "Credit repaid"}
          value={rupees(r.credit.repaidPaise)}
        />
        <TotalRule />
        <Line
          label={hi ? "ग्राहकों पर कुल बाकी" : "Owed by customers"}
          value={rupees(r.credit.outstandingPaise)}
          strong
        />
      </View>
      <Txt muted size={13} style={{ marginBottom: 16 }}>
        {hi
          ? "दराज़ का अंतर साझा दराज़ का है; अपने आप किसी एक व्यक्ति पर नहीं आता।"
          : "A drawer difference belongs to the shared drawer. It does not by itself show who is responsible."}
      </Txt>
      {!!error && (
        <Txt color={palette.declined} style={{ marginBottom: 12 }}>
          {error}
        </Txt>
      )}
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
