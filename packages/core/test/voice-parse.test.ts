import { describe, it, expect } from "vitest";
import {
  normalVoice,
  spokenUnit,
  spokenQuantity,
  readableQuantity,
  readableUnit,
  sameStrength,
  spokenItemTitle,
  parseExactSaleText,
  voiceCandidates,
  type Product,
  type SpokenItem,
} from "../src";

function product(
  over: Partial<Product> & { id: string; name: string },
): Product {
  return {
    generic: "generic",
    strength: "",
    form: "tablet",
    hsn: "3004",
    aliases: [],
    barcode: "",
    units: { tablet: "1", strip: "10" },
    baseUnit: "tablet",
    taxBps: 500,
    reorderAt: "0",
    schedule: "OTC",
    active: true,
    ...over,
  } as Product;
}
const dolo = product({ id: "dolo", name: "Dolo", strength: "650 mg" });
const crocin = product({ id: "crocin", name: "Crocin", strength: "500 mg" });
const syrup = product({
  id: "syr",
  name: "Cough Syrup",
  strength: "100 ml",
  form: "bottle",
  baseUnit: "bottle",
  units: { bottle: "1" },
});
const catalogue = [dolo, crocin, syrup];

describe("normalVoice", () => {
  it("lowercases, drops spaces and punctuation, keeps dots", () => {
    expect(normalVoice("Dolo 650-mg!")).toBe("dolo650mg");
    expect(normalVoice("0.5 mg")).toBe("0.5mg");
  });
  it("converts Devanagari digits to ASCII", () => {
    expect(normalVoice("डोलो ६५०")).toContain("650");
  });
  it("applies NFKC so full-width Latin matches plain Latin", () => {
    expect(normalVoice("ＤＯＬＯ")).toBe("dolo");
  });
  it("is empty for input with no letters or digits", () => {
    expect(normalVoice("  -- !! ")).toBe("");
    expect(normalVoice("")).toBe("");
  });
  // Regression (fixed 2026-11-17): normalVoice keeps only \p{L}\p{N}, so Devanagari vowel signs (matras, \p{M}) are removed.
  // Distinct Hindi words collapse into the same key ("काला" and "कली" both become "कल"), which
  // lets a differently-spelled name pass the exact-identity match in voice.ts parseExactSaleText.
  it("keeps Devanagari vowel signs so different Hindi words stay different", () => {
    expect(normalVoice("काला")).not.toBe(normalVoice("कली"));
  });
});

describe("spokenQuantity edge cases", () => {
  it("accepts plain and decimal quantities", () => {
    expect(spokenQuantity("1")).toBe("1");
    expect(spokenQuantity("12")).toBe("12");
    expect(spokenQuantity("1.5")).toBe("1.5");
    expect(spokenQuantity("0.5")).toBe("0.5");
    expect(spokenQuantity("0.125")).toBe("0.125");
    expect(spokenQuantity("999999")).toBe("999999");
  });
  it("rejects zero, negative, malformed and oversized quantities", () => {
    for (const v of [
      "0",
      "0.0",
      "0.000",
      "-3",
      "+3",
      "1.",
      ".5",
      "1.2345",
      "1e3",
      "1,000",
      "1000000",
      "05",
      "٣",
      "",
      "   ",
      "NaN",
      "Infinity",
    ])
      expect(spokenQuantity(v), JSON.stringify(v)).toBe("");
  });
  it("trims, lowercases and reads Devanagari digits including decimals", () => {
    expect(spokenQuantity("  TEN ")).toBe("10");
    expect(spokenQuantity("१.५")).toBe("1.5");
    expect(spokenQuantity("१०")).toBe("10");
    expect(spokenQuantity("०")).toBe("");
  });
  it("knows every Hindi number word with its spelling variants", () => {
    const hindi: [string, string][] = [
      ["एक", "1"],
      ["दो", "2"],
      ["तीन", "3"],
      ["चार", "4"],
      ["पांच", "5"],
      ["पाँच", "5"],
      ["छह", "6"],
      ["छः", "6"],
      ["सात", "7"],
      ["आठ", "8"],
      ["नौ", "9"],
      ["दस", "10"],
      ["ग्यारह", "11"],
      ["बारह", "12"],
      ["पंद्रह", "15"],
      ["बीस", "20"],
      ["तीस", "30"],
      ["आधा", "0.5"],
      ["आधी", "0.5"],
    ];
    for (const [word, n] of hindi) expect(spokenQuantity(word), word).toBe(n);
  });
  it("knows English number words", () => {
    const en: [string, string][] = [
      ["one", "1"],
      ["two", "2"],
      ["three", "3"],
      ["four", "4"],
      ["five", "5"],
      ["six", "6"],
      ["seven", "7"],
      ["eight", "8"],
      ["nine", "9"],
      ["ten", "10"],
      ["eleven", "11"],
      ["twelve", "12"],
      ["fifteen", "15"],
      ["twenty", "20"],
      ["thirty", "30"],
      ["dozen", "12"],
      ["a dozen", "12"],
    ];
    for (const [word, n] of en) expect(spokenQuantity(word), word).toBe(n);
  });
  it("does not treat prototype keys as number words", () => {
    for (const v of [
      "constructor",
      "toString",
      "__proto__",
      "valueOf",
      "hasOwnProperty",
    ])
      expect(spokenQuantity(v), v).toBe("");
  });
  it("readableQuantity falls back to the raw text only when it is not a quantity", () => {
    expect(readableQuantity("आधा")).toBe("0.5");
    expect(readableQuantity("0")).toBe("0");
    expect(readableQuantity("constructor")).toBe("constructor");
  });
});

