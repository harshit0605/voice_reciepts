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
  colors,
  styles,
  useSheet,
  useWord,
} from "./ui";
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
  return (
    <View>
      <Txt size={18} bold>
        {product.name} {product.strength}
      </Txt>
      <Txt muted size={12} style={{ marginTop: 4, marginBottom: 12 }}>
        {w(product.form)} ·{" "}
        {Object.entries(product.units)
          .map(([u, n]) => (n === "1" ? w(u) : `${w(u)} = ${n}`))
          .join(", ")}{" "}
        · GST {product.taxBps / 100}%
      </Txt>
      {existing.length > 0 && (
        <View style={{ marginBottom: 12, gap: 4 }}>
          <Txt size={12} bold>
            {hi ? "पहले से स्टॉक में" : "Already in stock"}
          </Txt>
          {existing.map((b) => (
            <Txt key={b.id} size={12} muted>
              {b.code} · {b.expiry} ·{" "}
              {amountOf(b.quantity, product.baseUnit, w)}
            </Txt>
          ))}
        </View>
      )}
      <Field label="Batch number on the pack" value={code} onChange={setCode} />
      <Field
        label="Expiry as printed (for example 04/27)"
        value={expiry}
        onChange={setExpiry}
      />
      <Field
        label="Counted quantity"
        value={quantity}
        onChange={setQuantity}
        number
      />
      <Row style={{ flexWrap: "wrap", marginBottom: 12 }}>
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
      <Row style={{ flexWrap: "wrap", marginBottom: 12 }}>
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
            padding: 12,
            backgroundColor: colors.tint,
            borderRadius: 8,
            gap: 4,
            marginBottom: 12,
          }}
        >
          <Txt bold>
            {`${amountOf(preview.batch.quantity, product.baseUnit, w)} · ${rupees(preview.batch.pricePaise)} / ${w(product.baseUnit)}`}
          </Txt>
          <Txt size={12} muted>
            {`${hi ? "एक्सपायरी" : "Expires"} ${shortDate(preview.batch.expiry)}`}
          </Txt>
          {preview.notes.map((n) => (
            <Txt key={n} size={12} style={{ color: colors.amber }}>
              {n}
            </Txt>
          ))}
        </View>
      )}
      {!!error && (
        <Txt style={{ color: colors.red, marginBottom: 12 }}>{error}</Txt>
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
      <Txt muted>
        {hi
          ? `${counted.toLocaleString("en-IN")} / ${active.length.toLocaleString("en-IN")} दवाओं का स्टॉक गिना गया`
          : `${counted.toLocaleString("en-IN")} of ${active.length.toLocaleString("en-IN")} medicines have counted stock`}
      </Txt>
      {saved && (
        <View
          style={{
            padding: 12,
            backgroundColor: colors.tint,
            borderRadius: 8,
            gap: 8,
          }}
        >
          <Txt>{`${hi ? "सेव हुआ:" : "Saved:"} ${saved.message}`}</Txt>
          <Button secondary small onPress={() => choose(saved.product)}>
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
        <Button
          secondary
          small
          icon="barcode-outline"
          onPress={() =>
            void scanner.open().then((r) => {
              if (!r.opened) setNotice(CAMERA_OFF);
            })
          }
        >
          {hi ? "स्कैन" : "Scan"}
        </Button>
      </Row>
      <Row>
        <Chip active={uncounted} onPress={() => setUncounted(true)}>
          {hi ? "अभी नहीं गिने" : "Not counted yet"}
        </Chip>
        <Chip active={!uncounted} onPress={() => setUncounted(false)}>
          {hi ? "सभी" : "All"}
        </Chip>
      </Row>
      {!!notice && <Txt style={{ color: colors.amber }}>{notice}</Txt>}
      {list.slice(0, SHOWN).map((p) => {
        const batches = byProduct.get(p.id) ?? [];
        const stock = batches.reduce((n, b) => n + Number(b.quantity), 0);
        return (
          <Pressable
            key={p.id}
            onPress={() => choose(p)}
            style={styles.listRow}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Txt bold>
                  {p.name} {p.strength}
                </Txt>
                <Txt size={11} muted style={{ marginTop: 4 }}>
                  {p.generic ? `${p.generic} · ` : ""}
                  {w(p.form)}
                </Txt>
              </View>
              <Badge warning={!batches.length}>
                {batches.length
                  ? amountOf(stock, p.baseUnit, w)
                  : hi
                    ? "गिनें"
                    : "Count"}
              </Badge>
            </Row>
          </Pressable>
        );
      })}
      {!list.length && (
        <Txt muted>
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
        <Txt size={11} muted>
          {hi
            ? `${list.length.toLocaleString("en-IN")} में से ${SHOWN} दिख रहे हैं · खोजकर ढूँढें`
            : `Showing ${SHOWN} of ${list.length.toLocaleString("en-IN")} · search to find others`}
        </Txt>
      )}
      {scanner.sheet}
    </View>
  );
}
