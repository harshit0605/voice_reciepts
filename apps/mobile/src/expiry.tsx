import React, { useMemo, useState } from "react";
import { View } from "react-native";
import {
  D,
  expiryRows,
  indiaDate,
  rupees,
  sumCostValue,
  type Batch,
  type ExpiryGroup,
  type ExpiryRow,
} from "@counterwell/core";
import { useSession, uid } from "./session";
import {
  Amount,
  Badge,
  Button,
  Empty,
  Field,
  ListRow,
  Row,
  Section,
  Sheet,
  Stamp,
  Txt,
  useWord,
  palette,
} from "./ui";
import { Page, useRun } from "./screens";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const groups: ExpiryGroup[] = ["expired", "within30", "within90"];
const title = (g: ExpiryGroup, hi: boolean) =>
  g === "expired"
    ? hi
      ? "एक्सपायर हो चुके"
      : "Expired"
    : g === "within30"
      ? hi
        ? "30 दिन के अंदर"
        : "Within 30 days"
      : hi
        ? "90 दिन के अंदर"
        : "Within 90 days";
const left = (days: number, hi: boolean) =>
  days < 0
    ? hi
      ? `${-days} दिन पहले एक्सपायर`
      : `Expired ${-days} ${days === -1 ? "day" : "days"} ago`
    : days === 0
      ? hi
        ? "आज आख़िरी दिन"
        : "Last day to sell is today"
      : hi
        ? `${days} दिन बाकी`
        : `${days} ${days === 1 ? "day" : "days"} left`;

type Action = {
  batch: Batch;
  name: string;
  /** "quarantine" takes sellable stock off the shelf; "dispose" clears what was set aside. */
  mode: "quarantine" | "dispose";
  quantity: string;
  unit: string;
  expired: boolean;
  daysLeft: number;
};

