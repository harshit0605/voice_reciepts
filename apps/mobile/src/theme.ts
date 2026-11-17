// Register & Stamp: the shop's register, made live. See apps/mobile/DESIGN.md.
import { Platform } from "react-native";

/** Ink and paper. Every colour in the app comes from here. */
export const palette = {
  /** The register page: the ground of every screen. */
  paper: "#FFFFFF",
  /** The desk under the page: sheets' backdrop, quiet fills, input wells. */
  desk: "#F1F4F8",
  /** Black ink: primary text. */
  ink: "#14171C",
  /** Secondary text. 7.8:1 on paper. */
  ink2: "#495160",
  /** Tertiary text and placeholders. 4.9:1 on paper. */
  ink3: "#68707D",
  /** Pale-blue ruling: the only dividers. */
  rule: "#DCE3EE",
  /** Ruling that must read at a glance (input borders, the heavy total rule). */
  ruleStrong: "#B4C2D8",
  /** The register's red margin rule. 1px, never thicker. */
  margin: "#E0564A",
  /** Ballpoint blue: the one action colour. */
  blue: "#1F3FAA",
  bluePressed: "#17318A",
  blueTint: "#E9EEFB",
  /** Stamp inks, by meaning. */
  approved: "#5B3FB2",
  approvedTint: "#F0ECFA",
  declined: "#BF3428",
  declinedTint: "#FCEBE9",
  paid: "#16774A",
  paidTint: "#E5F3EB",
  waiting: "#935600",
  waitingTint: "#FDF1DC",
  /** Scrim behind sheets. */
  scrim: "rgba(16, 22, 34, 0.42)",
} as const;

/** Each person's mark colour, picked from their id so it never changes. */
export const staffInks = [
  "#1F3FAA",
  "#16774A",
  "#9C2F6C",
  "#935600",
  "#5B3FB2",
  "#0E6E7C",
] as const;

export function staffInk(id: string | undefined) {
  if (!id) return palette.ink3;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return staffInks[h % staffInks.length];
}

export function initials(name: string | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : ""))
    .toUpperCase();
}

/** Anek Devanagari (Ek Type) carries Hindi and English with matched forms and tabular figures. */
export const fonts = {
  regular: "AnekDevanagari_400Regular",
  medium: "AnekDevanagari_500Medium",
  semibold: "AnekDevanagari_600SemiBold",
  bold: "AnekDevanagari_700Bold",
} as const;

export type Weight = 400 | 500 | 600 | 700;
export function fontFor(weight: Weight) {
  return weight >= 700
    ? fonts.bold
    : weight >= 600
      ? fonts.semibold
      : weight >= 500
        ? fonts.medium
        : fonts.regular;
}

/**
 * Type scale (sp). Anek sets small, so the floor is 12 and body is 16.
 * total: the big money figure · title: screen title · heading: section ·
 * body: reading text · label: field labels, row secondary · small · micro: stamps.
 */
export const type = {
  total: { size: 40, line: 46, weight: 700 as Weight },
  title: { size: 28, line: 34, weight: 700 as Weight },
  heading: { size: 19, line: 25, weight: 600 as Weight },
  body: { size: 16, line: 22, weight: 400 as Weight },
  label: { size: 14, line: 19, weight: 500 as Weight },
  small: { size: 13, line: 18, weight: 400 as Weight },
  micro: { size: 12, line: 15, weight: 600 as Weight },
} as const;

/** 4-pt spacing. Gutters are 20 on phones. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
  gutter: 20,
} as const;

export const radius = { sm: 6, md: 10, lg: 14, sheet: 22, pill: 999 } as const;

/** The fixed time column of a register row. */
export const TIME_COLUMN = 52;

/** Touch targets: 48 on Android, 44 on iOS; we use 48 everywhere. */
export const TOUCH = 48;

export const shadow = Platform.select({
  ios: {
    shadowColor: "#0F1A2E",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 6 },
  default: {
    shadowColor: "#0F1A2E",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
});
