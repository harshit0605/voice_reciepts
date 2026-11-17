import { it, expect } from "vitest";
import { spokenUnit } from "../src/voice";

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