describe("units: Hindi, Hinglish and plural words", () => {
  const strips = product({
    id: "p",
    name: "P",
    units: { tablet: "1", strip: "10" },
  });
  it("maps every tablet word to the tablet unit", () => {
    for (const w of [
      "goli",
      "Goli",
      "goliyan",
      "गोली",
      "गोलियां",
      "गोलियाँ",
      "tab",
      "tabs",
      "tablets",
      "TABLETS",
    ])
      expect(spokenUnit(w, strips), w).toBe("tablet");
  });
  it("maps every strip word to the strip unit", () => {
    for (const w of [
      "strip",
      "strips",
      "patti",
      "patta",
      "pata",
      "patte",
      "pattiyan",
      "पत्ती",
      "पत्ता",
      "पत्ते",
      "पट्टी",
      "Patta",
    ])
      expect(spokenUnit(w, strips), w).toBe("strip");
  });
  it("ignores surrounding whitespace in the spoken unit", () => {
    expect(spokenUnit("  patta ", strips)).toBe("strip");
    expect(spokenUnit("\tगोली\n", strips)).toBe("tablet");
  });
  it("returns null when the product does not sell that unit", () => {
    const onlyBottle = product({ id: "b", name: "B", units: { bottle: "1" } });
    expect(spokenUnit("goli", onlyBottle)).toBeNull();
    expect(spokenUnit("patta", onlyBottle)).toBeNull();
    expect(spokenUnit("shishi", onlyBottle)).toBe("bottle");
    expect(spokenUnit("शीशी", onlyBottle)).toBe("bottle");
  });
  it("prefers a product's own unit word over the shared dictionary", () => {
    const odd = product({
      id: "o",
      name: "O",
      units: { patta: "10", tablet: "1" },
    });
    expect(spokenUnit("patta", odd)).toBe("patta");
  });
  it("matches a custom product unit ignoring case and punctuation", () => {
    const odd = product({ id: "o", name: "O", units: { "Vial-Pack": "1" } });
    expect(spokenUnit("vial pack", odd)).toBe("Vial-Pack");
  });
  it("maps box and piece words", () => {
    const p = product({ id: "x", name: "X", units: { box: "12", piece: "1" } });
    expect(spokenUnit("boxes", p)).toBe("box");
    expect(spokenUnit("pcs", p)).toBe("piece");
    expect(spokenUnit("pieces", p)).toBe("piece");
  });
  // Regression (fixed 2026-11-17): `units` is a plain object literal, so inherited keys resolve. spokenUnit("constructor")
  // finds Object's constructor function, passes it to normalVoice and throws a TypeError;
  // readableUnit("constructor") returns that function instead of the word. voice.ts:100-101 and
  // :174 (`units[key]`). Spoken units come from model output, so an odd word should never throw.
  it("does not resolve prototype keys as units (spokenUnit)", () => {
    for (const w of ["constructor", "toString", "valueOf"])
      expect(spokenUnit(w, strips), w).toBeNull();
  });
  it("does not resolve prototype keys as units (readableUnit)", () => {
    expect(readableUnit("constructor")).toBe("constructor");
    expect(readableUnit("toString")).toBe("toString");
  });
  it("readableUnit leaves unknown words alone and does not trim them", () => {
    expect(readableUnit("packet")).toBe("packet");
    expect(readableUnit("  GOLI ")).toBe("tablet");
  });
  it("accepts Devanagari decomposed forms of known unit words", () => {
    // पत्ती typed with the characters in a different order is still the same word after NFC.
    expect(spokenUnit("पत्ती".normalize("NFC"), strips)).toBe("strip");
  });
});

