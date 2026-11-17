import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useSession, uid } from "./session";
import { Txt, Button, Field, Row, Chip, Icon, palette, Notice } from "./ui";
import type { Product } from "@counterwell/core";
export { Notice } from "./ui";
const FIELD_NAMES: Record<string, [string, string]> = {
  name: ["product name", "दवा का नाम"],
  reorderAt: ["reorder level", "मँगाने की सीमा"],
  taxBps: ["GST rate", "जीएसटी दर"],
  units: ["units", "इकाइयाँ"],
  baseUnit: ["base unit", "मूल इकाई"],
  hsn: ["HSN", "HSN"],
  barcode: ["barcodes", "बारकोड"],
  strength: ["strength", "ताक़त"],
  generic: ["generic / salt", "साल्ट"],
  form: ["formulation", "दवा का रूप"],
};
/**
 * A save error in words. A validator failure can arrive as a JSON list of issues: never show
 * that; name the field and what is wrong with it instead.
 */
export function readableSaveError(message: string, hi = false) {
  const trimmed = message.trim();
  if (!/^[[{]/.test(trimmed)) return message;
  try {
    const parsed = JSON.parse(trimmed);
    const issue = Array.isArray(parsed)
      ? parsed[0]
      : (parsed?.issues?.[0] ?? parsed);
    const key = String(issue?.path?.at(-1) ?? "");
    const field = FIELD_NAMES[key]?.[hi ? 1 : 0] ?? key;
    const reason = issue?.message
      ? String(issue.message)
      : hi
        ? "सही मान भरें"
        : "enter a valid value";
    const text = field
      ? `${hi ? "जाँचें" : "Check"} ${field}: ${reason}`
      : "";
    if (text) return text;
  } catch {}
  return hi
    ? "जो भरा है उसे जाँचकर फिर कोशिश करें।"
    : "Check the details you entered and try again.";
}
/** Add or edit a catalogue product; `draft` prefills a new one (for example from an invoice line). */
export function ProductForm({
  product,
  draft,
  onDone,
}: {
  product: Product | null;
  draft?: Product;
  onDone: (saved?: Product) => void;
}) {
  const s = useSession();
  const hi = s.language === "hi";
  const t = (en: string, h: string) => (hi ? h : en);
  const start = product ?? draft;
  const packed = (unit: string) => unit === "tablet" || unit === "capsule";
  const [extraUnits, EU] = useState(
    Object.entries(start?.units ?? {})
      .filter(
        ([u]) =>
          u !== start?.baseUnit &&
          !(packed(start?.baseUnit ?? "") && u === "strip"),
      )
      .map(([k, v]) => `${k}=${v}`)
      .join(", "),
  );
  const [reorder, RO] = useState(start?.reorderAt ?? "10"),
    [form, F] = useState(start?.form ?? "tablet");
  const [name, S] = useState(start?.name ?? ""),
    [generic, G] = useState(start?.generic ?? ""),
    [strength, T] = useState(start?.strength ?? ""),
    [unit, U] = useState(start?.baseUnit ?? "tablet"),
    [pack, P] = useState(start?.units.strip ?? (start ? "" : "10")),
    [tax, X] = useState(
      start && (product || start.taxBps) ? String(start.taxBps / 100) : "",
    ),
    [hsn, H] = useState(start?.hsn ?? ""),
    [barcode, B] = useState(start?.barcode ?? ""),
    [aliases, A] = useState(start?.aliases.join(", ") ?? ""),
    [schedule, R] = useState<Product["schedule"]>(start?.schedule ?? "OTC");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    saving = useRef(false);
  /** Field-level problems, in the schema's own limits (packages/core contracts.ts). */
  function validate() {
    const found: Record<string, string> = {};
    const qtyOk = (v: string) => /^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(v.trim());
    if (!name.trim())
      found.name = t("Enter the product name", "दवा का नाम भरें");
    else if (name.trim().length > 180)
      found.name = t("Name is too long (180 letters at most)", "नाम बहुत लंबा है (अधिकतम 180 अक्षर)");
    if (!unit.trim()) found.unit = t("Enter the base unit", "मूल इकाई भरें");
    if (!/^\d+$/.test(reorder.trim()))
      found.reorder = t(
        "Enter a whole number, 0 or more",
        "0 या उससे ज़्यादा पूरी संख्या भरें",
      );
    else if (reorder.trim().length > 9)
      found.reorder = t("That number is too large", "यह संख्या बहुत बड़ी है");
    if (!tax.trim())
      found.tax = t("Confirm the GST rate", "जीएसटी दर की पुष्टि करें");
    else if (
      !/^\d{1,2}(\.\d{1,2})?$/.test(tax.trim()) ||
      Number(tax) < 0 ||
      Number(tax) > 28
    )
      found.tax = t(
        "GST must be between 0 and 28 (for example 0, 5, 12, 18 or 28)",
        "जीएसटी 0 से 28 के बीच होना चाहिए (जैसे 0, 5, 12, 18 या 28)",
      );
    if (packed(unit) && pack.trim() && (!qtyOk(pack) || !(Number(pack) > 0)))
      found.pack = t(
        "Enter a number greater than 0",
        "0 से बड़ी संख्या भरें",
      );
    for (const part of extraUnits.split(",").map((x) => x.trim()).filter(Boolean)) {
      const [k, v = ""] = part.split("=").map((x) => x.trim());
      if (!k || !qtyOk(v) || !(Number(v) > 0)) {
        found.extra = t(
          `Write extra units like box=100 (check "${part}")`,
          `अतिरिक्त इकाई ऐसे लिखें: box=100 ("${part}" जाँचें)`,
        );
        break;
      }
    }
    if (hsn.length > 12)
      found.hsn = t("HSN is at most 12 digits", "HSN अधिकतम 12 अंकों का हो");
    return found;
  }
  const edit =
    <T,>(key: string, set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setError("");
      setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
    };
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const found = validate();
      setErrors(found);
      if (Object.keys(found).length) {
        setError(t("Fix the highlighted fields.", "लाल निशान वाले खाने सुधारें।"));
        return;
      }
      const saved: Product = {
        id: product?.id ?? draft?.id ?? uid(),
        name: name.trim(),
        generic,
        strength,
        form,
        hsn,
        barcode,
        aliases: aliases
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        units: {
          [unit]: "1",
          ...(packed(unit) && pack ? { strip: pack } : {}),
          ...Object.fromEntries(
            extraUnits
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => x.split("=").map((v) => v.trim())),
          ),
        },
        baseUnit: unit,
        taxBps: Math.round(Number(tax) * 100),
        schedule,
        reorderAt: reorder,
        active: product?.active ?? true,
      };
      await s.command({ type: "product.save", product: saved });
      onDone(saved);
    } catch (e) {
      setError(readableSaveError((e as Error).message, hi));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Field label="Brand / product name" value={name} onChange={edit("name", S)} error={errors.name} />
      <Field label="Generic / salt" value={generic} onChange={G} />
      <Field label="Strength and formulation" value={strength} onChange={T} />
      <Field label="Formulation" value={form} onChange={F} />
      <Field label="Base unit" value={unit} onChange={edit("unit", U)} error={errors.unit} />
      <Field
        label="Extra units (box=100, pack=20)"
        value={extraUnits}
        onChange={edit("extra", EU)}
        error={errors.extra}
      />
      <Field
        label="Reorder level in base units"
        value={reorder}
        onChange={edit("reorder", RO)}
        error={errors.reorder}
        number
      />
      {packed(unit) && (
        <Field
          label={
            unit === "capsule" ? "Capsules per strip" : "Tablets per strip"
          }
          value={pack}
          onChange={edit("pack", P)}
          error={errors.pack}
          number
        />
      )}
      <Field
        label="GST rate (%) · verify from invoice"
        value={tax}
        onChange={edit("tax", X)}
        error={errors.tax}
        number
      />
      <Field label="HSN" value={hsn} onChange={edit("hsn", H)} error={errors.hsn} />
      <Field label="Barcodes (comma separated)" value={barcode} onChange={B} />
      <Field
        label="Search aliases (comma separated)"
        value={aliases}
        onChange={A}
      />
      <Txt size={14} weight={500} color={palette.ink2} style={{ marginBottom: 6 }}>
        Schedule
      </Txt>
      <Row style={{ marginBottom: 24, flexWrap: "wrap" }}>
        {(["OTC", "H", "H1", "X"] as const).map((r) => (
          <Chip key={r} active={schedule === r} onPress={() => R(r)}>
            {r}
          </Chip>
        ))}
      </Row>
      {!!error && (
        <View style={{ marginBottom: 16 }}>
          <Notice>{error}</Notice>
        </View>
      )}
      <Button disabled={busy} onPress={() => void save()}>
        Save medicine
      </Button>
    </>
  );
}
