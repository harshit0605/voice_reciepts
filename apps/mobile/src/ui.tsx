import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Text,
  View,
  Pressable,
  TextInput,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Animated,
  Easing,
  AccessibilityInfo,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "./session";
import { labels, type Label } from "./i18n";
import { hindiCopy } from "./copy.hi";
import {
  palette,
  fontFor,
  type Weight,
  space,
  radius,
  TIME_COLUMN,
  TOUCH,
  staffInk,
  initials,
  shadow,
} from "./theme";
export { palette, space, radius, staffInk, initials } from "./theme";
const englishToHindi: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(labels.en).map(([k, v]) => [v, labels.hi[k as Label]]),
  ),
  ...hindiCopy,
};
/** A single word such as a unit name, in the current language, for use inside a longer text. */
/** "1 item" / "3 items", or "1 दवा" / "3 दवाएँ". */
export function itemCount(n: number, language: string) {
  return language === "hi"
    ? `${n} ${n === 1 ? "दवा" : "दवाएँ"}`
    : `${n} ${n === 1 ? "item" : "items"}`;
}
export function useWord() {
  const { language } = useSession();
  return (word: string) =>
    language === "hi" && Object.hasOwn(englishToHindi, word)
      ? englishToHindi[word]
      : word;
}
function translateCopy(value: any, language: string): any {
  if (language !== "hi") return value;
  if (typeof value === "string") {
    const trim = value.trim();
    if (Object.hasOwn(englishToHindi, trim))
      return value.replace(trim, englishToHindi[trim]);
    // Drawer differences from core's differenceText: "₹50.00 short" / "₹20.00 over".
    const diff = /^(₹[\d,.]+) (short|over)$/.exec(trim);
    return diff
      ? value.replace(
          trim,
          `${diff[1]} ${diff[2] === "short" ? "कम" : "ज़्यादा"}`,
        )
      : value;
  }
  return Array.isArray(value)
    ? value.map((v) => translateCopy(v, language))
    : value;
}
/**
 * Anek kerns "·" against the space after it, so "a · b" printed as "a ·b". Its bullet operator
 * has the same shape without the kerning.
 */
function fixDots(value: any): any {
  if (typeof value === "string") return value.replace(/\u00B7/g, "\u2219");
  return Array.isArray(value) ? value.map(fixDots) : value;
}
/**
 * Colours. The legacy names (bg, muted, accent, tint, amber, red…) still work and map onto the
 * Register & Stamp palette; new code should use the palette names (paper, ink2, blue, approved…).
 */
export const colors = {
  ...palette,
  bg: palette.paper,
  surface: palette.paper,
  muted: palette.ink3,
  line: palette.rule,
  accent: palette.blue,
  tint: palette.blueTint,
  amber: palette.waiting,
  amberBg: palette.waitingTint,
  red: palette.declined,
  green: palette.paid,
};
export function useText() {
  const { language } = useSession();
  return (key: Label) => labels[language][key];
}
/**
 * Text. `size` in sp (floor 12), `bold` = 600, or `weight` 400–700. `num` sets tabular figures
 * for amounts and counts. `muted` = tertiary ink; pass `color` for anything else.
 */
export function Txt({
  children,
  muted = false,
  size = 16,
  bold = false,
  weight,
  num = false,
  color,
  center = false,
  style,
  ...rest
}: any) {
  const { language } = useSession();
  const px = Math.max(12, size);
  const w: Weight = weight ?? (bold ? 600 : 400);
  return (
    <Text
      maxFontSizeMultiplier={1.4}
      {...rest}
      style={[
        {
          fontFamily: fontFor(w),
          fontSize: px,
          // Devanagari marks rise to 0.98 em above the baseline: give Hindi the full line.
          lineHeight: Math.round(
            px * (px >= 26 ? (language === "hi" ? 1.45 : 1.2) : 1.45),
          ),
          color: color ?? (muted ? palette.ink3 : palette.ink),
          ...(Platform.OS === "web" ? { fontWeight: String(w) as any } : {}),
          ...(num ? { fontVariant: ["tabular-nums" as const] } : {}),
          ...(center ? { textAlign: "center" as const } : {}),
        },
        style,
      ]}
    >
      {fixDots(translateCopy(children, language))}
    </Text>
  );
}
/**
 * A rupee amount, figures tabular, the paise set smaller so the rupees read first:
 * "₹2,257" big, ".00" small. Takes the formatted string from `rupees()`.
 */
