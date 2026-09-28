import React, { useRef, useState } from "react";
import { useSession, uid } from "./session";
import { Txt, Button, Field, Row, Chip, colors } from "./ui";
import type { Product } from "@counterwell/core";
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
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    saving = useRef(false);
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!name.trim()) throw new Error("Enter the product name");
      if (!tax) throw new Error("Confirm the GST rate");
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
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Field label="Brand / product name" value={name} onChange={S} />
      <Field label="Generic / salt" value={generic} onChange={G} />
      <Field label="Strength and formulation" value={strength} onChange={T} />
      <Field label="Formulation" value={form} onChange={F} />
      <Field label="Base unit" value={unit} onChange={U} />
      <Field
        label="Extra units (box=100, pack=20)"
        value={extraUnits}
        onChange={EU}
      />
      <Field
        label="Reorder level in base units"
        value={reorder}
        onChange={RO}
        number
      />
      {packed(unit) && (
        <Field
          label={
            unit === "capsule" ? "Capsules per strip" : "Tablets per strip"
          }
          value={pack}
          onChange={P}
          number
        />
      )}
      <Field
        label="GST rate (%) · verify from invoice"
        value={tax}
        onChange={X}
        number
      />
      <Field label="HSN" value={hsn} onChange={H} />
      <Field label="Barcodes (comma separated)" value={barcode} onChange={B} />
      <Field
        label="Search aliases (comma separated)"
        value={aliases}
        onChange={A}
      />
      <Row style={{ marginBottom: 20 }}>
        {(["OTC", "H", "H1", "X"] as const).map((r) => (
          <Chip key={r} active={schedule === r} onPress={() => R(r)}>
            {r}
          </Chip>
        ))}
      </Row>
      {!!error && (
        <Txt style={{ color: colors.red, marginBottom: 12 }}>{error}</Txt>
      )}
      <Button disabled={busy} onPress={() => void save()}>
        Save medicine
      </Button>
    </>
  );
}
