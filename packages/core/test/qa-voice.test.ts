import { it, expect } from "vitest";
import {
  spokenUnit,
  spokenItemTitle,
  applyVoiceResult,
  emptyVoice,
  NO_MEDICINES_WARNING,
} from "../src/voice";

// Speech-to-text spells "bottle" as "botal" and "sachet" as "सैशे"; both must reach the catalogue unit.
it("maps common speech-to-text spellings to the catalogue unit", () => {
  const p = (units: string[]) =>
    ({ units: Object.fromEntries(units.map((u) => [u, {}])) }) as any;
  expect(spokenUnit("botal", p(["bottle"]))).toBe("bottle");
  expect(spokenUnit("सैशे", p(["sachet"]))).toBe("sachet");
  expect(spokenUnit("sachet", p(["sachet"]))).toBe("sachet");
  // "packet" is deliberately not guessed to be a sachet (voice.test.ts).
  expect(spokenUnit("botal", p(["strip"]))).toBeNull();
});

it("matches spoken strip/patta to a differently-cased product unit", () => {
  const p = (units: string[]) =>
    ({ units: Object.fromEntries(units.map((u) => [u, {}])) }) as any;
  expect(spokenUnit("patta", p(["Strip", "tablet"]))).toBe("Strip");
  expect(spokenUnit("patta", p(["strip", "tablet"]))).toBe("strip");
  expect(spokenUnit("पत्ता", p(["strip"]))).toBe("strip");
});

it("does not repeat a strength the spoken name already carries", () => {
  expect(spokenItemTitle({ name: "Dolo 650", strength: "650mg" })).toBe(
    "Dolo 650",
  );
  expect(spokenItemTitle({ name: "Dolo", strength: "650mg" })).toBe(
    "Dolo 650mg",
  );
  expect(spokenItemTitle({ name: "Calpol 500", strength: "250 mg" })).toBe(
    "Calpol 500 250 mg",
  );
  expect(spokenItemTitle({ name: "Dolo", strength: null })).toBe("Dolo");
});

it("replaces model prose with a fixed warning when no items were heard", () => {
  const out = applyVoiceResult(
    emptyVoice("v"),
    "j1",
    {
      draft: {
        items: [],
        warnings: ["No items found. Please provide the actual dictation."],
      },
    },
    () => "i",
  );
  expect(out.warnings).toEqual([NO_MEDICINES_WARNING]);
});