export function Amount({
  value,
  size = 16,
  weight = 600,
  color,
  style,
}: {
  value: string;
  size?: number;
  weight?: Weight;
  color?: string;
  style?: any;
}) {
  const m = /^(.*?)(\.\d\d)$/.exec(value);
  if (!m || size < 22)
    return (
      <Txt num size={size} weight={weight} color={color} style={style}>
        {value}
      </Txt>
    );
  return (
    <Txt num size={size} weight={weight} color={color} style={style}>
      {m[1]}
      <Txt
        num
        size={Math.round(size * 0.52)}
        weight={500}
        color={color ?? palette.ink2}
      >
        {m[2]}
      </Txt>
    </Txt>
  );
}
export function Icon({
  name,
  size = 20,
  color = palette.ink3,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
/**
 * Buttons. primary: filled ballpoint blue, one per screen region. secondary: blue on tint.
 * quiet: blue text only. danger: red outline; keep it apart from other buttons.
 */
export function Button({
  children,
  onPress,
  secondary = false,
  variant,
  disabled = false,
  icon,
  small = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  secondary?: boolean;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  small?: boolean;
}) {
  const v: ButtonVariant = variant ?? (secondary ? "secondary" : "primary");
  const fg =
    v === "primary"
      ? "#FFFFFF"
      : v === "danger"
        ? palette.declined
        : palette.blue;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: small ? 44 : 52,
          paddingHorizontal: small ? 14 : 20,
          backgroundColor:
            v === "primary"
              ? pressed
                ? palette.bluePressed
                : palette.blue
              : v === "secondary"
                ? palette.blueTint
                : "transparent",
          borderWidth: v === "danger" ? 1 : 0,
          borderColor: palette.declined,
          opacity: disabled ? 0.4 : pressed && v !== "primary" ? 0.65 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      {icon && <Icon name={icon} color={fg} size={small ? 17 : 19} />}
      <Txt weight={600} size={small ? 14 : 16} color={fg} center>
        {children}
      </Txt>
    </Pressable>
  );
}
/**
 * A text input's own copy of what was typed. When the screen re-renders slowly (a sync or a banner
 * update while typing fast or scanning a barcode), the parent can hand back an older value than
 * the one just typed, and a plain controlled input would reset to it and lose characters. Values
 * this input emitted itself are echoes and ignored; any other value is a real change from outside
 * (a reset after saving, a scanned code) and replaces the text.
 */
export function useBufferedText(value: string, onChange: (v: string) => void) {
  const [text, setText] = useState(value);
  const emitted = useRef<string[]>([]);
  useEffect(() => {
    const echo = emitted.current.lastIndexOf(value);
    if (echo >= 0) {
      emitted.current = emitted.current.slice(echo + 1);
      return;
    }
    emitted.current = [];
    setText(value);
  }, [value]);
  return {
    value: text,
    change: (next: string) => {
      emitted.current.push(next);
      if (emitted.current.length > 50) emitted.current.shift();
      setText(next);
      onChange(next);
    },
  };
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  number = false,
  secret = false,
  multiline = false,
  identifier = false,
  inputRef,
  returnKeyType,
  onSubmit,
  hint,
  error,
  autoCorrect = false,
}: {
  label?: string;
  /** Opt in to keyboard autocorrect and spell check for free text. Off by default: medicine names, strengths, batch codes and phone numbers must never be "corrected". */
  autoCorrect?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  number?: boolean;
  secret?: boolean;
  multiline?: boolean;
  /** A username, code or address: the keyboard must not "correct" it ("shopowner" became "shop owner"). */
  identifier?: boolean;
  /** For moving focus to the next field and submitting from the keyboard. */
  inputRef?: React.Ref<TextInput>;
  returnKeyType?: "next" | "go" | "done";
  onSubmit?: () => void;
  /** A line of help under the field. */
  hint?: string;
  /** What is wrong with the value and how to fix it. */
  error?: string;
}) {
  const { language } = useSession();
  const [focused, setFocused] = useState(false);
  const text = useBufferedText(value, onChange);
  return (
    <View style={{ gap: 6, marginBottom: 16 }}>
      {label && (
        <Txt size={14} weight={500} color={palette.ink2}>
          {label}
        </Txt>
      )}
      <TextInput
        ref={inputRef}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={translateCopy(label ?? placeholder, language)}
        value={text.value}
        onChangeText={text.change}
        placeholder={translateCopy(placeholder, language)}
        placeholderTextColor={palette.ink3}
        selectionColor={palette.blue}
        cursorColor={palette.blue}
        keyboardType={number ? "decimal-pad" : "default"}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={autoCorrect && !identifier && !secret}
        spellCheck={autoCorrect && !identifier && !secret}
        multiline={multiline}
        maxFontSizeMultiplier={1.4}
        style={[
          styles.input,
          number && { fontVariant: ["tabular-nums"] },
          focused && {
            borderColor: palette.blue,
            borderWidth: 2,
            paddingHorizontal: 13,
          },
          !!error && { borderColor: palette.declined },
          multiline && {
            minHeight: 104,
            textAlignVertical: "top",
            paddingTop: 13,
          },
        ]}
      />
      {(error || hint) && (
        <Txt size={13} color={error ? palette.declined : palette.ink3}>
          {error || hint}
        </Txt>
      )}
    </View>
  );
}
/** A choice among a few: unit, payment method, filter. Selected = filled blue. */
export function Chip({ children, active = false, onPress }: any) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? palette.blue : palette.paper,
          borderColor: active ? palette.blue : palette.ruleStrong,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Txt
        size={14}
        weight={active ? 600 : 500}
        color={active ? "#FFFFFF" : palette.ink2}
      >
        {children}
      </Txt>
    </Pressable>
  );
}
export type Tone =
  "info" | "waiting" | "approved" | "declined" | "paid" | "neutral";
