import React, { useMemo, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { useSession, uid } from "./session";
import {
  Txt,
  Button,
  Field,
  Row,
  Chip,
  Badge,
  ListRow,
  Section,
  Icon,
  palette,
  useSheet,
  useWord,
} from "./ui";
import { Notice } from "./product-form";
import { useBarcodeScanner, CAMERA_OFF } from "./scanner";
import { amountOf } from "./payments";
import {
  openingCount,
  packUnit,
  matchScan,
  matchesSearch,
  bySearch,
  groupBatches,
  indiaDate,
  rupees,
  type Product,
} from "@counterwell/core";
const SHOWN = 20;
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
/** "2027-04-30" → "04/27", the way packs print it. */
const printed = (iso?: string) =>
  iso ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "";
function Stepper({
  icon,
  label,
  onPress,
}: {
  icon: "add" | "remove";
  label: string;
  onPress: () => void;
}) {
  const w = useWord();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={w(label)}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: 10,
        backgroundColor: pressed ? palette.rule : palette.blueTint,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Icon name={icon} size={22} color={palette.blue} />
    </Pressable>
  );
}
/** One batch on the shelf: batch number, expiry, count and prices, saved as a verified opening count. */
export function CountForm({
  product,
  prefill,
  onSaved,
}: {
  product: Product;
  prefill?: { code?: string; expiry?: string };
  onSaved: (message: string) => void;
}) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi",
    w = useWord();
  const pack = packUnit(product);
  const [code, setCode] = useState(prefill?.code ?? ""),
    [expiry, setExpiry] = useState(printed(prefill?.expiry)),
    [quantity, setQuantity] = useState(""),
    [unit, setUnit] = useState(pack),
    [mrp, setMrp] = useState(""),
    [priceUnit, setPriceUnit] = useState(pack),
    [price, setPrice] = useState(""),
    [cost, setCost] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    saving = useRef(false);
  const today = indiaDate(new Date().toISOString());
  const existing = Object.values(state.batches).filter(
    (b) => b.productId === product.id,
  );
  const input = { code, expiry, quantity, unit, mrp, priceUnit, price, cost };
  let preview: ReturnType<typeof openingCount> | null = null;
  try {
    preview = openingCount(input, product, existing, today, "preview");
  } catch {
    preview = null;
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const { batch } = openingCount(input, product, existing, today, uid());
      await s.command({
        type: "stock.opening",
        batch,
        reason: "Owner verified physical opening count",
      });
      onSaved(
        `${product.name} ${product.strength} · ${batch.code} · ${amountOf(batch.quantity, product.baseUnit, w)}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const units = Object.keys(product.units);
  const step = (delta: number) =>
    setQuantity(String(Math.max(0, (Number(quantity) || 0) + delta)));
  return (
    <View>
      <Txt size={22} weight={700}>
        {product.name} {product.strength}
      </Txt>
      <Txt size={14} color={palette.ink2} style={{ marginTop: 4, marginBottom: 16 }}>
        {w(product.form)} ·{" "}
        {Object.entries(product.units)
          .map(([u, n]) => (n === "1" ? w(u) : `${w(u)} = ${n}`))
          .join(", ")}{" "}
        · GST {product.taxBps / 100}%
      </Txt>
      {existing.length > 0 && (
        <View style={{ marginBottom: -8 }}>
          <Section title={hi ? "पहले से स्टॉक में" : "Already in stock"}>
            {existing.map((b) => (
              <Row
                key={b.id}
                style={{
                  justifyContent: "space-between",
                  minHeight: 48,
                  borderBottomWidth: 1,
                  borderColor: palette.rule,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Txt size={14} num weight={600}>
                    {b.code}
                  </Txt>
                  <Txt size={13} num color={palette.ink3}>
                    {b.expiry}
                  </Txt>
                </View>
                <Txt size={14} num weight={500}>
                  {amountOf(b.quantity, product.baseUnit, w)}
                </Txt>
              </Row>
            ))}
          </Section>
        </View>
      )}
      <Field
        label="Batch number on the pack"
        value={code}
        onChange={setCode}
        identifier
      />
      <Field
        label="Expiry as printed (for example 04/27)"
        value={expiry}
        onChange={setExpiry}
      />
      <Txt size={14} weight={500} color={palette.ink2} style={{ marginBottom: 6 }}>
        Counted quantity
      </Txt>
      <Row style={{ marginBottom: 12, alignItems: "flex-start", gap: 8 }}>
        <Stepper icon="remove" label="Decrease" onPress={() => step(-1)} />
        <View style={{ flex: 1 }}>
          <Field
            placeholder="Counted quantity"
            value={quantity}
            onChange={setQuantity}
            number
          />
        </View>
        <Stepper icon="add" label="Increase" onPress={() => step(1)} />
      </Row>
      <Row style={{ flexWrap: "wrap", marginBottom: 16 }}>
        {units.map((u) => (
          <Chip key={u} active={unit === u} onPress={() => setUnit(u)}>
            {w(u)}
          </Chip>
        ))}
      </Row>
      <Field
        label="MRP printed on the pack (₹)"
        value={mrp}
        onChange={setMrp}
        number
      />
      <Row style={{ flexWrap: "wrap", marginBottom: 16 }}>
        {units.map((u) => (
          <Chip
            key={u}
            active={priceUnit === u}
            onPress={() => setPriceUnit(u)}
          >
            {hi ? `प्रति ${w(u)}` : `per ${u}`}
          </Chip>
        ))}
      </Row>
      <Field
        label="Selling price (₹), if below MRP"
        value={price}
        onChange={setPrice}
        number
      />
      <Field
        label="Purchase cost (₹), if known"
        value={cost}
        onChange={setCost}
        number
      />
      {preview && (
        <View
          style={{
            paddingVertical: 12,
            gap: 4,
            marginBottom: 16,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: palette.rule,
          }}
        >
          <Txt weight={600} num>
            {`${amountOf(preview.batch.quantity, product.baseUnit, w)} · ${rupees(preview.batch.pricePaise)} / ${w(product.baseUnit)}`}
          </Txt>
          <Txt size={14} color={palette.ink2}>
            {`${hi ? "एक्सपायरी" : "Expires"} ${shortDate(preview.batch.expiry)}`}
          </Txt>
          {preview.notes.map((n) => (
            <Txt key={n} size={14} weight={600} color={palette.waiting}>
              {n}
            </Txt>
          ))}
        </View>
      )}
      {!!error && (
        <View style={{ marginBottom: 16 }}>
          <Notice>{error}</Notice>
        </View>
      )}
      <Button disabled={busy} onPress={() => void save()} icon="checkmark">
        {hi ? "शेल्फ़ पर गिना · सेव करें" : "Counted on shelf · Save"}
      </Button>
    </View>
  );
}
/** Count the shelf product by product: find or scan, count, save, next. */
export function StockCount() {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi",
    w = useWord();
  const [query, setQuery] = useState(""),
    [uncounted, setUncounted] = useState(true),
    [product, setProduct] = useState<Product | null>(null),
    [prefill, setPrefill] = useState<{ code?: string; expiry?: string }>(),
    [saved, setSaved] = useState<{ message: string; product: Product } | null>(
      null,
    ),
    [notice, setNotice] = useState("");
  const today = indiaDate(new Date().toISOString());
  const sheet = useSheet();
  const byProduct = useMemo(() => groupBatches(state.batches), [state.batches]);
  const active = Object.values(state.products).filter((p) => p.active);
  const counted = active.filter((p) => byProduct.has(p.id)).length;
  const list = useMemo(
    () =>
      active
        .filter(
          (p) =>
            (!uncounted || !byProduct.has(p.id)) && matchesSearch(p, query),
        )
        .sort(bySearch(query)),
    [state.products, byProduct, query, uncounted],
  );
  function choose(p: Product, fill?: { code?: string; expiry?: string }) {
    setNotice("");
    setSaved(null);
    setPrefill(fill);
    setProduct(p);
    sheet.scrollToTop();
  }
  const scanner = useBarcodeScanner((raw) => {
    const m = matchScan(state, raw, today);
    if (m.products.length === 1) {
      if (m.batch)
        setNotice(
          hi
            ? "यह बैच पहले से स्टॉक में है। गिनती सुधारने के लिए स्टॉक समायोजन करें।"
            : "This batch is already in stock. Use a stock adjustment to correct its count.",
        );
      else choose(m.products[0], { code: m.scan.batch, expiry: m.scan.expiry });
    } else if (m.products.length > 1) {
      setQuery(m.key);
      setNotice(
        "Several products share this barcode. Choose the one you are supplying.",
      );
    } else
      setNotice(
        "No product has this barcode. Search by name, or ask the owner to add the barcode.",
      );
  }, "Scan the pack");
  if (product)
    return (
      <View style={{ gap: 12 }}>
        <Button
          secondary
          small
          icon="arrow-back"
          onPress={() => {
            setProduct(null);
            sheet.scrollToTop();
          }}
        >
          {hi ? "सूची पर वापस" : "Back to list"}
        </Button>
        <CountForm
          key={product.id + (prefill?.code ?? "")}
          product={product}
          prefill={prefill}
          onSaved={(message) => {
            setSaved({ message, product });
            setProduct(null);
            setQuery("");
            sheet.scrollToTop();
          }}
        />
        {scanner.sheet}
      </View>
    );
  return (
    <View style={{ gap: 12 }}>
      <Txt size={14} color={palette.ink2}>
        {hi
          ? `${counted.toLocaleString("en-IN")} / ${active.length.toLocaleString("en-IN")} दवाओं का स्टॉक गिना गया`
          : `${counted.toLocaleString("en-IN")} of ${active.length.toLocaleString("en-IN")} medicines have counted stock`}
      </Txt>
      {saved && (
        <View style={{ gap: 8 }}>
          <Notice tone="paid">{`${hi ? "सेव हुआ:" : "Saved:"} ${saved.message}`}</Notice>
          <Button variant="quiet" small onPress={() => choose(saved.product)}>
            {hi
              ? "इसी दवा का दूसरा बैच गिनें"
              : "Count another batch of this medicine"}
          </Button>
        </View>
      )}
      <Row>
        <View style={{ flex: 1 }}>
          <Field
            value={query}
            onChange={setQuery}
            placeholder="Search medicine, salt or barcode"
          />
        </View>
        <View style={{ marginBottom: 16 }}>
          <Button
            secondary
            icon="barcode-outline"
            onPress={() =>
              void scanner.open().then((r) => {
                if (!r.opened) setNotice(CAMERA_OFF);
              })
            }
          >
            {hi ? "स्कैन" : "Scan"}
          </Button>
        </View>
      </Row>
      <Row>
        <Chip active={uncounted} onPress={() => setUncounted(true)}>
          {hi ? "अभी नहीं गिने" : "Not counted yet"}
        </Chip>
        <Chip active={!uncounted} onPress={() => setUncounted(false)}>
          {hi ? "सभी" : "All"}
        </Chip>
      </Row>
      {!!notice && <Notice tone="waiting">{notice}</Notice>}
      <View>
        {list.slice(0, SHOWN).map((p) => {
          const batches = byProduct.get(p.id) ?? [];
          const stock = batches.reduce((n, b) => n + Number(b.quantity), 0);
          return (
            <ListRow
              key={p.id}
              onPress={() => choose(p)}
              chevron={false}
              title={`${p.name} ${p.strength}`}
              detail={
                <Txt size={13} color={palette.ink3}>
                  {p.generic ? `${p.generic} · ` : ""}
                  {w(p.form)}
                </Txt>
              }
              trailing={
                <Badge tone={batches.length ? "neutral" : "waiting"}>
                  {batches.length
                    ? amountOf(stock, p.baseUnit, w)
                    : hi
                      ? "गिनें"
                      : "Count"}
                </Badge>
              }
            />
          );
        })}
      </View>
      {!list.length && (
        <Txt color={palette.ink3}>
          {uncounted && !query
            ? hi
              ? "सभी दवाओं का स्टॉक गिना जा चुका है।"
              : "Every medicine has counted stock."
            : hi
              ? "कोई दवा नहीं मिली।"
              : "No medicine found."}
        </Txt>
      )}
      {list.length > SHOWN && (
        <Txt size={13} color={palette.ink3}>
          {hi
            ? `${list.length.toLocaleString("en-IN")} में से ${SHOWN} दिख रहे हैं · खोजकर ढूँढें`
            : `Showing ${SHOWN} of ${list.length.toLocaleString("en-IN")} · search to find others`}
        </Txt>
      )}
      {scanner.sheet}
    </View>
  );
}
