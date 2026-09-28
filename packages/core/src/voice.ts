import { z } from "zod";
import type { Product, OrderLine } from "./types";
import type { CheckoutAttempt } from "./checkout-recovery";
export const voiceItemSchema = z.object({
  name: z.string().max(180),
  strength: z.string().max(60).nullable(),
  form: z.string().max(60).nullable(),
  quantity: z.string().max(40),
  unit: z.string().max(40),
  uncertain: z.boolean(),
});
export const voiceDraftSchema = z.object({
  items: z.array(voiceItemSchema).max(50),
  warnings: z.array(z.string().max(500)).max(30),
});
export type SpokenItem = z.infer<typeof voiceItemSchema>;
export type VoiceWork = {
  id: string;
  input: string;
  transcript: string;
  items: (SpokenItem & { id: string })[];
  warnings: string[];
  jobId?: string;
  appliedJobIds: string[];
  error?: string;
  source?: "local" | "api" | "sample";
};
export type SaleEntry = {
  basket: OrderLine[];
  voice: VoiceWork;
  /** Only drafts saved before `checkout` existed set this; they still need the manual Orders check. */
  checkoutInterrupted: boolean;
  checkout?: CheckoutAttempt;
};
export function emptyVoice(id: string): VoiceWork {
  return {
    id,
    input: "",
    transcript: "",
    items: [],
    warnings: [],
    appliedJobIds: [],
  };
}
export const normalVoice = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x966))
    .replace(/[^\p{L}\p{N}.]/gu, "");
const units: Record<string, string> = {
  goli: "tablet",
  goliyan: "tablet",
  गोली: "tablet",
  गोलियां: "tablet",
  गोलियाँ: "tablet",
  tablets: "tablet",
  tab: "tablet",
  tabs: "tablet",
  strips: "strip",
  patti: "strip",
  पत्ती: "strip",
  पत्ते: "strip",
  strip: "strip",
  bottles: "bottle",
  bottle: "bottle",
  बोतल: "bottle",
  capsules: "capsule",
  caps: "capsule",
  कैप्सूल: "capsule",
  sachets: "sachet",
  pieces: "piece",
  pcs: "piece",
  boxes: "box",
};
export function spokenUnit(value: string, product: Product): string | null {
  const valueKey = normalVoice(value);
  const direct = Object.keys(product.units).find(
    (u) => normalVoice(u) === valueKey,
  );
  if (direct) return direct;
  const canonical = units[value.trim().toLowerCase()] ?? units[valueKey];
  return canonical && product.units[canonical] ? canonical : null;
}
const numbers: Record<string, string> = {
  half: "0.5",
  आधा: "0.5",
  आधी: "0.5",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  एक: "1",
  दो: "2",
  तीन: "3",
  चार: "4",
  पांच: "5",
  पाँच: "5",
  छह: "6",
  छः: "6",
  सात: "7",
  आठ: "8",
  नौ: "9",
  दस: "10",
  eleven: "11",
  twelve: "12",
  fifteen: "15",
  twenty: "20",
  thirty: "30",
  ग्यारह: "11",
  बारह: "12",
  पंद्रह: "15",
  बीस: "20",
  तीस: "30",
  "a dozen": "12",
  dozen: "12",
};
/** A spoken quantity shown for review: "दस" → "10", unknown words unchanged. */
export function readableQuantity(value: string) {
  return spokenQuantity(value) || value;
}
/** Units said in Hindi or plural shown as the catalogue's word: "गोलियां" → "tablet". */
export function readableUnit(value: string) {
  const key = value.trim().toLowerCase();
  return units[key] ?? units[normalVoice(value)] ?? value;
}
export function spokenQuantity(value: string): string {
  const v = value
    .trim()
    .toLowerCase()
    .replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x966));
  const n = numbers[v] ?? v;
  return /^(?:[1-9]\d{0,5}|0)(?:\.\d{1,3})?$/.test(n) && Number(n) > 0 ? n : "";
}
/**
 * Spoken strengths often drop the unit ("Dolo 650" for 650 mg). A bare number agrees with a
 * catalogue strength that starts with that number; anything else must match exactly.
 */