export const toneInk: Record<Tone, [string, string]> = {
  info: [palette.blue, palette.blueTint],
  waiting: [palette.waiting, palette.waitingTint],
  approved: [palette.approved, palette.approvedTint],
  declined: [palette.declined, palette.declinedTint],
  paid: [palette.paid, palette.paidTint],
  neutral: [palette.ink2, palette.desk],
};
/** A small inked label: a state, a count, a tag. `warning` = waiting. */
export function Badge({
  children,
  warning = false,
  tone,
}: {
  children: React.ReactNode;
  warning?: boolean;
  tone?: Tone;
}) {
  const [ink, tint] = toneInk[tone ?? (warning ? "waiting" : "info")];
  return (
    <View
      style={{
        backgroundColor: tint,
        borderColor: ink,
        borderWidth: StyleSheet.hairlineWidth * 2,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: radius.sm,
        alignSelf: "flex-start",
      }}
    >
      <Txt size={12} weight={600} color={ink} num>
        {children}
      </Txt>
    </View>
  );
}
function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => live && setReduce(r))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      setReduce,
    );
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}
/**
 * The rubber stamp: a decision, inked. Double-ruled border in the stamp's ink, capitals, a date
 * line. `land` plays the signature motion once: the stamp comes down and settles.
 */