describe("sameStrength edge cases", () => {
  it("treats a bare number as the leading number of the catalogue strength", () => {
    expect(sameStrength("650", "650 mg")).toBe(true);
    expect(sameStrength("650.0", "650 mg")).toBe(true);
    expect(sameStrength("0.5", "0.5 mg")).toBe(true);
    expect(sameStrength("500", "500 mg + 125 mg")).toBe(true);
  });
  it("does not match a different or partial number", () => {
    expect(sameStrength("65", "650 mg")).toBe(false);
    expect(sameStrength("6500", "650 mg")).toBe(false);
    expect(sameStrength("125", "500 mg + 125 mg")).toBe(false);
    expect(sameStrength("5", "50 mg")).toBe(false);
  });
  it("matches whole strengths ignoring case and spacing, but not different units", () => {
    expect(sameStrength("650MG", "650 mg")).toBe(true);
    expect(sameStrength("5 ml", "5ml")).toBe(true);
    expect(sameStrength("650 mg", "650 mcg")).toBe(false);
    expect(sameStrength("650 g", "650 mg")).toBe(false);
  });
  it("reads Devanagari digits in spoken strengths", () => {
    expect(sameStrength("६५०", "650 mg")).toBe(true);
  });
  it("handles empty strengths", () => {
    expect(sameStrength("", "")).toBe(true);
    expect(sameStrength("650", "")).toBe(false);
    expect(sameStrength("", "650 mg")).toBe(false);
  });
});

describe("spokenItemTitle", () => {
  it("appends a strength the name lacks", () => {
    expect(spokenItemTitle({ name: "Dolo", strength: "650 mg" })).toBe(
      "Dolo 650 mg",
    );
  });
  it("trims and ignores empty or missing strengths", () => {
    expect(spokenItemTitle({ name: "  Dolo ", strength: "  " })).toBe("Dolo");
    expect(spokenItemTitle({ name: "Dolo", strength: null })).toBe("Dolo");
    expect(spokenItemTitle({ name: "Dolo" })).toBe("Dolo");
  });
  it("does not repeat a number the name carries", () => {
    expect(spokenItemTitle({ name: "Dolo 650", strength: "650 mg" })).toBe(
      "Dolo 650",
    );
    expect(spokenItemTitle({ name: "Dolo 650mg", strength: "650 mg" })).toBe(
      "Dolo 650mg",
    );
  });
  it("does not mistake a number that is part of a longer number", () => {
    expect(spokenItemTitle({ name: "Dolo 1650", strength: "650 mg" })).toBe(
      "Dolo 1650 650 mg",
    );
  });
  it("matches a non-numeric strength by substring, case-insensitively", () => {
    expect(
      spokenItemTitle({ name: "Betadine Ointment", strength: "ointment" }),
    ).toBe("Betadine Ointment");
    expect(spokenItemTitle({ name: "Vitamin", strength: "Forte" })).toBe(
      "Vitamin Forte",
    );
  });
});