/** Owner list of batches that have expired or will soon, with the next step for each. */
export function ExpiryScreen({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi",
    run = useRun(),
    w = useWord();
  const [action, setAction] = useState<Action | null>(null),
    [reason, setReason] = useState("");
  const today = indiaDate(new Date().toISOString());
  const rows = useMemo(() => expiryRows(state, today), [state, today]);
  // Expired stock already set aside, waiting to be disposed of.
  const setAside = useMemo(
    () =>
      Object.values(state.batches)
        .filter(
          (b) =>
            D(b.quarantined).gt(0) &&
            b.expiry < today &&
            state.products[b.productId],
        )
        .sort((a, b) => a.expiry.localeCompare(b.expiry)),
    [state.batches, state.products, today],
  );
  const expired = rows.filter((r) => r.group === "expired");
  function open(r: ExpiryRow) {
    setReason(
      r.group === "expired"
        ? "Expired; taken off the shelf"
        : "Expiring soon; taken off the shelf",
    );
    setAction({
      batch: r.batch,
      name: `${r.product.name} ${r.product.strength}`,
      mode: "quarantine",
      quantity: r.quantity,
      unit: r.product.baseUnit,
      expired: r.group === "expired",
      daysLeft: r.daysLeft,
    });
  }
  function dispose(b: Batch) {
    const p = state.products[b.productId];
    setReason("Expired; disposed");
    setAction({
      batch: b,
      name: `${p.name} ${p.strength}`,
      mode: "dispose",
      quantity: b.quarantined,
      unit: p.baseUnit,
      expired: true,
      daysLeft: -1,
    });
  }
  const valid =
    !!action &&
    reason.trim().length >= 3 &&
    D(action.quantity || "0").gt(0) &&
    D(action.quantity || "0").lte(
      action.mode === "quarantine"
        ? action.batch.quantity
        : action.batch.quarantined,
    );
  const batchLine = (code: string, expiry: string) => (
    <Row style={{ gap: 6, flexWrap: "wrap" }}>
      <Txt size={13} num weight={600} color={palette.ink2}>
        {code}
      </Txt>
      <Txt size={13} num color={palette.ink3}>
        {shortDate(expiry)}
      </Txt>
    </Row>
  );
  return (
    <Page
      title={hi ? "एक्सपायरी" : "Expiry"}
      subtitle={
        hi
          ? "जो माल एक्सपायर हो चुका है या 90 दिन में होगा।"
          : "Stock that has expired or will within 90 days."
      }
      action={
        <Button small secondary onPress={() => navigate("inventory")}>
          {hi ? "स्टॉक" : "Stock"}
        </Button>
      }
    >
      {rows.length === 0 && setAside.length === 0 ? (
        <Empty
          icon="checkmark-circle-outline"
          title={hi ? "कुछ भी एक्सपायर नहीं हो रहा" : "Nothing is expiring"}
          detail={
            hi
              ? "अगले 90 दिन में कोई बैच एक्सपायर नहीं होगा।"
              : "No batch with stock expires in the next 90 days."
          }
        />
      ) : (
        <>
          {expired.length > 0 && (
            <View style={{ marginBottom: 32, gap: 6 }}>
              <Txt size={14} color={palette.ink2}>
                {hi
                  ? "एक्सपायर माल, लागत पर"
                  : "Expired stock still counted at cost"}
              </Txt>
              <Amount
                value={rupees(sumCostValue(expired))}
                size={40}
                weight={700}
                color={palette.declined}
              />
              <Txt size={14} color={palette.ink2}>
                {hi
                  ? "इसे बिक्री से हटाएँ। यह बेचा नहीं जा सकता और स्टॉक की कीमत बढ़ाता है।"
                  : "It cannot be sold and it inflates your stock value. Take it off the shelf."}
              </Txt>
            </View>
          )}
          {groups.map((g) => {
            const list = rows.filter((r) => r.group === g);
            if (!list.length) return null;
            const ink = g === "expired" ? palette.declined : palette.waiting;
            return (
              <Section
                key={g}
                title={`${title(g, hi)} · ${list.length}`}
                action={
                  <Txt size={13} num color={palette.ink2}>
                    {hi ? "लागत" : "At cost"} {rupees(sumCostValue(list))}
                  </Txt>
                }
              >
                {list.map((r) => (
                  <ListRow
                    key={r.batch.id}
                    onPress={() => open(r)}
                    chevron={false}
                    title={
                      <Txt weight={600}>
                        {r.product.name}{" "}
                        <Txt color={palette.ink3}>{r.product.strength}</Txt>
                      </Txt>
                    }
                    detail={
                      <View style={{ gap: 4 }}>
                        {batchLine(r.batch.code, r.batch.expiry)}
                        <Row style={{ gap: 8, flexWrap: "wrap" }}>
                          {g === "expired" && (
                            <Badge tone="declined">Expired</Badge>
                          )}
                          <Txt size={13} weight={600} color={ink}>
                            {left(r.daysLeft, hi)}
                          </Txt>
                        </Row>
                      </View>
                    }
                    trailing={
                      <View style={{ alignItems: "flex-end", gap: 2 }}>
                        <Txt size={14} num weight={600}>
                          {r.quantity} {r.product.baseUnit}
                        </Txt>
                        {r.costValuePaise === undefined ? (
                          <Txt size={13} color={palette.ink3}>
                            {hi ? "लागत दर्ज नहीं" : "No cost recorded"}
                          </Txt>
                        ) : (
                          <Txt size={14} num weight={500}>
                            {`${hi ? "लागत" : "Cost"} ${rupees(r.costValuePaise)}`}
                          </Txt>
                        )}
                        <Txt size={13} num color={palette.ink3}>
                          MRP {rupees(r.mrpValuePaise)}
                        </Txt>
                      </View>
                    }
                  />
                ))}
              </Section>
            );
          })}
          {setAside.length > 0 && (
            <Section
              title={
                hi
                  ? "अलग रखा हुआ, निपटारा बाकी"
                  : "Set aside, waiting to be disposed"
              }
            >
              {setAside.map((b) => {
                const p = state.products[b.productId];
                return (
                  <ListRow
                    key={b.id}
                    onPress={() => dispose(b)}
                    chevron={false}
                    title={
                      <Txt weight={600}>
                        {p.name} <Txt color={palette.ink3}>{p.strength}</Txt>
                      </Txt>
                    }
                    detail={batchLine(b.code, b.expiry)}
                    trailing={
                      <Badge tone="waiting">
                        {b.quarantined} {p.baseUnit}
                      </Badge>
                    }
                  />
                );
              })}
            </Section>
          )}
        </>
      )}
      <Sheet
        visible={!!action}
        title={
          action?.mode === "dispose"
            ? "Dispose of set-aside stock"
            : "Take off the shelf"
        }
        onClose={() => setAction(null)}
      >
        {action && (
          <>
            <Txt weight={600}>{action.name}</Txt>
            <Txt
              size={14}
              num
              color={palette.ink2}
              style={{ marginBottom: 14 }}
            >
              {hi ? "बैच" : "Batch"}{" "}
              <Txt size={14} num weight={600}>
                {action.batch.code}
              </Txt>{" "}
              · {shortDate(action.batch.expiry)}
              {action.mode === "quarantine"
                ? ` · ${left(action.daysLeft, hi)}`
                : ""}
            </Txt>
            <Txt style={{ marginBottom: 16 }}>
              {action.mode === "quarantine"
                ? action.expired
                  ? "This moves the stock out of what can be sold and sets it aside. It cannot be sold from here on. You can dispose of it afterwards."
                  : "This batch has not expired yet. Moving it sets it aside now and it cannot be sold. Do this only if you are pulling it early."
                : "This records the set-aside stock as disposed of and removes it from your stock value. It cannot be undone."}
            </Txt>
            <Field
              label={`${w(action.mode === "quarantine" ? "Quantity to set aside" : "Quantity disposed")} (${action.unit})`}
              value={action.quantity}
              onChange={(quantity: string) =>
                setAction({ ...action, quantity })
              }
              number
            />
            <Field label="Reason" value={reason} onChange={setReason} />
            <View style={{ marginTop: 8 }} />
            <Button
              variant={action.mode === "dispose" ? "danger" : "primary"}
              disabled={!valid}
              onPress={() =>
                void run(async () => {
                  // The owner asks, approves and executes in one step; each leaves its own record.
                  const approvalId = uid(),
                    quantity = D(action.quantity).toFixed();
                  await s.command({
                    type: "approval.request",
                    approvalId,
                    kind: "stock",
                    payload: {
                      batchId: action.batch.id,
                      quantity:
                        action.mode === "dispose" ? `-${quantity}` : quantity,
                      kind:
                        action.mode === "dispose"
                          ? "quarantine_disposal"
                          : "quarantine",
                      reason: reason.trim(),
                    },
                    reason: reason.trim(),
                  });
                  try {
                    await s.command({
                      type: "approval.decide",
                      approvalId,
                      approve: true,
                    });
                    await s.command({ type: "stock.execute", approvalId });
                  } catch {
                    // The request is already saved, so the change can be finished from Reviews.
                    setAction(null);
                    throw new Error(
                      "The stock change is waiting in Reviews. Ask the owner to approve it there.",
                    );
                  }
                  setAction(null);
                })
              }
            >
              {action.mode === "quarantine"
                ? "Take off the shelf"
                : "Record disposal"}
            </Button>
          </>
        )}
      </Sheet>
    </Page>
  );
}
