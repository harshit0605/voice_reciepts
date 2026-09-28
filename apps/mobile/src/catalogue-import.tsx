import React, { useMemo, useRef, useState } from "react";
import { View, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useSession, uid } from "./session";
import { Txt, Button, Field, Row, Chip, Badge, colors, styles } from "./ui";
import {
  readTable,
  parseDelimited,
  findHeader,
  guessMapping,
  planImport,
  chunks,
  catalogueFields,
  type CatalogueField,
  type ColumnMapping,
  type ImportRowPlan,
} from "@counterwell/core";
const labels: Record<CatalogueField, string> = {
  name: "Product name",
  generic: "Generic / salt",
  strength: "Strength",
  form: "Form",
  pack: "Pack",
  gst: "GST %",
  hsn: "HSN",
  barcode: "Barcode",
  schedule: "Schedule",
  company: "Company",
};
const labelsHi: Record<CatalogueField, string> = {
  name: "सामान का नाम",
  generic: "जेनेरिक / साल्ट",
  strength: "ताकत",
  form: "रूप",
  pack: "पैक",
  gst: "GST %",
  hsn: "HSN",
  barcode: "बारकोड",
  schedule: "शेड्यूल",
  company: "कंपनी",
};
const MAX_BYTES = 15 * 1024 * 1024,
  MAX_ROWS = 20000,
  SHOWN = 50;
