import React, { useState } from "react";
import { View } from "react-native";
import { useSession, uid } from "./session";
import { Txt, Button, Field, Row, Chip, colors, styles, useWord } from "./ui";
import {
  rupees,
  balance,
  refundQuote,
  returnable,
  returnBaseQuantity,
  returnUnits,
  openRefundRequest,
  type Approval,
  type Invoice,
  type ReturnLine,
  type State,
} from "@counterwell/core";

const RETURN_REASONS = [
  ["Doctor changed the medicine", "डॉक्टर ने दवा बदली"],
  ["Not needed any more", "अब ज़रूरत नहीं"],
  ["Wrong medicine was given", "गलत दवा दी गई"],
  ["Damaged pack", "खराब पैक"],
] as const;

/** "1 tablet", "4 tablets"; Hindi unit words do not take an English plural. */
export function amountOf(
  quantity: string | number,
  unit: string,
  w: (s: string) => string,
) {
  const word = w(unit);
  return `${quantity} ${word}${word === unit && Number(quantity) !== 1 ? "s" : ""}`;
}
/** Quantities in words: "1 strip (10 tablets)". */
function soldText(
  state: State,
  invoice: Invoice,
  index: number,
  w: (s: string) => string,
) {
  const l = invoice.lines[index];
  const base = state.products[l.productId]?.baseUnit;
  return base && base !== l.unit
    ? `${amountOf(l.quantity, l.unit, w)} (${amountOf(l.baseQuantity, base, w)})`
    : amountOf(l.baseQuantity, l.unit, w);
}
const baseUnit = (state: State, invoice: Invoice, index: number) =>
  state.products[invoice.lines[index].productId]?.baseUnit ??
  invoice.lines[index].unit;

