import { describe, it, expect } from "vitest";
import {
  demoState,
  spokenUnit,
  spokenQuantity,
  parseExactSaleText,
  voiceCandidates,
  emptyVoice,
  applyVoiceResult,
  consumeVoiceItem,
  type SaleEntry,
  type SpokenItem,
} from "../src";
const state = demoState(),
  products = Object.values(state.products);
const item: SpokenItem = {
  name: "Dolo",
  strength: "650 mg",
  form: "tablet",
  quantity: "six",
  unit: "goli",
  uncertain: false,
};
describe("Voice-assisted entry", () => {
  it("normalises Hindi, English quantities and known units without guessing ambiguous units", () => {
    expect(spokenQuantity("छह")).toBe("6");
    expect(spokenQuantity("१२")).toBe("12");
    expect(spokenQuantity("six")).toBe("6");
    expect(spokenQuantity("some")).toBe("");
    expect(spokenQuantity("-1")).toBe("");
    expect(spokenQuantity("0")).toBe("");
    expect(spokenUnit("गोलियाँ", state.products.dolo)).toBe("tablet");
    expect(spokenUnit("STRIPS", state.products.dolo)).toBe("strip");
    expect(spokenUnit("packet", state.products.ors)).toBeNull();
    expect(spokenUnit("", state.products.dolo)).toBeNull();
  });
  it("parses only explicit exact catalogue entries locally", () => {
    const result = parseExactSaleText(
      "Dolo 650 mg six goli; ORS 21 g १ sachet",
      products,
    );
    expect(result?.items.map((i) => [i.name, i.quantity, i.unit])).toEqual([
      ["Dolo", "6", "tablet"],
      ["ORS", "1", "sachet"],
    ]);
    expect(parseExactSaleText("Dolo 6 goli", products)).toBeNull();
    expect(
      parseExactSaleText("paracetamol 650 mg six tablets", products),
    ).toBeNull();
    expect(
      parseExactSaleText("Dolo 650 mg six, no four goli", products),
    ).toBeNull();
    expect(parseExactSaleText("Dolo 650 mg 6 packets", products)).toBeNull();
  });
  it("does not parse duplicate catalogue identities or inactive medicines as certain", () => {
    expect(
      parseExactSaleText("Dolo 650 mg 6 goli", [
        state.products.dolo,
        { ...state.products.dolo, id: "other" },
      ]),
    ).toBeNull();
    expect(
      parseExactSaleText("Dolo 650 mg 6 goli", [
        { ...state.products.dolo, active: false },
      ]),
    ).toBeNull();
  });
  it("ranks matching strength and exposes differing strengths without selecting a substitute", () => {
    const results = voiceCandidates(
      [
        state.products.dolo,
        { ...state.products.dolo, id: "dolo500", strength: "500 mg" },
      ],
      item,
    );
    expect(results[0].product.id).toBe("dolo");
    expect(results[1].strengthConflict).toBe(true);
    expect(
      voiceCandidates(products, { ...item, name: "nonexistent medicine" }),
    ).toEqual([]);
  });
  it("imports an API job only once, preserving pending items", () => {
    let id = 0;
    const first = applyVoiceResult(
      emptyVoice("sale"),
      "job",
      { transcript: "Dolo six goli", draft: { items: [item], warnings: [] } },
      () => `item-${++id}`,
    );
    const repeated = applyVoiceResult(
      first,
      "job",
      { draft: { items: [item], warnings: [] } },
      () => `item-${++id}`,
    );
    expect(repeated.items).toHaveLength(1);
    expect(repeated.items[0].id).toBe("item-1");
  });
  it("consumes a reviewed item and adds its basket line in one snapshot; duplicate consumption fails", () => {
    const voice = applyVoiceResult(
      emptyVoice("sale"),
      "job",
      { draft: { items: [item], warnings: [] } },
      () => "item-1",
    );
    const entry: SaleEntry = { basket: [], voice, checkoutInterrupted: false };
    const line = {
      batchId: "dolo-b1",
      quantity: "6",
      unit: "tablet",
      confirmed: true,
    };
    const next = consumeVoiceItem(entry, "item-1", line);
    expect(next.voice.items).toHaveLength(0);
    expect(next.basket).toEqual([line]);
    expect(() => consumeVoiceItem(next, "item-1", line)).toThrow("already");
    expect(entry.voice.items).toHaveLength(1);
  });
  it("rejects malformed or oversized model results instead of adding them to the basket", () => {
    expect(() =>
      applyVoiceResult(
        emptyVoice("sale"),
        "job",
        { draft: { items: [{ ...item, quantity: 6 }], warnings: [] } },
        () => "id",
      ),
    ).toThrow();
    expect(() =>
      applyVoiceResult(
        emptyVoice("sale"),
        "job",
        { draft: { items: Array(51).fill(item), warnings: [] } },
        () => "id",
      ),
    ).toThrow();
  });
});
