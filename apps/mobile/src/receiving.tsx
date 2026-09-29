import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, Platform, ActivityIndicator } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useSession, uid } from "./session";
import * as storage from "./storage";
import { API_URL, cookieHeaders } from "./auth";
import { appendFile } from "./upload";
import { Txt, Button, Field, Row, Chip, Badge, colors, styles } from "./ui";
import { ProductForm } from "./product-form";
import { BillCamera, type BillFile } from "./bill-camera";
import {
  catalogueSignature,
  signedPaise,
  blankReceivingLine,
  importInvoiceDraft,
  receivingLine,
  buildPurchase,
  productSuggestions,
  inputPaise,
  D,
  rupees,
  indiaDate,
  type ReceivingDraft,
  type ReceivingLine,
  type Product,
  productFromInvoiceLine,
} from "@counterwell/core";

function fresh(): ReceivingDraft {
  return {
    id: uid(),
    supplierId: "",
    supplierName: "",
    supplierGstin: "",
    number: "",
    date: indiaDate(new Date().toISOString()),
    total: "",
    lines: [],
    warnings: [],
  };
}
export function PurchaseForm({ onDone }: { onDone: () => void }) {
  const s = useSession(),
    state = s.state!;
  const t = (en: string, hi: string) => (s.language === "hi" ? hi : en);
  const key = `receiving:${s.demo ? "demo:" : ""}${state.businessId}:${s.identity!.actor.id}`;
  const [failedJob, setFailedJob] = useState<string>();
  const [draft, setDraft] = useState<ReceivingDraft>(fresh),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false),
    [error, setError] = useState(""),
    [jobs, setJobs] = useState<any[]>([]),
    [jobStatus, setJobStatus] = useState(""),
    [showNewSupplier, setShowNewSupplier] = useState(false),
    [searchSupplier, setSearchSupplier] = useState(""),
    [expanded, setExpanded] = useState<string | null>(null),
    [saved, setSaved] = useState(false),
    [discard, setDiscard] = useState(false),
    [allowance, setAllowance] = useState("");
  const writes = useRef(Promise.resolve()),
    posted = useRef(false),
    request = useRef(s.request),
    mounted = useRef(true);
  request.current = s.request;
  useEffect(() => {
    mounted.current = true;
    let live = true;
    storage
      .get<ReceivingDraft>(key)
      .then((v) => {
        if (live) {
          if (v && !state.purchases[v.id]) setDraft(v);
          setLoaded(true);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [key]);
  useEffect(() => {
    if (!loaded || posted.current) return;
    setSaved(false);
    writes.current = writes.current
      .catch(() => {})
      .then(() =>
        storage.set(key, { ...draft, savedAt: new Date().toISOString() }),
      );
    void writes.current
      .then(() => {
        if (mounted.current) setSaved(true);
      })
      .catch((e) => setError(e.message));
  }, [draft, loaded, key]);
  useEffect(() => {
    if (s.demo) return;
    let live = true;
    void request
      .current("/extractions")
      .then((r) => {
        if (live) {
          setJobs(r.jobs);
          setAllowance(
            `${r.usage.find((u: any) => u.kind === "invoice")?.jobs ?? 0} / ${r.limits.invoice}`,
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [s.demo, draft.documentId]);
  function change(patch: Partial<ReceivingDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setError("");
  }
  function changeLine(id: string, patch: Partial<ReceivingLine>) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) =>
        l.id === id
          ? { ...l, ...patch, confirmed: patch.confirmed ?? false }
          : l,
      ),
    }));
    setError("");
  }
  useEffect(() => {
    if (!draft.jobId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await request.current(`/extractions/${draft.jobId}`);
        if (!live) return;
        setJobStatus(result.status);
        if (result.status === "completed") {
          setFailedJob(undefined);
          const imported = importInvoiceDraft(result.output.draft, uid);
          setDraft((d) => ({
            ...d,
            ...imported,
            jobId: undefined,
            documentId: result.id,
            supplierId: "",
          }));
          setExpanded(imported.lines[0]?.id ?? null);
          if (!imported.lines.length)
            setError(
              s.language === "hi"
                ? "इस बिल से कोई दवा नहीं पढ़ी जा सकी। बिल को सीधा और अच्छी रोशनी में फिर से खींचें, या हाथ से भरें।"
                : "No medicines could be read from this bill. Photograph it again flat and in good light, or enter it manually.",
            );
        } else if (result.status === "failed") {
          setFailedJob(result.id);
          setError(result.error ?? "Extraction failed; continue manually.");
          setDraft((d) => ({ ...d, jobId: undefined, documentId: undefined }));
        } else timer = setTimeout(poll, 2000);
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          timer = setTimeout(poll, 10000);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft.jobId]);
  async function upload() {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true,
    });
    if (pick.canceled) return;
    const file = pick.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) {
      setError(
        t("Choose a file smaller than 10 MB", "10 MB से छोटी फ़ाइल चुनें"),
      );
      return;
    }
    await send({
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? "application/pdf",
    });
  }
  async function send(file: BillFile) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("kind", "invoice");
      await appendFile(form, "file", file.uri, file.name, file.type);
      const job = await s.request("/extractions", {
        method: "POST",
        body: form,
      });
      change({ jobId: job.id, documentId: job.id });
      setJobStatus(job.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function source() {
    setBusy(true);
    setError("");
    try {
      const headers = {
        ...(await cookieHeaders()),
        "X-Business-Id": state.businessId,
      };
      const response = await fetch(
        `${API_URL}/api/v1/documents/${draft.documentId}`,
        { headers, credentials: "include" },
      );
      if (!response.ok) throw new Error("Source document is unavailable");
      const blob = await response.blob();
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `supplier-invoice.${blob.type === "application/pdf" ? "pdf" : "image"}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const file = new FileSystem.File(
          FileSystem.Paths.cache,
          `invoice-${uid()}.${blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : "jpg"}`,
        );
        file.write(new Uint8Array(await blob.arrayBuffer()));
        try {
          await Sharing.shareAsync(file.uri, { mimeType: blob.type });
        } finally {
          if (file.exists) file.delete();
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rowResults = draft.lines.map((l) => {
    try {
      return { line: receivingLine(l, state.products[l.productId]), error: "" };
    } catch (e) {
      return { line: null, error: (e as Error).message };
    }
  });
  let operation: ReturnType<typeof buildPurchase> | undefined,
    validation = "";
  try {
    operation = buildPurchase(draft, state);
  } catch (e) {
    validation = (e as Error).message;
  }
  let sum = 0,
    difference: number | null = null;
  try {
    sum = draft.lines.reduce((v, l) => v + inputPaise(l.total), 0);
    difference =
      inputPaise(draft.total) - sum - signedPaise(draft.adjustment || "0");
  } catch {}
  const confirmed = draft.lines.filter(
    (l) =>
      l.confirmed &&
      state.products[l.productId] &&
      l.catalogueSignature === catalogueSignature(state.products[l.productId]),
  ).length;
  const supplierMatches = Object.values(state.suppliers)
    .filter((x) =>
      `${x.name} ${x.gstin}`
        .toLowerCase()
        .includes(searchSupplier.toLowerCase()),
    )
    .slice(0, 8);
  if (!loaded) return <ActivityIndicator color={colors.accent} />;
  return (
    <View style={{ gap: 20 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Badge>
          {t(
            "1 · Invoice → 2 · Items → 3 · Post",
            "1 · बिल → 2 · सामान → 3 · स्टॉक जोड़ें",
          )}
        </Badge>
        <Txt size={10} muted>
          {saved
            ? t("Draft saved", "ड्राफ्ट सहेजा गया")
            : t("Saving…", "सहेज रहे हैं…")}
        </Txt>
      </Row>
      {error !== "" && (
        <View
          accessibilityRole="alert"
          style={{
            padding: 14,
            backgroundColor: colors.amberBg,
            borderRadius: 8,
          }}
        >
          <Txt style={{ color: colors.red }}>{error}</Txt>
        </View>
      )}
      {failedJob && (
        <Button
          secondary
          disabled={busy || draft.lines.length > 0}
          onPress={() =>
            void (async () => {
              setBusy(true);
              try {
                await s.request(`/extractions/${failedJob}/retry`, {
                  method: "POST",
                });
                change({ jobId: failedJob });
                setFailedJob(undefined);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {t("Retry failed extraction", "असफल बिल फिर से पढ़ें")}
        </Button>
      )}
      {draft.jobId ? (
        <View style={{ gap: 12 }}>
          <ActivityIndicator color={colors.accent} />
          <Txt bold>{t("Reading your invoice…", "आपका बिल पढ़ रहे हैं…")}</Txt>
          <Txt muted>
            {t(
              "You can close this screen and return. The saved job will resume without another upload.",
              "आप यह स्क्रीन बंद करके वापस आ सकते हैं। दोबारा अपलोड की ज़रूरत नहीं है।",
            )}
          </Txt>
          <Txt size={11} muted>
            {jobStatus}
          </Txt>
          <Button
            secondary
            onPress={() => change({ jobId: undefined, documentId: undefined })}
          >
            {t("Continue manually", "हाथ से भरें")}
          </Button>
        </View>
      ) : null}
      {!draft.lines.length && !draft.jobId && (
        <View style={{ gap: 12 }}>
          <Txt size={22} bold>
            {t("Receive supplier stock", "सप्लायर से स्टॉक लें")}
          </Txt>
          <Txt muted>
            {t(
              "Upload a bill or enter it manually. Stock changes only after your final review.",
              "बिल अपलोड करें या हाथ से भरें। अंतिम जाँच के बाद ही स्टॉक बढ़ेगा।",
            )}
          </Txt>
          {!s.demo && Platform.OS !== "web" && (
            <Button
              icon="camera-outline"
              disabled={busy}
              onPress={() => setCamera(true)}
            >
              {t("Photograph the bill", "बिल की फ़ोटो लें")}
            </Button>
          )}
          {!s.demo && (
            <Button
              secondary
              icon="document-outline"
              disabled={busy}
              onPress={() => void upload()}
            >
              {t("Choose a photo or PDF", "फ़ोटो या PDF चुनें")}
            </Button>
          )}
          <BillCamera
            visible={camera}
            close={() => setCamera(false)}
            onReady={(file) => void send(file)}
            hi={s.language === "hi"}
          />
          {s.demo && (
            <Button
              secondary
              onPress={() => {
                const imported = importInvoiceDraft(
                  {
                    supplierName: "Demo distributor",
                    supplierGstin: null,
                    invoiceNumber: `DEMO-${Date.now().toString().slice(-6)}`,
                    invoiceDate: indiaDate(new Date().toISOString()),
                    totalPaise: 20000,
                    warnings: ["Synthetic example — no AI call was made."],
                    lines: [
                      {
                        name: "Dolo",
                        strength: "650 mg",
                        batchCode: "DEMO-RECEIVED",
                        expiry: "2028-12-31",
                        quantity: "10",
                        bonusQuantity: "1",
                        unit: "strip",
                        packSize: "10 tablets / strip",
                        mrpPaise: 3500,
                        lineTotalPaise: 20000,
                        taxBps: 1200,
                      },
                    ],
                  },
                  uid,
                );
                change(imported);
                setExpanded(imported.lines[0].id);
              }}
            >
              {t("Load a sample invoice", "उदाहरण बिल भरें")}
            </Button>
          )}
          {!!allowance && (
            <Txt size={11} muted>
              {t("Invoice uploads this month: ", "इस महीने बिल अपलोड: ")}
              {allowance}
            </Txt>
          )}
          {jobs
            .filter(
              (j) =>
                !Object.values(state.purchases).some(
                  (p) => p.documentId === j.id,
                ),
            )
            .slice(0, 5)
            .map((j) => (
              <Pressable
                key={j.id}
                onPress={() => change({ jobId: j.id, documentId: j.id })}
                style={styles.listRow}
              >
                <Txt bold>{j.name}</Txt>
                <Txt muted size={12}>
                  {j.status} · {t("Resume saved upload", "सहेजा अपलोड खोलें")}
                </Txt>
              </Pressable>
            ))}
        </View>
      )}
      {draft.documentId && !draft.jobId && !s.demo && (
        <Button secondary small disabled={busy} onPress={() => void source()}>
          {t("Open original invoice", "मूल बिल खोलें")}
        </Button>
      )}
      {draft.warnings.map((w, i) => (
        <Txt key={i} size={12} style={{ color: colors.amber }}>
          {w}
        </Txt>
      ))}
      {!draft.jobId && (
        <>
          <View style={{ gap: 8 }}>
            <Txt size={18} bold>
              {t("Invoice details", "बिल का विवरण")}
            </Txt>
            {!!draft.supplierName && (
              <Txt size={12} muted>
                {t("On the document: ", "बिल पर: ")}
                {draft.supplierName} {draft.supplierGstin}
              </Txt>
            )}
            <Field
              label={t("Find supplier", "सप्लायर खोजें")}
              value={searchSupplier}
              onChange={setSearchSupplier}
            />
            <Row style={{ flexWrap: "wrap" }}>
              {supplierMatches.map((x) => (
                <Chip
                  key={x.id}
                  active={draft.supplierId === x.id}
                  onPress={() => change({ supplierId: x.id })}
                >
                  {x.name}
                </Chip>
              ))}
            </Row>
            <Button
              secondary
              small
              onPress={() => setShowNewSupplier(!showNewSupplier)}
            >
              {t("Add a supplier", "नया सप्लायर जोड़ें")}
            </Button>
            {showNewSupplier && (
              <View>
                <Field
                  label={t("Supplier name", "सप्लायर का नाम")}
                  value={draft.supplierName}
                  onChange={(supplierName) => change({ supplierName })}
                />
                <Field
                  label="GSTIN"
                  value={draft.supplierGstin}
                  onChange={(supplierGstin) =>
                    change({ supplierGstin: supplierGstin.toUpperCase() })
                  }
                />
                <Button
                  disabled={busy || !draft.supplierName.trim()}
                  onPress={() =>
                    void (async () => {
                      setBusy(true);
                      try {
                        const id = uid();
                        await s.command({
                          type: "supplier.save",
                          supplier: {
                            id,
                            name: draft.supplierName.trim(),
                            gstin: draft.supplierGstin.trim(),
                            phone: "",
                          },
                        });
                        change({ supplierId: id });
                        setShowNewSupplier(false);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    })()
                  }
                >
                  {t("Save supplier", "सप्लायर सहेजें")}
                </Button>
              </View>
            )}
            <Field
              label={t("Invoice number", "बिल नंबर")}
              value={draft.number}
              onChange={(number) => change({ number })}
            />
            <Field
              label={t(
                "Invoice date (YYYY-MM-DD)",
                "बिल की तारीख (YYYY-MM-DD)",
              )}
              value={draft.date}
              onChange={(date) => change({ date })}
            />
            <Field
              label={t("Invoice total (₹)", "बिल का कुल (₹)")}
              value={draft.total}
              onChange={(total) => change({ total })}
              number
            />
          </View>
          <View>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt size={18} bold>
                {t("Received items", "मिला हुआ सामान")}
              </Txt>
              <Badge warning={confirmed !== draft.lines.length}>
                {confirmed} / {draft.lines.length} {t("reviewed", "जाँचे गए")}
              </Badge>
            </Row>
            {draft.lines.map((line, i) => (
              <ReceivingItem
                key={line.id}
                line={line}
                products={Object.values(state.products)}
                expanded={expanded === line.id}
                toggle={() =>
                  setExpanded(expanded === line.id ? null : line.id)
                }
                error={rowResults[i].error}
                result={rowResults[i].line}
                change={(patch) => changeLine(line.id, patch)}
                remove={() =>
                  change({ lines: draft.lines.filter((l) => l.id !== line.id) })
                }
              />
            ))}
            <Button
              secondary
              icon="add"
              onPress={() => {
                const line = blankReceivingLine(uid(), uid());
                change({ lines: [...draft.lines, line] });
                setExpanded(line.id);
              }}
            >
              {t("Add received item", "मिला सामान जोड़ें")}
            </Button>
          </View>
          <View
            style={{
              borderTopWidth: 1,
              borderColor: colors.line,
              paddingTop: 20,
              gap: 12,
            }}
          >
            <Txt size={18} bold>
              {t("Check totals", "कुल जाँचें")}
            </Txt>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt muted>{t("Items including tax", "टैक्स सहित सामान")}</Txt>
              <Txt bold>{rupees(sum)}</Txt>
            </Row>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt muted>{t("Difference from invoice", "बिल से अंतर")}</Txt>
              <Txt
                bold
                style={{ color: difference === 0 ? colors.accent : colors.red }}
              >
                {difference === null ? "—" : rupees(difference)}
              </Txt>
            </Row>
            <Field
              number
              label={t(
                "Freight / round-off / discount adjustment (₹)",
                "भाड़ा / राउंड-ऑफ़ / छूट समायोजन (₹)",
              )}
              value={draft.adjustment ?? "0"}
              onChange={(adjustment) => change({ adjustment })}
            />
            {!!draft.adjustment && draft.adjustment !== "0" && (
              <Field
                label={t("Adjustment reason", "समायोजन का कारण")}
                value={draft.adjustmentReason ?? ""}
                onChange={(adjustmentReason) => change({ adjustmentReason })}
              />
            )}
            {!!validation && (
              <Txt size={12} muted>
                {validation}
              </Txt>
            )}
            <Txt size={11} muted>
              {t(
                "Confirm the supplied medicine, strength, batch, pack size and prices. Purchase costs are never shown to employees.",
                "मिली दवा, ताकत, बैच, पैक और कीमतों की जाँच करें। खरीद लागत कर्मचारियों को नहीं दिखती।",
              )}
            </Txt>
            <Button
              disabled={!operation || busy || !!draft.jobId}
              onPress={() =>
                void (async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await s.command(buildPurchase(draft, state));
                    posted.current = true;
                    await writes.current;
                    await storage.remove(key);
                    onDone();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              {busy
                ? t("Posting…", "जोड़ रहे हैं…")
                : t("Confirm & add to stock", "पुष्टि करें और स्टॉक जोड़ें")}
            </Button>
          </View>
        </>
      )}
      <Button secondary small onPress={() => setDiscard(!discard)}>
        {t("Discard this draft", "यह ड्राफ्ट हटाएँ")}
      </Button>
      {discard && (
        <View style={{ gap: 10 }}>
          <Txt>
            {t(
              "Discard your edits? The original uploaded document remains available.",
              "बदलाव हटाएँ? अपलोड किया मूल बिल उपलब्ध रहेगा।",
            )}
          </Txt>
          <Button
            onPress={() => {
              setDraft(fresh());
              setFailedJob(undefined);
              setDiscard(false);
              setExpanded(null);
              setError("");
            }}
          >
            {t("Yes, start a new draft", "हाँ, नया ड्राफ्ट बनाएँ")}
          </Button>
        </View>
      )}
    </View>
  );
}
function ReceivingItem({
  line,
  products,
  expanded,
  toggle,
  error,
  result,
  change,
  remove,
}: {
  line: ReceivingLine;
  products: Product[];
  expanded: boolean;
  toggle: () => void;
  error: string;
  result: ReturnType<typeof receivingLine> | null;
  change: (p: Partial<ReceivingLine>) => void;
  remove: () => void;
}) {
  const { language } = useSession();
  const t = (en: string, hi: string) => (language === "hi" ? hi : en);
  const [search, setSearch] = useState(line.source?.name ?? "");
  const [newProduct, setNewProduct] = useState<Product | null>(null);
  const product = products.find((p) => p.id === line.productId);
  const validReview =
    line.confirmed &&
    product &&
    line.catalogueSignature === catalogueSignature(product);
  return (
    <View
      style={{
        paddingVertical: 18,
        borderBottomWidth: 1,
        borderColor: colors.line,
        marginBottom: 14,
      }}
    >
      <Pressable onPress={toggle} accessibilityRole="button">
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1, gap: 5 }}>
            <Txt bold>
              {product
                ? `${product.name} ${product.strength}`
                : line.source?.name || t("Choose product", "सामान चुनें")}
            </Txt>
            <Txt muted size={12}>
              {product
                ? `${line.quantity || "—"} + ${line.bonus || "0"} ${line.unit || "…"} · ${line.code || "…"}`
                : t(
                    "Match this line to your catalogue",
                    "इस सामान को कैटलॉग से मिलाएँ",
                  )}
            </Txt>
          </View>
          <Badge warning={!validReview}>
            {validReview ? t("Reviewed", "जाँचा गया") : t("Review", "जाँचें")}
          </Badge>
        </Row>
      </Pressable>
      {expanded && (
        <View style={{ gap: 12, marginTop: 18 }}>
          {line.source && (
            <View
              style={{
                padding: 12,
                backgroundColor: colors.tint,
                borderRadius: 8,
                gap: 5,
              }}
            >
              <Txt size={11} bold>
                {t(
                  "Read from invoice — check against original",
                  "बिल से पढ़ा गया — मूल बिल से जाँचें",
                )}
              </Txt>
              <Txt size={12}>
                {line.source.name} {line.source.strength} ·{" "}
                {line.source.quantity ?? "?"} {line.source.unit ?? "?"} +{" "}
                {line.source.bonusQuantity ?? "0"} {t("bonus", "बोनस")}
              </Txt>
              <Txt size={12}>
                {t("Pack: ", "पैक: ")}
                {line.source.packSize ?? "?"} · GST{" "}
                {line.source.taxBps === null
                  ? "?"
                  : line.source.taxBps / 100 + "%"}
              </Txt>
            </View>
          )}
          <Field
            label={t(
              "Search name, strength or barcode",
              "नाम, ताकत या बारकोड खोजें",
            )}
            value={search}
            onChange={setSearch}
          />
          {productSuggestions(products, search).map((p) => (
            <Pressable
              accessibilityRole="button"
              key={p.id}
              onPress={() =>
                change({
                  productId: p.id,
                  unit: "",
                  priceUnit: "",
                  price: "",
                  cost: "",
                })
              }
              style={{
                padding: 12,
                backgroundColor:
                  p.id === line.productId ? colors.tint : "white",
                borderRadius: 8,
              }}
            >
              <Txt bold>
                {p.name} {p.strength}
              </Txt>
              <Txt size={11} muted>
                {p.form} · GST {p.taxBps / 100}% ·{" "}
                {Object.entries(p.units)
                  .map(([u, n]) => `${u} = ${n} ${p.baseUnit}`)
                  .join(" · ")}
              </Txt>
            </Pressable>
          ))}
          {!productSuggestions(products, search).length && !newProduct && (
            <View style={{ gap: 8 }}>
              <Txt muted>
                {t(
                  "No catalogue product matches this line.",
                  "इस लाइन से कैटलॉग का कोई सामान नहीं मिलता।",
                )}
              </Txt>
              <Button
                secondary
                small
                icon="add"
                onPress={() =>
                  setNewProduct(
                    productFromInvoiceLine(
                      line.source ?? {
                        name: search,
                        strength: null,
                        packSize: null,
                        unit: null,
                        taxBps: null,
                      },
                      uid(),
                    ),
                  )
                }
              >
                {t("Add as new medicine", "नई दवा के रूप में जोड़ें")}
              </Button>
            </View>
          )}
          {newProduct && (
            <View
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 8,
              }}
            >
              <Txt bold style={{ marginBottom: 10 }}>
                {t(
                  "New medicine from this invoice line: check every field",
                  "इस बिल लाइन से नई दवा: हर जानकारी जाँचें",
                )}
              </Txt>
              <ProductForm
                product={null}
                draft={newProduct}
                onDone={(saved) => {
                  setNewProduct(null);
                  if (saved)
                    change({
                      productId: saved.id,
                      unit: "",
                      priceUnit: "",
                      price: "",
                      cost: "",
                    });
                }}
              />
              <View style={{ height: 10 }} />
              <Button secondary small onPress={() => setNewProduct(null)}>
                {t("Cancel", "रद्द करें")}
              </Button>
            </View>
          )}
          {product && (
            <>
              {line.source?.taxBps != null &&
                line.source.taxBps !== product.taxBps && (
                  <Txt style={{ color: colors.amber }}>
                    {t(
                      "Invoice tax differs from catalogue tax. Check both before confirming.",
                      "बिल और कैटलॉग का टैक्स अलग है। पुष्टि से पहले दोनों जाँचें।",
                    )}
                  </Txt>
                )}
              <Field
                label={t("Physical batch code", "मिले बैच का नंबर")}
                value={line.code}
                onChange={(code) => change({ code })}
              />
              <Field
                label={t(
                  "Confirmed expiry (YYYY-MM-DD)",
                  "जाँची गई एक्सपायरी (YYYY-MM-DD)",
                )}
                value={line.expiry}
                onChange={(expiry) => change({ expiry })}
              />
              <Txt bold size={12}>
                {t("Received quantity is in", "मिली मात्रा की इकाई")}
              </Txt>
              <Row style={{ flexWrap: "wrap" }}>
                {Object.keys(product.units).map((unit) => (
                  <Chip
                    key={unit}
                    active={line.unit === unit}
                    onPress={() => change({ unit })}
                  >
                    {unit}
                  </Chip>
                ))}
              </Row>
              <Field
                number
                label={t("Paid quantity", "खरीदी मात्रा")}
                value={line.quantity}
                onChange={(quantity) => change({ quantity })}
              />
              <Field
                number
                label={t(
                  "Free / bonus quantity (same unit)",
                  "मुफ़्त / बोनस मात्रा (उसी इकाई में)",
                )}
                value={line.bonus}
                onChange={(bonus) => change({ bonus })}
              />
              {!!line.unit && (
                <Txt style={{ color: colors.accent }}>
                  {t("Stock conversion: ", "स्टॉक परिवर्तन: ")}
                  {line.quantity || "0"} + {line.bonus || "0"} {line.unit} ×{" "}
                  {product.units[line.unit]} {product.baseUnit}
                </Txt>
              )}
              <Txt bold size={12}>
                {t("Prices below are per", "नीचे की कीमतें प्रति")}
              </Txt>
              <Row style={{ flexWrap: "wrap" }}>
                {Object.keys(product.units).map((priceUnit) => (
                  <Chip
                    key={priceUnit}
                    active={line.priceUnit === priceUnit}
                    onPress={() => change({ priceUnit })}
                  >
                    {priceUnit}
                  </Chip>
                ))}
              </Row>
              <Field
                number
                label={t("MRP (₹)", "एमआरपी (₹)")}
                value={line.mrp}
                onChange={(mrp) => change({ mrp })}
              />
              <Field
                number
                label={t("Selling price (₹)", "बिक्री कीमत (₹)")}
                value={line.price}
                onChange={(price) => change({ price })}
              />
              <Field
                number
                label={t(
                  "Verified purchase cost (₹, optional)",
                  "जाँची खरीद लागत (₹, वैकल्पिक)",
                )}
                value={line.cost}
                onChange={(cost) => change({ cost })}
              />
              <Field
                number
                label={t(
                  "Line total including tax (₹)",
                  "इस सामान का टैक्स सहित कुल (₹)",
                )}
                value={line.total}
                onChange={(total) => change({ total })}
              />
              {result && (
                <View style={{ gap: 6 }}>
                  <Txt bold style={{ color: colors.accent }}>
                    +{D(result.quantity).plus(result.bonusQuantity).toFixed()}{" "}
                    {product.baseUnit}
                  </Txt>
                  <Txt size={12} muted>
                    {t("Per base unit: ", "प्रति मूल इकाई: ")}
                    {rupees(result.batch.pricePaise)} · MRP{" "}
                    {rupees(result.batch.mrpPaise)}
                  </Txt>
                </View>
              )}
            </>
          )}
          {!!error && (
            <Txt size={12} style={{ color: colors.amber }}>
              {error}
            </Txt>
          )}
          <Button
            secondary
            disabled={!!error}
            onPress={() => {
              change({
                confirmed: true,
                catalogueSignature: catalogueSignature(product!),
              });
              toggle();
            }}
          >
            {t("Confirm this item", "इस सामान की पुष्टि करें")}
          </Button>
          <Button secondary small onPress={remove}>
            {t("Remove item", "सामान हटाएँ")}
          </Button>
        </View>
      )}
    </View>
  );
}