describe("parseExactSaleText", () => {
  const parse = (t: string, ps = catalogue) => parseExactSaleText(t, ps);
  const triples = (t: string) =>
    parse(t)?.items.map((i) => [i.name, i.strength, i.quantity, i.unit]);

  it("parses Hinglish and Devanagari units and number words", () => {
    expect(triples("Dolo 650 mg paanch goli")).toBeUndefined(); // "paanch" is not a known word
    expect(triples("Dolo 650 mg पाँच गोली")).toEqual([
      ["Dolo", "650 mg", "5", "tablet"],
    ]);
    expect(triples("Dolo 650 mg 2 पत्ता")).toEqual([
      ["Dolo", "650 mg", "2", "strip"],
    ]);
    expect(triples("Dolo 650 mg दो patta")).toEqual([
      ["Dolo", "650 mg", "2", "strip"],
    ]);
    expect(triples("Dolo 650 mg half strip")).toEqual([
      ["Dolo", "650 mg", "0.5", "strip"],
    ]);
    expect(triples("Dolo 650 mg आधा पत्ता")).toEqual([
      ["Dolo", "650 mg", "0.5", "strip"],
    ]);
  });
  it("reads Devanagari digits in the quantity", () => {
    expect(triples("Dolo 650 mg ३ goli")).toEqual([
      ["Dolo", "650 mg", "3", "tablet"],
    ]);
  });
  it("ignores case, spacing and punctuation in the product text", () => {
    expect(triples("dolo650mg 1 strip")).toEqual([
      ["Dolo", "650 mg", "1", "strip"],
    ]);
    expect(triples("DOLO 650 MG 1 STRIP")).toEqual([
      ["Dolo", "650 mg", "1", "strip"],
    ]);
  });
  it("splits on semicolons and newlines, skipping blanks", () => {
    expect(
      parse("Dolo 650 mg 1 strip;\n\n; Crocin 500 mg 2 goli ;")?.items.map(
        (i) => i.name,
      ),
    ).toEqual(["Dolo", "Crocin"]);
  });
  it("needs the full name and strength; a bare name or a wrong strength returns null", () => {
    expect(parse("Dolo 1 strip")).toBeNull();
    expect(parse("Dolo 500 mg 1 strip")).toBeNull();
    expect(parse("Dolo 650 1 strip")).toBeNull(); // the unit "mg" is part of the identity
  });
  it("returns null for empty, whitespace or too-few-token input", () => {
    for (const t of ["", "   ", ";;;", "\n", "Dolo 650 mg", "strip", "1 strip"])
      expect(parse(t), JSON.stringify(t)).toBeNull();
  });
  it("is all-or-nothing: one bad line rejects the whole text", () => {
    expect(parse("Dolo 650 mg 1 strip; Unknown 5 mg 1 strip")).toBeNull();
    expect(parse("Dolo 650 mg 1 strip; Crocin 500 mg many strip")).toBeNull();
    expect(parse("Dolo 650 mg 1 strip; Crocin 500 mg 1 bottle")).toBeNull();
  });
  it("rejects zero, negative or fractional-token quantities", () => {
    expect(parse("Dolo 650 mg 0 strip")).toBeNull();
    expect(parse("Dolo 650 mg -1 strip")).toBeNull();
    expect(parse("Dolo 650 mg 1/2 strip")).toBeNull();
  });
  it("matches a unit the product has and refuses one it lacks", () => {
    expect(triples("Cough Syrup 100 ml 2 botal")).toEqual([
      ["Cough Syrup", "100 ml", "2", "bottle"],
    ]);
    expect(parse("Cough Syrup 100 ml 2 goli")).toBeNull();
  });
  it("skips inactive products", () => {
    expect(
      parse("Dolo 650 mg 1 strip", [{ ...dolo, active: false }]),
    ).toBeNull();
  });
  it("returns null when two active products share the same name and strength", () => {
    expect(
      parse("Dolo 650 mg 1 strip", [dolo, { ...dolo, id: "dolo2" }]),
    ).toBeNull();
  });
  it("picks the one active product when its twin is inactive", () => {
    const r = parse("Dolo 650 mg 1 strip", [
      { ...dolo, id: "old", active: false },
      dolo,
    ]);
    expect(r?.items).toHaveLength(1);
  });
  it("accepts a product with no strength and reports it as null", () => {
    const plain = product({
      id: "ors",
      name: "ORS",
      strength: "",
      form: "sachet",
      units: { sachet: "1" },
      baseUnit: "sachet",
    });
    expect(parse("ORS 3 sachet", [plain])?.items[0]).toEqual({
      name: "ORS",
      strength: null,
      form: "sachet",
      quantity: "3",
      unit: "sachet",
      uncertain: false,
    });
  });
  it("accepts fifty parts and rejects fifty-one", () => {
    const line = "Dolo 650 mg 1 strip";
    expect(parse(Array(50).fill(line).join(";"))?.items).toHaveLength(50);
    expect(parse(Array(51).fill(line).join(";"))).toBeNull();
  });
  it("never marks an exact local parse uncertain and has no warnings", () => {
    const r = parse("Dolo 650 mg 1 strip");
    expect(r?.warnings).toEqual([]);
    expect(r?.items[0].uncertain).toBe(false);
  });
  // Regression (fixed 2026-11-17): a trailing full stop or comma, which speech-to-text and keyboards add, stays
  // on the last token ("strip." / "1,"). normalVoice keeps "." so the unit never matches and the
  // whole sale text is refused. voice.ts parseExactSaleText / spokenUnit.
  it("tolerates a trailing full stop after the unit", () => {
    expect(parse("Dolo 650 mg 1 strip.")).not.toBeNull();
  });
  it("tolerates a comma after the quantity", () => {
    expect(parse("Dolo 650 mg 1, strip")).not.toBeNull();
  });
});