export function Stamp({
  children,
  tone = "approved",
  date,
  land = false,
  tilt = true,
  size = "md",
}: {
  children: React.ReactNode;
  tone?: Tone;
  date?: string;
  land?: boolean;
  tilt?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [ink] = toneInk[tone];
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(land ? 0 : 1)).current;
  useEffect(() => {
    if (!land) return;
    if (reduce) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [land, reduce]);
  const font = size === "lg" ? 22 : size === "sm" ? 12 : 15;
  const rotate = tilt ? "-4deg" : "0deg";
  return (
    <Animated.View
      accessibilityRole="text"
      style={{
        alignSelf: "flex-start",
        opacity: progress,
        transform: [
          { rotate },
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1.7, 1],
            }),
          },
        ],
      }}
    >
      <View
        style={{
          borderWidth: size === "sm" ? 1.5 : 2,
          borderColor: ink,
          borderRadius: radius.sm,
          padding: size === "sm" ? 1.5 : 2.5,
        }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: ink,
            borderRadius: 3,
            paddingHorizontal: size === "lg" ? 16 : size === "sm" ? 6 : 10,
            paddingVertical: size === "lg" ? 6 : size === "sm" ? 1 : 3,
            alignItems: "center",
          }}
        >
          <Txt
            size={font}
            weight={700}
            color={ink}
            style={{ letterSpacing: font * 0.08, textTransform: "uppercase" }}
          >
            {children}
          </Txt>
          {date && (
            <Txt
              size={12}
              weight={600}
              color={ink}
              num
              style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
            >
              {date}
            </Txt>
          )}
        </View>
      </View>
    </Animated.View>
  );
}
/** "17 NOV · 12:49" for stamps and register entries. */
export function stampDate(at: string | number | Date, language = "en") {
  const d = new Date(at);
  const day = d.toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
  });
  return `${day} · ${clock(d)}`;
}
/**
 * A customer's mobile number as ten digits, or null when it is not one. Spaces, dashes and a
 * +91 / 91 / 0 prefix are allowed; an empty entry is fine (returns ""). Indian mobiles start 6-9.
 */
