import { describe, it, expect, vi } from "vitest";

// theme.ts only touches react-native for Platform.select (shadows); the colour and name helpers are pure.
vi.mock("react-native", () => ({
  Platform: { OS: "web", select: (o: Record<string, unknown>) => o.default },
}));

import {
  palette,
  staffInk,
  staffInks,
  initials,
  fontFor,
  fonts,
  type,
  space,
  TOUCH,
} from "./theme";

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("initials", () => {
  it("uses the first letters of the first and last word, uppercased", () => {
    expect(initials("ravi kumar")).toBe("RK");
    expect(initials("Ravi Kumar Sharma")).toBe("RS");
    expect(initials("Dr. Rao")).toBe("DR");
  });
  it("uses a single letter for a single name", () => {
    expect(initials("Meena")).toBe("M");
    expect(initials("meena")).toBe("M");
  });
  it("copes with extra and unusual whitespace", () => {
    expect(initials("  Ravi    Kumar  ")).toBe("RK");
    expect(initials("Ravi\tKumar\nSharma")).toBe("RS");
    expect(initials("Ravi Kumar")).toBe("RK");
  });
  it("returns ? for missing, empty or blank names", () => {
    expect(initials(undefined)).toBe("?");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
    expect(initials("\n\t")).toBe("?");
  });
  it("handles Devanagari names, which have no case", () => {
    expect(initials("राहुल शर्मा")).toBe("रश");
    expect(initials("मीना")).toBe("म");
  });
  it("handles Latin letters with accents and mixed scripts", () => {
    expect(initials("élodie dupont")).toBe("ÉD");
    expect(initials("Ravi शर्मा")).toBe("Rश");
  });
  it("keeps the first and last word for hyphenated and apostrophe names", () => {
    expect(initials("Mary-Jane O'Neil")).toBe("MO");
  });
  it("a leading punctuation mark becomes the initial rather than being skipped", () => {
    // documents current behaviour: "(Ravi)" -> "("
    expect(initials("(Ravi) Kumar")).toBe("(K");
  });
  // Regression (fixed 2026-11-17): initials() indexes UTF-16 code units (`parts[0][0]`), so a name that starts
  // with a character outside the Basic Multilingual Plane (an emoji, or a rare astral letter)
  // yields half a surrogate pair, which renders as a replacement box. theme.ts:60.
  it("does not split an astral first character in half", () => {
    const out = initials("😀 Ravi");
    expect(out.length === 0 || /^[\u{1F600}-\u{1F64F}]/u.test(out)).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });
  it("uppercasing does not expand a letter into two ('ß' stays a single initial)", () => {
    expect(initials("ßeta").length).toBe(1);
  });
});

describe("staffInk", () => {
  it("is stable for the same id and always one of the staff inks", () => {
    for (const id of [
      "demo-owner",
      "demo-employee",
      "a",
      "ʼunicode-id",
      "राहुल",
      "x".repeat(10_000),
    ]) {
      expect(staffInk(id)).toBe(staffInk(id));
      expect(staffInks as readonly string[]).toContain(staffInk(id));
    }
  });
  it("falls back to the tertiary ink for a missing or empty id", () => {
    expect(staffInk(undefined)).toBe(palette.ink3);
    expect(staffInk("")).toBe(palette.ink3);
  });
  it("matches the documented hash (31-multiplier over UTF-16 code units, mod 6)", () => {
    // "a" = 97 -> 97 % 6 = 1 ; "ab" = 97*31 + 98 = 3105 -> 3105 % 6 = 3
    expect(staffInk("a")).toBe(staffInks[1]);
    expect(staffInk("ab")).toBe(staffInks[3]);
  });
  it("spreads a realistic set of ids over most of the palette", () => {
    const used = new Set(
      Array.from({ length: 60 }, (_, i) => staffInk(`user-${i}`)),
    );
    expect(used.size).toBeGreaterThanOrEqual(5);
  });
  it("does not overflow into NaN or an out-of-range index for very long ids", () => {
    expect(staffInks as readonly string[]).toContain(
      staffInk("￿".repeat(100_000)),
    );
  });
  it("each staff ink is legible as text on the white page (WCAG AA, 4.5:1)", () => {
    for (const c of staffInks)
      expect(contrast(c, palette.paper), c).toBeGreaterThanOrEqual(4.5);
  });
});

describe("fontFor", () => {
  it("maps each weight to its Anek face", () => {
    expect(fontFor(400)).toBe(fonts.regular);
    expect(fontFor(500)).toBe(fonts.medium);
    expect(fontFor(600)).toBe(fonts.semibold);
    expect(fontFor(700)).toBe(fonts.bold);
  });
  it("rounds odd weights down to the nearest face and clamps out-of-range ones", () => {
    expect(fontFor(450 as never)).toBe(fonts.regular);
    expect(fontFor(550 as never)).toBe(fonts.medium);
    expect(fontFor(900 as never)).toBe(fonts.bold);
    expect(fontFor(100 as never)).toBe(fonts.regular);
  });
});

describe("palette and scale", () => {
  it("documents contrast that is actually met", () => {
    expect(contrast(palette.ink2, palette.paper)).toBeGreaterThanOrEqual(7.5); // "7.8:1"
    expect(contrast(palette.ink3, palette.paper)).toBeGreaterThanOrEqual(4.5); // "4.9:1"
    expect(contrast(palette.ink, palette.paper)).toBeGreaterThanOrEqual(15);
  });
  it("stamp inks are legible on their own tints", () => {
    for (const [ink, tint] of [
      [palette.approved, palette.approvedTint],
      [palette.declined, palette.declinedTint],
      [palette.paid, palette.paidTint],
      [palette.waiting, palette.waitingTint],
      [palette.blue, palette.blueTint],
    ] as const)
      expect(contrast(ink, tint), `${ink} on ${tint}`).toBeGreaterThanOrEqual(
        4.5,
      );
  });
  it("white text on the action blue and its pressed state is legible", () => {
    expect(contrast("#FFFFFF", palette.blue)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#FFFFFF", palette.bluePressed)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
  it("keeps every colour a six-digit hex (scrim aside) and the type scale readable", () => {
    for (const [k, v] of Object.entries(palette))
      if (k !== "scrim") expect(v, k).toMatch(/^#[0-9A-F]{6}$/);
    for (const [k, t] of Object.entries(type)) {
      expect(t.size, k).toBeGreaterThanOrEqual(12);
      expect(t.line, k).toBeGreaterThanOrEqual(t.size);
    }
    expect(TOUCH).toBeGreaterThanOrEqual(48);
    for (const v of Object.values(space)) expect(v % 4, String(v)).toBe(0);
  });
});