const count = (n: number) => n.toLocaleString("en-IN");
/** Owner-only: load products from an Excel/CSV export or pasted spreadsheet rows. */
export function CatalogueImport({ onDone }: { onDone: () => void }) {
  const s = useSession(),
    state = s.state!,
    hi = s.language === "hi";
  const [table, setTable] = useState<string[][] | null>(null),
    [source, setSource] = useState(""),
    [paste, setPaste] = useState(""),
    [header, setHeader] = useState(0),
    [mapping, setMapping] = useState<ColumnMapping>({}),
    [defaultGst, setDefaultGst] = useState(""),
    [field, setField] = useState<CatalogueField>("name"),
    [filter, setFilter] = useState<ImportRowPlan["status"] | "warnings">("new"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<{ done: number; total: number } | null>(
      null,
    ),
    [added, setAdded] = useState<number | null>(null);
  // Product IDs stay the same while the mapping is adjusted.
  const ids = useRef(new Map<number, string>()),
    running = useRef(false);
  function load(rows: string[][], name: string) {
    if (rows.length > MAX_ROWS)
      throw new Error("Split the file into parts of 20,000 rows or fewer");
    const h = findHeader(rows);
    if (rows.length < h + 2)
      throw new Error("No product rows found in the file");
    ids.current.clear();
    setTable(rows);
    setSource(name);
    setHeader(h);
    setMapping(guessMapping(rows[h] ?? []));
    setAdded(null);
    setProgress(null);
    setFilter("new");
  }
  async function attempt(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const choose = () =>
    attempt(async () => {
      const pick = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (pick.canceled) return;
      const file = pick.assets[0];
      if (file.size && file.size > MAX_BYTES)
        throw new Error("Choose a file smaller than 15 MB");
      const bytes =
        Platform.OS === "web"
          ? new Uint8Array(await (await fetch(file.uri)).arrayBuffer())
          : await new FileSystem.File(file.uri).bytes();
      load(readTable(bytes), file.name);
    });
  const plan = useMemo(
    () =>
      table
        ? planImport(table, header, mapping, state, {
            defaultGst,
            idFor: (line) => {
              let id = ids.current.get(line);
              if (!id) ids.current.set(line, (id = uid()));
              return id;
            },
          })
        : null,
    [table, header, mapping, defaultGst, state.products],
  );
  const importAll = () =>
    attempt(async () => {
      if (!plan?.create.length) return;
      const importId = uid(),
        total = plan.create.length;
      let done = 0;
      setProgress({ done, total });
      try {
        for (const products of chunks(plan.create, 200)) {
          await s.command({ type: "catalogue.import", importId, products });
          done += products.length;
          setProgress({ done, total });
        }
      } finally {
        // Imported rows now match the catalogue, so a retry sends only the rest.
        if (done) setAdded(done);
      }
    });
  const moveHeader = (h: number) => {
    setHeader(h);
    setMapping(guessMapping(table?.[h] ?? []));
  };
  if (!table)
    return (
      <View style={{ gap: 14 }}>
        <Txt muted>
          Load products from an Excel (.xlsx) or CSV export of your billing
          software or distributor, or paste rows copied from a spreadsheet.
          Nothing is saved until you review the rows and confirm.
        </Txt>
        <Txt size={12} muted>
          Columns it understands: item name, pack (10's, 1x15, 100ML), GST %,
          HSN, barcode, generic or salt, strength, form, schedule and company.
          Stock quantities are not imported here; record counted stock
          separately.
        </Txt>
        <Button
          disabled={busy}
          onPress={() => void choose()}
          icon="document-outline"
        >
          Choose Excel or CSV file
        </Button>
        <Field
          label="Or paste rows, including the header row"
          value={paste}
          onChange={setPaste}
          multiline
        />
        <Button
          secondary
          disabled={!paste.trim() || busy}
          onPress={() =>
            void attempt(async () => load(parseDelimited(paste), "Pasted rows"))
          }
        >
          Use pasted rows
        </Button>
        {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
      </View>
    );
  const headers = table[header] ?? [];
  const shown = (plan?.rows ?? [])
    .filter((r) =>
      filter === "warnings"
        ? r.status === "new" && r.warnings.length
        : r.status === filter,
    )
    .slice(0, SHOWN);
  const c = plan?.counts;
  const label = (f: CatalogueField) => (hi ? labelsHi : labels)[f];
  const column = (i: number | undefined) =>
    i === undefined ? "—" : (headers[i] || `#${i + 1}`).slice(0, 18);
  return (
    <View style={{ gap: 14 }}>
      <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Txt bold>{source}</Txt>
        <Button
          secondary
          small
          disabled={busy}
          onPress={() => {
            setTable(null);
            setError("");
          }}
        >
          Choose another file
        </Button>
      </Row>
      <Row style={{ flexWrap: "wrap" }}>
        <Txt muted size={12} style={{ flex: 1 }}>
          {`${hi ? "हेडर पंक्ति" : "Header row"} ${header + 1}: ${headers
            .filter(Boolean)
            .slice(0, 4)
            .join(" · ")}`}
        </Txt>
        <Chip
          active={false}
          onPress={() => moveHeader(Math.max(0, header - 1))}
        >
          −
        </Chip>
        <Chip
          active={false}
          onPress={() => moveHeader(Math.min(table.length - 2, header + 1))}
        >
          +
        </Chip>
      </Row>
      <Txt bold>Match columns</Txt>
      <Row style={{ flexWrap: "wrap" }}>
        {catalogueFields.map((f) => (
          <Chip key={f} active={field === f} onPress={() => setField(f)}>
            {`${label(f)}: ${column(mapping[f])}`}
          </Chip>
        ))}
      </Row>
      <View
        style={{
          padding: 12,
          backgroundColor: colors.tint,
          borderRadius: 8,
          gap: 8,
        }}
      >
        <Txt size={12} bold>
          {`${hi ? "इस कॉलम से:" : "Column for"} ${label(field)}`}
        </Txt>
        <Row style={{ flexWrap: "wrap" }}>
          <Chip
            active={mapping[field] === undefined}
            onPress={() => setMapping({ ...mapping, [field]: undefined })}
          >
            Not in file
          </Chip>
          {headers.map((h, i) => (
            <Chip
              key={i}
              active={mapping[field] === i}
              onPress={() => setMapping({ ...mapping, [field]: i })}
            >
              {(h || `#${i + 1}`).slice(0, 24)}
            </Chip>
          ))}
        </Row>
      </View>
      <Field
        label="GST % for rows without one (optional)"
        value={defaultGst}
        onChange={setDefaultGst}
        number
      />
      {mapping.name === undefined && (
        <Txt style={{ color: colors.red }}>
          Choose the column with product names
        </Txt>
      )}
      {mapping.schedule === undefined && (
        <Txt style={{ color: colors.amber }}>
          No schedule column: every medicine will be marked OTC. Mark H and H1
          medicines afterwards so the prescription register is required.
        </Txt>
      )}
      {c && (
        <>
          <Row style={{ flexWrap: "wrap" }}>
            <Chip active={filter === "new"} onPress={() => setFilter("new")}>
              {`${hi ? "नए" : "New"} · ${count(c.new)}`}
            </Chip>
            <Chip
              active={filter === "warnings"}
              onPress={() => setFilter("warnings")}
            >
              {`${hi ? "जाँचें" : "Check"} · ${count(c.warnings)}`}
            </Chip>
            <Chip
              active={filter === "existing"}
              onPress={() => setFilter("existing")}
            >
              {`${hi ? "पहले से हैं" : "Already added"} · ${count(c.existing)}`}
            </Chip>
            <Chip
              active={filter === "repeat"}
              onPress={() => setFilter("repeat")}
            >
              {`${hi ? "दोहराए" : "Repeated"} · ${count(c.repeat)}`}
            </Chip>
            <Chip
              active={filter === "error"}
              onPress={() => setFilter("error")}
            >
              {`${hi ? "गलतियाँ" : "Errors"} · ${count(c.error)}`}
            </Chip>
          </Row>
          {shown.map((r) => (
            <View key={r.line} style={styles.listRow}>
              <Row style={{ justifyContent: "space-between" }}>
                <Txt bold style={{ flex: 1 }}>
                  {r.name || "—"}
                </Txt>
                <Badge warning={r.status === "error"}>
                  {`${hi ? "पंक्ति" : "Row"} ${r.line}`}
                </Badge>
              </Row>
              {r.product && (
                <Txt size={11} muted style={{ marginTop: 5 }}>
                  {[
                    r.product.strength,
                    Object.entries(r.product.units)
                      .map(([u, n]) => (n === "1" ? u : `${u} = ${n}`))
                      .join(", "),
                    `GST ${r.product.taxBps / 100}%`,
                    r.product.schedule,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Txt>
              )}
              {r.status === "existing" && (
                <Txt size={11} muted style={{ marginTop: 5 }}>
                  {`${state.products[r.existingId!]?.name ?? ""} ${state.products[r.existingId!]?.strength ?? ""}`}
                </Txt>
              )}
              {r.status === "repeat" && (
                <Txt size={11} muted style={{ marginTop: 5 }}>
                  {`${hi ? "इस पंक्ति जैसा:" : "Same as row"} ${r.repeatOf}`}
                </Txt>
              )}
              {r.errors.map((e) => (
                <Txt
                  key={e}
                  size={11}
                  style={{ color: colors.red, marginTop: 5 }}
                >
                  {e}
                </Txt>
              ))}
              {r.warnings.map((w) => (
                <Txt
                  key={w}
                  size={11}
                  style={{ color: colors.amber, marginTop: 5 }}
                >
                  {w}
                </Txt>
              ))}
            </View>
          ))}
          {!shown.length && <Txt muted>No rows here.</Txt>}
          {(filter === "warnings" ? c.warnings : c[filter]) > SHOWN && (
            <Txt size={11} muted>
              {hi
                ? `पहली ${SHOWN} पंक्तियाँ दिख रही हैं`
                : `Showing the first ${SHOWN} rows`}
            </Txt>
          )}
        </>
      )}
      {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
      {progress && (
        <Txt>
          {hi
            ? `${count(progress.done)} / ${count(progress.total)} जोड़े गए`
            : `Added ${count(progress.done)} of ${count(progress.total)}`}
        </Txt>
      )}
      {added !== null && !plan?.create.length ? (
        <Button onPress={onDone} icon="checkmark">
          Done
        </Button>
      ) : (
        <Button
          disabled={busy || !plan?.create.length || mapping.name === undefined}
          onPress={() => void importAll()}
          icon="cloud-upload-outline"
        >
          {busy
            ? hi
              ? "जोड़ रहे हैं…"
              : "Adding…"
            : hi
              ? `${count(plan?.create.length ?? 0)} दवाएँ जोड़ें`
              : `Add ${count(plan?.create.length ?? 0)} medicines`}
        </Button>
      )}
      <Txt size={11} muted>
        Rows with errors, repeated rows and products already in the catalogue
        are skipped. Existing products are never changed by an import.
      </Txt>
    </View>
  );
}