export function indianMobile(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "";
  if (!/^\+?[\d\s-]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0"))
    digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
/** "17 Nov 2026, 22:11": a full date and time in IST, 24-hour like the rest of the app. */
export function dateTime24(at: string | number | Date) {
  return new Date(at).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
/** The core device label ("Aarav · iPhone · bills 004") in Hindi when the app is. */
export function deviceText(label: string, language: string) {
  return language === "hi"
    ? label
        .replace(" · bills ", " · बिल ")
        .replace("Android phone", "एंड्रॉइड फ़ोन")
        .replace("Preview device", "डेमो फ़ोन")
        .replace(/^Unknown/, "अज्ञात")
    : label;
}
/** "12:49" (24-hour, like a register). */
export function clock(at: string | number | Date) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** A person's mark: their initials in their own ink, beside every entry they made. */
export function StaffMark({
  id,
  name,
  size = 26,
}: {
  id?: string;
  name?: string;
  size?: number;
}) {
  const ink = staffInk(id ?? name);
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: ink,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Txt
        size={Math.max(12, Math.round(size * 0.42))}
        weight={700}
        color={ink}
      >
        {initials(name)}
      </Txt>
    </View>
  );
}
export function Row({ children, style }: any) {
  return (
    <View
      style={[{ flexDirection: "row", alignItems: "center", gap: 12 }, style]}
    >
      {children}
    </View>
  );
}
/** A titled block of the page. The heading sits on a firmer rule; rows follow. */
export function Section({ title, action, children }: any) {
  return (
    <View style={{ marginBottom: 32 }}>
      <Row
        style={{
          justifyContent: "space-between",
          paddingBottom: 8,
          marginBottom: 4,
          borderBottomWidth: 1,
          borderColor: palette.ruleStrong,
          minHeight: 36,
        }}
      >
        <Txt size={19} weight={600} style={{ flexShrink: 1 }}>
          {title}
        </Txt>
        {action}
      </Row>
      {children}
    </View>
  );
}
/**
 * A register entry: time in the fixed left column, the red margin rule, then what happened and
 * who did it, and the amount locked to the right edge.
 */
export function Entry({
  time,
  title,
  detail,
  who,
  amount,
  amountColor,
  trailing,
  onPress,
  children,
}: {
  time?: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
  who?: { id?: string; name?: string };
  amount?: string;
  amountColor?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const head = (
    <>
      {/* Only the title line shares its width with the mark and amount; the detail and any
          actions below run the full width of the entry. */}
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          {typeof title === "string" ? (
            <Txt size={16} weight={600}>
              {title}
            </Txt>
          ) : (
            title
          )}
        </View>
        {who && <StaffMark id={who.id} name={who.name} size={24} />}
        {amount !== undefined && (
          <Amount value={amount} size={16} color={amountColor} />
        )}
        {trailing}
      </Row>
      {typeof detail === "string" ? (
        <Txt size={14} color={palette.ink2}>
          {detail}
        </Txt>
      ) : (
        detail
      )}
    </>
  );
  const hasActions = !!children;
  // The tappable part is the title and detail only. Actions (buttons) sit beside it, not
  // inside it: a button inside a button is invalid on the web and unreliable to tap.
  const headStyle = {
    gap: 4,
    paddingTop: 12,
    paddingBottom: hasActions ? 4 : 12,
  } as const;
  return (
    <View style={{ borderBottomWidth: 1, borderColor: palette.rule }}>
      <View style={{ flexDirection: "row", minHeight: 60 }}>
        <View style={{ width: TIME_COLUMN, paddingTop: 15 }}>
          <Txt size={13} num weight={500} color={palette.ink3}>
            {time ?? ""}
          </Txt>
        </View>
        <View
          style={{
            flex: 1,
            borderLeftWidth: 1,
            borderLeftColor: palette.margin,
            paddingLeft: 12,
          }}
        >
          {onPress ? (
            <Pressable
              onPress={onPress}
              accessibilityRole="button"
              style={({ pressed }) => ({
                ...headStyle,
                backgroundColor: pressed ? palette.desk : "transparent",
              })}
            >
              {head}
            </Pressable>
          ) : (
            <View style={headStyle}>{head}</View>
          )}
          {hasActions && (
            <View style={{ gap: 4, paddingBottom: 12 }}>{children}</View>
          )}
        </View>
      </View>
    </View>
  );
}
/** A plain ruled list row for things that are not dated entries (medicines, people, settings). */
export function ListRow({
  leading,
  title,
  detail,
  trailing,
  onPress,
  chevron = !!onPress,
  children,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  children?: React.ReactNode;
}) {
  const body = (
    <View style={{ paddingVertical: 13, gap: 8, minHeight: 60 }}>
      <Row>
        {leading}
        <View style={{ flex: 1, gap: 2 }}>
          {typeof title === "string" ? (
            <Txt size={16} weight={600}>
              {title}
            </Txt>
          ) : (
            title
          )}
          {typeof detail === "string" ? (
            <Txt size={14} color={palette.ink2}>
              {detail}
            </Txt>
          ) : (
            detail
          )}
        </View>
        {trailing}
        {chevron && (
          <Icon name="chevron-forward" size={18} color={palette.ink3} />
        )}
      </Row>
      {children}
    </View>
  );
  return (
    <View style={{ borderBottomWidth: 1, borderColor: palette.rule }}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          style={({ pressed }) => ({
            backgroundColor: pressed ? palette.desk : "transparent",
          })}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}
/** A label-and-figure line in a statement (day report, totals). Figures end on the right edge. */
export function Line({
  label,
  value,
  strong = false,
  color,
  note,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
  color?: string;
  note?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
        paddingVertical: 9,
        gap: 12,
        borderBottomWidth: 1,
        borderColor: palette.rule,
      }}
    >
      <View style={{ flex: 1 }}>
        {typeof label === "string" ? (
          <Txt
            size={15}
            weight={strong ? 600 : 400}
            color={strong ? palette.ink : palette.ink2}
          >
            {label}
          </Txt>
        ) : (
          label
        )}
        {note}
      </View>
      <Txt num size={15} weight={strong ? 700 : 500} color={color}>
        {value}
      </Txt>
    </View>
  );
}
/** The double rule under a total, as in a ledger. */
export function TotalRule() {
  return (
    <View style={{ gap: 2, marginVertical: 4 }}>
      <View style={{ height: 1, backgroundColor: palette.ink }} />
      <View style={{ height: 1, backgroundColor: palette.ink }} />
    </View>
  );
}
/** A strip across the top of a screen: something waiting, an error, a notice. */
export function Banner({
  children,
  tone = "waiting",
  onPress,
  onClose,
  icon,
}: {
  children: React.ReactNode;
  tone?: Tone;
  onPress?: () => void;
  onClose?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  const [ink, tint] = toneInk[tone];
  return (
    <Pressable
      onPress={onPress ?? onClose}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: space.gutter,
        minHeight: TOUCH,
        backgroundColor: tint,
        borderBottomWidth: 1,
        borderColor: palette.rule,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon
        name={
          icon ??
          (tone === "declined"
            ? "alert-circle"
            : tone === "paid" || tone === "approved"
              ? "checkmark-circle"
              : "time")
        }
        size={18}
        color={ink}
      />
      <Txt size={14} weight={600} color={ink} style={{ flex: 1 }}>
        {children}
      </Txt>
      <Icon
        name={onClose && !onPress ? "close" : "chevron-forward"}
        size={18}
        color={ink}
      />
    </Pressable>
  );
}
/**
 * A notice inside a page or sheet: a tinted band with an icon and words in the tone's ink, not
 * tappable. Errors (declined), warnings (waiting), confirmations (paid). `actions` sit under it.
 */
export function Notice({
  tone = "declined",
  icon,
  alert = tone === "declined",
  actions,
  spaced = false,
  children,
}: {
  tone?: Tone;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  alert?: boolean;
  actions?: React.ReactNode;
  /** Leave 12 below it, for use between stacked blocks. */
  spaced?: boolean;
  children: React.ReactNode;
}) {
  const [ink, tint] = toneInk[tone];
  return (
    <View
      accessibilityRole={alert ? "alert" : undefined}
      style={{
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
        backgroundColor: tint,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: radius.sm,
        marginBottom: spaced ? 12 : 0,
      }}
    >
      <Icon
        name={
          icon ??
          (tone === "declined"
            ? "alert-circle"
            : tone === "paid" || tone === "approved"
              ? "checkmark-circle"
              : "time")
        }
        size={19}
        color={ink}
      />
      <View style={{ flex: 1, gap: actions ? 10 : 0 }}>
        <Txt size={14} weight={600} color={ink}>
          {children}
        </Txt>
        {actions}
      </View>
    </View>
  );
}
/** The Counterwell mark: a register page — three ruled lines and the red margin. */
export function BrandMark({ size = 30 }: { size?: number }) {
  const line = Math.max(2, Math.round(size / 13));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        backgroundColor: palette.blue,
        justifyContent: "center",
        paddingLeft: size * 0.38,
        paddingRight: size * 0.2,
        gap: size * 0.13,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: size * 0.26,
          top: 0,
          bottom: 0,
          width: line,
          backgroundColor: palette.margin,
        }}
      />
      {[1, 1, 0.62].map((w, i) => (
        <View
          key={i}
          style={{
            height: line,
            width: `${w * 100}%`,
            backgroundColor: "#FFFFFF",
            borderRadius: line,
          }}
        />
      ))}
    </View>
  );
}
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <Row style={{ gap: size * 0.45 }}>
      <BrandMark size={Math.round(size * 1.5)} />
      <Txt size={size} weight={700} style={{ letterSpacing: -0.3 }}>
        Counterwell
      </Txt>
    </Row>
  );
}
/** Faint register ruling behind a screen: pale lines and the red margin. */
export function RuledPaper({ step = 36, marginAt = 44 }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 40 }, (_, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: (i + 1) * step,
            height: 1,
            backgroundColor: palette.rule,
            opacity: 0.7,
          }}
        />
      ))}
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: marginAt,
          width: 1,
          backgroundColor: palette.margin,
          opacity: 0.55,
        }}
      />
    </View>
  );
}
/** Long product lists render this many rows; search narrows the rest. */
export const SHOWN_PRODUCTS = 50;
const SheetContext = createContext({ scrollToTop: () => {} });
/** Lets sheet content bring its own top back into view, for example after a step changes. */
export const useSheet = () => useContext(SheetContext);
export function Sheet({ title, visible, onClose, children }: any) {
  const t = useText();
  // The app-level error banner sits behind this modal, so show the current error here too.
  const { error: sessionError, setError: setSessionError } = useSession();
  // A second tap on the button that opened the sheet can land on whatever sits under it
  // in the new sheet (for example Hold order under Review & collect). Ignore touches
  // until the sheet has settled.
  const [settled, setSettled] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const sheet = useRef({
    scrollToTop: () => scroller.current?.scrollTo({ y: 0, animated: false }),
  }).current;
  useEffect(() => {
    setSettled(false);
    if (!visible) return;
    const timer = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(timer);
  }, [visible]);
  // Android does not resize a modal for the keyboard, so a sheet's lower fields and buttons sat
  // behind it. Lift the sheet by the keyboard's height there; iOS uses KeyboardAvoidingView.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android" || !visible) return;
    const shown = Keyboard.addListener("keyboardDidShow", (e) =>
      setKeyboard(e.endCoordinates.height),
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboard(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
      setKeyboard(0);
    };
  }, [visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* On iOS the keyboard would otherwise cover the lower part of the sheet (search results, form fields). */}
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t("close")}
        />
        <View
          style={[styles.sheet, keyboard ? { marginBottom: keyboard } : null]}
          pointerEvents={settled ? "auto" : "none"}
        >
          <View style={styles.grabber} />
          <Row
            style={{
              justifyContent: "space-between",
              paddingLeft: space.gutter,
              paddingRight: 12,
              paddingTop: 6,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderColor: palette.rule,
            }}
          >
            <Txt size={22} weight={700} style={{ flex: 1 }}>
              {title}
            </Txt>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("close")}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: pressed ? palette.rule : palette.desk,
                alignItems: "center",
                justifyContent: "center",
              })}
            >
              <Icon name="close" size={20} color={palette.ink2} />
            </Pressable>
          </Row>
          {visible && !!sessionError && (
            <Banner tone="declined" onClose={() => setSessionError("")}>
              {sessionError}
            </Banner>
          )}
          <ScrollView
            ref={scroller}
            contentContainerStyle={{
              paddingHorizontal: space.gutter,
              paddingTop: 18,
              paddingBottom: 44,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <SheetContext.Provider value={sheet}>
              {children}
            </SheetContext.Provider>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
/** An empty register page: ruled lines, a quiet icon, what will appear here and how. */
export function Empty({ icon = "file-tray-outline", title, detail }: any) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 40,
        paddingHorizontal: 24,
        gap: 10,
      }}
    >
      <View
        style={{
          width: 76,
          height: 60,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.rule,
          backgroundColor: palette.paper,
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          marginBottom: 6,
        }}
      >
        {[14, 28, 42].map((top) => (
          <View
            key={top}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top,
              height: 1,
              backgroundColor: palette.rule,
            }}
          />
        ))}
        <View
          style={{
            position: "absolute",
            left: 16,
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: palette.margin,
          }}
        />
        <Icon name={icon} size={24} color={palette.ink3} />
      </View>
      <Txt size={17} weight={600} center>
        {title}
      </Txt>
      {detail && (
        <Txt size={14} color={palette.ink2} center style={{ maxWidth: 300 }}>
          {detail}
        </Txt>
      )}
    </View>
  );
}
/** A bordered block on the page for a self-contained figure set or form. Use sparingly. */
export function Panel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.panel, style]}>{children}</View>;
}
export const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.ruleStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 17,
    fontFamily: fontFor(400),
    color: palette.ink,
    backgroundColor: palette.paper,
    minHeight: 52,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: palette.scrim,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    backgroundColor: palette.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    width: "100%",
    maxWidth: 640,
    maxHeight: "93%",
    ...shadow,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.ruleStrong,
    marginTop: 8,
    marginBottom: 4,
  },
  divider: { height: 1, backgroundColor: palette.rule },
  listRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: palette.rule,
  },
  panel: {
    backgroundColor: palette.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.rule,
    padding: space.xl,
  },
});