export function sameStrength(spoken: string, catalogue: string) {
  const heard = normalVoice(spoken);
  if (heard === normalVoice(catalogue)) return true;
  if (!/^\d+(?:\.\d+)?$/.test(heard)) return false;
  const first = catalogue.match(/\d+(?:\.\d+)?/)?.[0];
  return first !== undefined && Number(first) === Number(heard);
}
export function voiceCandidates(
  products: Product[],
  item: SpokenItem,
  query?: string,
) {
  const term = normalVoice(query ?? item.name);
  if (!term) return [];
  return products
    .filter((p) => p.active)
    .map((p) => {
      const name = normalVoice(p.name),
        full = normalVoice(`${p.name} ${p.strength}`);
      const aliases = p.aliases.map(normalVoice);
      let score =
        term === full
          ? 100
          : term === name
            ? 90
            : aliases.includes(term)
              ? 70
              : name.includes(term) || term.includes(name)
                ? 55
                : normalVoice(p.generic).includes(term)
                  ? 35
                  : 0;
      const strengthConflict =
        !!item.strength && !sameStrength(item.strength, p.strength);
      const formConflict =
        !!item.form && normalVoice(item.form) !== normalVoice(p.form);
      if (strengthConflict) score -= 30;
      if (formConflict) score -= 15;
      return { product: p, score, strengthConflict, formConflict };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.product.name.localeCompare(b.product.name),
    )
    .slice(0, 6);
}
// Deliberately narrow grammar. No fuzzy identity resolution, inferred strengths,
// spoken corrections, or generic substitutions on the no-API path.
export function parseExactSaleText(
  text: string,
  products: Product[],
): z.infer<typeof voiceDraftSchema> | null {
  const parts = text
    .trim()
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 50) return null;
  const items: SpokenItem[] = [];
  for (const part of parts) {
    const m = part.match(/^(.+?)\s+([^\s]+)\s+([^\s]+)$/u);
    if (!m) return null;
    const candidates = products.filter(
      (p) =>
        p.active &&
        normalVoice(`${p.name} ${p.strength}`) === normalVoice(m[1]),
    );
    if (candidates.length !== 1) return null;
    const p = candidates[0],
      q = spokenQuantity(m[2]),
      u = spokenUnit(m[3], p);
    if (!q || !u) return null;
    items.push({
      name: p.name,
      strength: p.strength || null,
      form: p.form || null,
      quantity: q,
      unit: u,
      uncertain: false,
    });
  }
  return { items, warnings: [] };
}
export function applyVoiceResult(
  work: VoiceWork,
  jobId: string,
  output: { transcript?: string; draft: unknown },
  id: () => string,
): VoiceWork {
  if (work.appliedJobIds.includes(jobId)) return { ...work, jobId: undefined };
  const draft = voiceDraftSchema.parse(output.draft);
  return {
    ...work,
    jobId: undefined,
    transcript: output.transcript ?? work.input,
    items: [
      ...work.items,
      ...draft.items.map((item) => ({ ...item, id: id() })),
    ],
    warnings: draft.warnings,
    appliedJobIds: [...work.appliedJobIds, jobId].slice(-100),
    error: undefined,
    source: "api",
  };
}
export function consumeVoiceItem(
  entry: SaleEntry,
  itemId: string,
  line: OrderLine,
): SaleEntry {
  if (!entry.voice.items.some((i) => i.id === itemId))
    throw new Error("This spoken item has already been added or removed");
  return {
    ...entry,
    basket: [...entry.basket, line],
    voice: {
      ...entry.voice,
      items: entry.voice.items.filter((i) => i.id !== itemId),
    },
  };
}