/** Staff record what physically came back; the owner approves before any money moves. */
export function ReturnForm({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: () => void;
}) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi",
    w = useWord();
  const rows = returnable(state, invoice);
  const [entries, setEntries] = useState(
    invoice.lines.map((l) => ({ quantity: "", unit: l.unit })),
  );
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  let lines: ReturnLine[] = [],
    quote: ReturnType<typeof refundQuote> | null = null,
    problem = "";
  try {
    lines = entries.flatMap((e, index) =>
      e.quantity.trim() && Number(e.quantity) > 0
        ? [
            {
              index,
              quantity: returnBaseQuantity(
                state,
                invoice,
                index,
                e.quantity,
                e.unit,
              ),
            },
          ]
        : [],
    );
    if (lines.length) quote = refundQuote(state, invoice, lines);
  } catch (e) {
    problem = (e as Error).message;
  }
  const waiting = Object.values(state.approvals).some((a) =>
    openRefundRequest(a, invoice.id),
  );
  async function submit() {
    if (busy || !quote) return;
    setBusy(true);
    setError("");
    try {
      await s.command({
        type: "approval.request",
        approvalId: uid(),
        kind: "refund",
        reason: reason.trim(),
        payload: { invoiceId: invoice.id, lines },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Txt muted>
        {hi
          ? `बिल ${invoice.number} · सिर्फ़ वही दर्ज करें जो ग्राहक ने सच में वापस किया। पैसा मालिक की मंज़ूरी के बाद ही लौटेगा।`
          : `Bill ${invoice.number} · Enter only what the customer physically handed back. No money moves until the owner approves.`}
      </Txt>
      {waiting && (
        <Txt style={{ color: colors.amber }}>
          {hi
            ? "इस बिल की एक वापसी पहले से मालिक के पास है।"
            : "A return for this bill is already waiting for the owner."}
        </Txt>
      )}
      {rows.map((r) => {
        const units = Object.keys(returnUnits(state, invoice, r.index));
        const e = entries[r.index];
        const set = (patch: Partial<typeof e>) =>
          setEntries(
            entries.map((x, i) => (i === r.index ? { ...x, ...patch } : x)),
          );
        return (
          <View key={r.index} style={styles.listRow}>
            <Txt bold>
              {r.line.name} {r.line.strength} · {r.line.batchCode}
            </Txt>
            <Txt muted size={12} style={{ marginTop: 4, marginBottom: 8 }}>
              {`${hi ? "बेचा" : "Sold"} ${soldText(state, invoice, r.index, w)}`}
              {r.returned.gt(0)
                ? ` · ${hi ? "पहले लौटे" : "already returned"} ${amountOf(r.returned.toFixed(), baseUnit(state, invoice, r.index), w)}`
                : ""}
            </Txt>
            {r.remaining.lte(0) ? (
              <Txt muted>{hi ? "पूरा लौट चुका" : "Fully returned"}</Txt>
            ) : (
              <>
                <Field
                  label="Quantity returned"
                  value={e.quantity}
                  onChange={(quantity) => set({ quantity })}
                  number
                />
                <Row style={{ flexWrap: "wrap" }}>
                  {units.map((u) => (
                    <Chip
                      key={u}
                      active={e.unit === u}
                      onPress={() => set({ unit: u })}
                    >
                      {w(u)}
                    </Chip>
                  ))}
                </Row>
              </>
            )}
          </View>
        );
      })}
      <Txt size={12} bold muted>
        {hi ? "वापसी का कारण" : "Why it came back"}
      </Txt>
      <Row style={{ flexWrap: "wrap" }}>
        {RETURN_REASONS.map(([en, hindi]) => (
          <Chip key={en} active={reason === en} onPress={() => setReason(en)}>
            {hi ? hindi : en}
          </Chip>
        ))}
      </Row>
      <Field label="Other reason" value={reason} onChange={setReason} />
      {quote && (
        <View style={styles.panel}>
          <Txt muted size={12}>
            {hi ? "ग्राहक को लौटाना है" : "Refund to the customer"}
          </Txt>
          <Txt size={28} bold style={{ marginTop: 6 }}>
            {rupees(quote.payablePaise)}
          </Txt>
          {quote.creditReductionPaise > 0 && (
            <Txt size={12} style={{ marginTop: 6, color: colors.amber }}>
              {hi
                ? `${rupees(quote.creditReductionPaise)} ग्राहक के उधार से कटेगा`
                : `${rupees(quote.creditReductionPaise)} comes off what the customer owes`}
            </Txt>
          )}
        </View>
      )}
      {!!problem && <Txt style={{ color: colors.red }}>{problem}</Txt>}
      {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
      <Button
        disabled={busy || !quote || reason.trim().length < 3 || waiting}
        onPress={() => void submit()}
      >
        {hi ? "मालिक से मंज़ूरी माँगें" : "Ask the owner to approve"}
      </Button>
    </View>
  );
}

/** Hand back an approved return: the amount is worked out, staff only choose cash or UPI. */
export function RefundForm({
  approval,
  onDone,
}: {
  approval: Approval;
  onDone: () => void;
}) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi",
    w = useWord();
  const invoice = state.invoices[String(approval.payload.invoiceId)];
  const lines = approval.payload.lines as ReturnLine[];
  const [method, setMethod] = useState<"cash" | "upi">("cash"),
    [ref, setRef] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!invoice)
    return (
      <Txt muted>
        {hi
          ? "यह बिल इस फ़ोन पर नहीं है। मालिक के फ़ोन से पैसा लौटाएँ।"
          : "This bill is not on this phone. Hand back the refund from the owner's phone."}
      </Txt>
    );
  let quote: ReturnType<typeof refundQuote> | null = null,
    problem = "";
  try {
    quote = refundQuote(state, invoice, lines);
  } catch (e) {
    problem = (e as Error).message;
  }
  async function record() {
    if (busy || !quote) return;
    setBusy(true);
    setError("");
    try {
      await s.command({
        type: "refund.execute",
        approvalId: approval.id,
        cashPaise: method === "cash" ? quote.payablePaise : 0,
        upiPaise: method === "upi" ? quote.payablePaise : 0,
        upiReference: method === "upi" ? ref.trim() : undefined,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const payable = quote?.payablePaise ?? 0;
  return (
    <View style={{ gap: 12 }}>
      <Txt bold>{`${hi ? "बिल" : "Bill"} ${invoice.number}`}</Txt>
      {lines.map((l) => (
        <Txt key={l.index}>
          {invoice.lines[l.index]?.name} {invoice.lines[l.index]?.strength} ·{" "}
          {amountOf(l.quantity, baseUnit(state, invoice, l.index), w)}
        </Txt>
      ))}
      {quote && (
        <View style={styles.panel}>
          <Txt muted size={12}>
            {payable
              ? hi
                ? "ग्राहक को लौटाएँ"
                : "Hand back to the customer"
              : hi
                ? "कुछ नहीं लौटाना"
                : "Nothing to hand back"}
          </Txt>
          <Txt size={30} bold style={{ marginTop: 6 }}>
            {rupees(payable)}
          </Txt>
          {quote.creditReductionPaise > 0 && (
            <Txt size={12} style={{ marginTop: 6, color: colors.amber }}>
              {hi
                ? `${rupees(quote.creditReductionPaise)} ग्राहक के उधार से कटेगा`
                : `${rupees(quote.creditReductionPaise)} comes off what the customer owes`}
            </Txt>
          )}
        </View>
      )}
      {payable > 0 && (
        <Row>
          <Chip active={method === "cash"} onPress={() => setMethod("cash")}>
            {hi ? "नकद" : "Cash"}
          </Chip>
          <Chip active={method === "upi"} onPress={() => setMethod("upi")}>
            UPI
          </Chip>
        </Row>
      )}
      {payable > 0 && method === "upi" && (
        <Field
          label="UPI reference of the refund"
          value={ref}
          onChange={setRef}
        />
      )}
      <Txt muted size={12}>
        {hi
          ? "लौटाया गया सामान अलग रखा जाता है और मालिक की जाँच के बाद ही फिर बिकेगा।"
          : "Returned stock is kept aside and goes back on sale only after the owner checks it."}
      </Txt>
      {!!problem && <Txt style={{ color: colors.red }}>{problem}</Txt>}
      {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
      <Button
        disabled={
          busy || !quote || (method === "upi" && payable > 0 && !ref.trim())
        }
        onPress={() => void record()}
        icon="checkmark"
      >
        {payable
          ? hi
            ? `${rupees(payable)} लौटाया · दर्ज करें`
            : `${rupees(payable)} given back · Record`
          : hi
            ? "वापसी दर्ज करें"
            : "Record the return"}
      </Button>
    </View>
  );
}

/** Find, choose or add the customer on a sale, and see what they already owe. */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi";
  const [query, setQuery] = useState(""),
    [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = Object.values(state.customers)
    .filter(
      (c) =>
        c.id !== value &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "~")),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
  const chosen = state.customers[value];
  const owes = chosen ? balance(state, chosen.id) : 0;
  async function add() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const id = uid();
      await s.command({
        type: "customer.create",
        customer: { id, name: name.trim(), phone: phone.trim(), address: "" },
      });
      onChange(id);
      setAdding(false);
      setName("");
      setPhone("");
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Txt size={12} muted>
        {hi ? "ग्राहक" : "Customer"}
      </Txt>
      <Row style={{ flexWrap: "wrap" }}>
        <Chip active={!value} onPress={() => onChange("")}>
          {hi ? "सामान्य ग्राहक" : "Walk-in"}
        </Chip>
        {chosen && <Chip active>{chosen.name}</Chip>}
      </Row>
      {chosen && owes > 0 && (
        <Txt size={12} style={{ color: colors.amber }}>
          {hi ? `पहले से बाकी ${rupees(owes)}` : `Already owes ${rupees(owes)}`}
        </Txt>
      )}
      {!adding ? (
        <>
          <Field
            value={query}
            onChange={setQuery}
            placeholder="Find customer by name or phone"
          />
          {(q || matches.length <= 6) && matches.length > 0 && (
            <Row style={{ flexWrap: "wrap" }}>
              {matches.map((c) => (
                <Chip
                  key={c.id}
                  onPress={() => {
                    onChange(c.id);
                    setQuery("");
                  }}
                >
                  {c.phone ? `${c.name} · ${c.phone.slice(-4)}` : c.name}
                </Chip>
              ))}
            </Row>
          )}
          <Button
            secondary
            small
            icon="person-add-outline"
            onPress={() => {
              setAdding(true);
              setName(/\d/.test(query) ? "" : query);
              setPhone(/\d/.test(query) ? query : "");
            }}
          >
            {hi ? "नया ग्राहक" : "New customer"}
          </Button>
        </>
      ) : (
        <View style={styles.panel}>
          <Field label="Customer name" value={name} onChange={setName} />
          <Field label="Phone" value={phone} onChange={setPhone} number />
          {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
          <Row>
            <Button
              small
              disabled={busy || !name.trim()}
              onPress={() => void add()}
            >
              {hi ? "सेव करें" : "Save customer"}
            </Button>
            <Button small secondary onPress={() => setAdding(false)}>
              {hi ? "रद्द" : "Cancel"}
            </Button>
          </Row>
        </View>
      )}
    </View>
  );
}

export type Attention = {
  key: string;
  text: string;
  page: "orders" | "reviews";
};
const kindWord = (kind: Approval["kind"], hi: boolean) =>
  ({
    credit: hi ? "उधार" : "credit",
    discount: hi ? "छूट" : "discount",
    refund: hi ? "वापसी" : "return",
    stock: hi ? "स्टॉक बदलाव" : "stock change",
  })[kind];
const DECLINED_SHOWN_MS = 2 * 60 * 60 * 1000;

/** What needs this person now: handoffs, decisions waiting for the owner, and answers to their requests. */
export function useAttention(): Attention[] {
  const s = useSession(),
    state = s.state,
    me = s.identity?.actor,
    hi = s.language === "hi";
  if (!state || !me) return [];
  const items: Attention[] = [];
  const handed = Object.values(state.orders).filter(
    (o) => o.status === "handoff" && o.offeredTo === me.id,
  ).length;
  if (handed)
    items.push({
      key: "handoff",
      page: "orders",
      text: hi
        ? `${handed} ऑर्डर आपको सौंपा गया · खोलें`
        : `${handed === 1 ? "An order was" : `${handed} orders were`} handed to you · Open`,
    });
  const approvals = Object.values(state.approvals);
  if (me.role === "owner") {
    const waiting = approvals.filter((a) => a.status === "pending").length;
    if (waiting)
      items.push({
        key: "approvals",
        page: "reviews",
        text: hi
          ? `${waiting} अनुरोध आपकी मंज़ूरी का इंतज़ार कर रहे हैं · देखें`
          : `${waiting === 1 ? "A request is" : `${waiting} requests are`} waiting for your approval · Review`,
      });
  }
  const now = Date.now();
  for (const a of approvals) {
    if (a.requestedBy !== me.id || a.kind === "stock") continue;
    const amount =
      a.kind === "refund"
        ? (() => {
            const invoice = state.invoices[String(a.payload.invoiceId)];
            try {
              return invoice
                ? refundQuote(state, invoice, a.payload.lines as ReturnLine[])
                    .payablePaise
                : 0;
            } catch {
              return 0;
            }
          })()
        : Number(a.payload.amountPaise ?? 0);
    const orderOpen =
      a.kind === "refund" ||
      ["held", "handoff"].includes(
        state.orders[String(a.payload.orderId)]?.status ?? "",
      );
    if (!orderOpen) continue;
    const what = kindWord(a.kind, hi);
    if (a.status === "approved")
      items.push({
        key: a.id,
        page: "orders",
        text:
          a.kind === "refund"
            ? hi
              ? `मालिक ने वापसी मंज़ूर की · ${rupees(amount)} लौटाएँ`
              : `Owner approved the return · Give back ${rupees(amount)}`
            : hi
              ? `मालिक ने ${rupees(amount)} ${what} मंज़ूर किया · पैसे लें`
              : `Owner approved ${rupees(amount)} ${what} · Collect`,
      });
    else if (a.status === "pending" && me.role !== "owner")
      items.push({
        key: a.id,
        page: "orders",
        text: hi
          ? `${rupees(amount)} ${what} मालिक की मंज़ूरी का इंतज़ार कर रहा है`
          : `${rupees(amount)} ${what} is waiting for the owner`,
      });
    else if (
      a.status === "rejected" &&
      now - Date.parse(a.decidedAt ?? a.requestedAt) < DECLINED_SHOWN_MS
    )
      items.push({
        key: a.id,
        page: "orders",
        text: hi ? `मालिक ने ${what} मना किया` : `Owner declined the ${what}`,
      });
  }
  return items;
}
