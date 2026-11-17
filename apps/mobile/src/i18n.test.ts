import { describe, it, expect } from "vitest";
import { labels } from "./i18n";
import { hindiCopy } from "./copy.hi";

const DEVANAGARI = /[ऀ-ॿ]/;
const en = labels.en as Record<string, string>;
const hi = labels.hi as Record<string, string>;

describe("labels", () => {
  it("has the same keys in English and Hindi", () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
  });
  it("has no empty or untrimmed labels", () => {
    for (const lang of [en, hi])
      for (const [k, v] of Object.entries(lang)) {
        expect(typeof v, k).toBe("string");
        expect(v.trim(), k).toBe(v);
        expect(v.length, k).toBeGreaterThan(0);
      }
  });
  it("gives every Hindi label Devanagari text, except where English is deliberately kept", () => {
    const allowed = new Set<string>([]);
    for (const [k, v] of Object.entries(hi))
      if (!allowed.has(k)) expect(DEVANAGARI.test(v), `${k}: ${v}`).toBe(true);
  });
  it("never leaves a Hindi label identical to the English one", () => {
    for (const k of Object.keys(en)) expect(hi[k], k).not.toBe(en[k]);
  });
  it("keeps Hindi and English punctuation endings in step", () => {
    for (const k of Object.keys(en)) {
      const e = en[k].match(/[.:?!]$/)?.[0];
      const h = hi[k].match(/[.:?!।]$/)?.[0];
      expect(h === undefined, `${k}: "${en[k]}" vs "${hi[k]}"`).toBe(
        e === undefined,
      );
    }
  });
  it("has no two English labels with the same text but different Hindi (translation lookup is by English text)", () => {
    // The app translates by looking the English text up, so duplicates must agree.
    const seen = new Map<string, string>();
    for (const k of Object.keys(en)) {
      const prior = seen.get(en[k]);
      if (prior !== undefined) expect(hi[k], `${k} ("${en[k]}")`).toBe(prior);
      else seen.set(en[k], hi[k]);
    }
  });
  it("uses Devanagari-only or Latin-only runs consistently: no stray replacement or control characters", () => {
    for (const lang of [en, hi])
      for (const [k, v] of Object.entries(lang))
        expect(/[�\u0000-\u001F​‎‏﻿]/.test(v), k).toBe(false);
  });
  it("stores text in composed form so equal-looking strings compare equal", () => {
    for (const [k, v] of Object.entries(hi))
      expect(v, k).toBe(v.normalize("NFC"));
  });
});

describe("hindiCopy", () => {
  const entries = Object.entries(hindiCopy);
  it("is a non-trivial table", () => {
    expect(entries.length).toBeGreaterThan(100);
  });
  it("has no empty keys or values and no padded whitespace", () => {
    for (const [k, v] of entries) {
      expect(k.trim(), JSON.stringify(k)).toBe(k);
      expect(k.length).toBeGreaterThan(0);
      expect(typeof v, k).toBe("string");
      expect(v.trim(), k).toBe(v);
      expect(v.length, k).toBeGreaterThan(0);
    }
  });
  it("translates into Devanagari", () => {
    for (const [k, v] of entries)
      expect(DEVANAGARI.test(v), `${k} -> ${v}`).toBe(true);
  });
  it("keeps every number, rupee amount and {placeholder} of the English", () => {
    const tokens = (t: string) =>
      (t.match(/\d+(?:\.\d+)?|\{[^}]*\}|%[sd]|₹/g) ?? []).sort();
    for (const [k, v] of entries) {
      const hindiDigits = v.replace(/[०-९]/g, (c) =>
        String(c.charCodeAt(0) - 0x966),
      );
      expect(tokens(hindiDigits), `${k} -> ${v}`).toEqual(tokens(k));
    }
  });
  it("keeps the English sentence-ending punctuation (a full stop may become . or ।)", () => {
    for (const [k, v] of entries) {
      const e = k.match(/[.?!:]$/)?.[0];
      const h = v.match(/[.?!:।]$/)?.[0];
      if (e === ".") expect(h, `${k} -> ${v}`).toBeDefined();
      if (e === "?") expect(h, `${k} -> ${v}`).toBe("?");
      if (e === ":") expect(h, `${k} -> ${v}`).toBe(":");
    }
  });
  it("does not contradict the label table for the same English text", () => {
    // ui.tsx spreads hindiCopy over the labels, so a disagreement would silently change a label.
    const byEnglish = new Map(Object.keys(en).map((k) => [en[k], hi[k]]));
    for (const [k, v] of entries) {
      const label = byEnglish.get(k);
      if (label !== undefined) expect(v, k).toBe(label);
    }
  });
  it("stores text in composed form", () => {
    for (const [k, v] of entries) expect(v, k).toBe(v.normalize("NFC"));
  });
  it("has no control or replacement characters", () => {
    for (const [k, v] of entries) {
      expect(/[�\u0000-\u001F​‎‏﻿]/.test(k + v), k).toBe(false);
    }
  });
  it("has no key that clashes with an Object.prototype property", () => {
    // ui.tsx looks translations up with `table[text]` on a plain object; a message equal to
    // "constructor" or "toString" would otherwise resolve to a function.
    for (const [k] of entries) expect(k in Object.prototype, k).toBe(false);
  });
});