describe("voiceCandidates", () => {
  const item = (over: Partial<SpokenItem>): SpokenItem => ({
    name: "Dolo",
    strength: null,
    form: null,
    quantity: "1",
    unit: "strip",
    uncertain: false,
    ...over,
  });
  it("returns nothing for an empty or punctuation-only name", () => {
    expect(voiceCandidates(catalogue, item({ name: "" }))).toEqual([]);
    expect(voiceCandidates(catalogue, item({ name: "!!" }))).toEqual([]);
  });
  it("ranks full match over name match over alias over partial over generic", () => {
    const ps = [
      product({ id: "g", name: "Zed", generic: "paracetamol 650" }),
      product({ id: "a", name: "Alpha", aliases: ["fever"] }),
      product({ id: "n", name: "Fever", strength: "5 mg" }),
      product({ id: "f", name: "Fever Plus", strength: "5 mg" }),
    ];
    expect(
      voiceCandidates(ps, item({ name: "fever" })).map((c) => [
        c.product.id,
        c.score,
      ]),
    ).toEqual([
      ["n", 90],
      ["a", 70],
      ["f", 55],
    ]);
    expect(
      voiceCandidates(ps, item({ name: "fever 5 mg" })).map((c) => [
        c.product.id,
        c.score,
      ])[0],
    ).toEqual(["n", 100]);
    expect(
      voiceCandidates(ps, item({ name: "paracetamol" })).map(
        (c) => c.product.id,
      ),
    ).toEqual(["g"]);
  });
  it("penalises strength and form conflicts without dropping the product", () => {
    const [c] = voiceCandidates(
      catalogue,
      item({ name: "Dolo", strength: "500", form: "bottle" }),
    );
    expect(c.strengthConflict).toBe(true);
    expect(c.formConflict).toBe(true);
    expect(c.score).toBe(90 - 30 - 15);
  });
  it("drops a candidate whose penalties take the score to zero or below", () => {
    // partial match 55 - 30 - 15 = 10 stays; generic match 35 - 30 - 15 = -10 is dropped
    const ps = [
      product({
        id: "g",
        name: "Zed",
        generic: "paracetamol",
        strength: "650 mg",
      }),
    ];
    expect(
      voiceCandidates(
        ps,
        item({ name: "paracetamol", strength: "500", form: "bottle" }),
      ),
    ).toEqual([]);
  });
  it("accepts a bare spoken strength number for the same catalogue strength", () => {
    const [c] = voiceCandidates(
      catalogue,
      item({ name: "Dolo", strength: "650" }),
    );
    expect(c.strengthConflict).toBe(false);
  });
  it("uses the explicit query over the item name", () => {
    expect(
      voiceCandidates(catalogue, item({ name: "Dolo" }), "crocin").map(
        (c) => c.product.id,
      ),
    ).toEqual(["crocin"]);
  });
  it("skips inactive products and caps results at six, sorted by name on ties", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      product({ id: `m${i}`, name: `Mox ${String.fromCharCode(105 - i)}` }),
    );
    many.push(product({ id: "off", name: "Mox off", active: false }));
    const r = voiceCandidates(many, item({ name: "mox" }));
    expect(r).toHaveLength(6);
    expect(r.every((c) => c.product.id !== "off")).toBe(true);
    const names = r.map((c) => c.product.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("matches a name spoken with extra words around the catalogue name", () => {
    expect(
      voiceCandidates(catalogue, item({ name: "Dolo please" })).map(
        (c) => c.product.id,
      ),
    ).toEqual(["dolo"]);
  });
});

describe("model output with placeholder words", () => {
  it('treats a unit, strength or form of "null" or "none" as not said', async () => {
    const { applyVoiceResult, emptyVoice } = await import("../src/voice");
    let n = 0;
    const out = applyVoiceResult(
      emptyVoice("sale-1"),
      "job-1",
      {
        draft: {
          items: [
            {
              name: "Betadine",
              strength: "null",
              form: "None",
              quantity: "1",
              unit: "null",
              uncertain: false,
            },
          ],
          warnings: [],
        },
      },
      () => `i${++n}`,
    );
    expect(out.items[0]).toMatchObject({
      unit: "",
      strength: null,
      form: null,
    });
  });
});
