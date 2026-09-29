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
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "./session";
import { labels, type Label } from "./i18n";
import { hindiCopy } from "./copy.hi";
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
    language === "hi" ? (englishToHindi[word] ?? word) : word;
}
function translateCopy(value: any, language: string): any {
  if (language !== "hi") return value;
  if (typeof value === "string") {
    const trim = value.trim();
    return englishToHindi[trim]
      ? value.replace(trim, englishToHindi[trim])
      : value;
  }
  return Array.isArray(value)
    ? value.map((v) => translateCopy(v, language))
    : value;
}
export const colors = {
  bg: "#F5F5F0",
  surface: "#FFFFFF",
  ink: "#1C3532",
  muted: "#74817A",
  line: "#E4E8E2",
  accent: "#146D5A",
  tint: "#E8F2EB",
  amber: "#966220",
  amberBg: "#FAF0DE",
  red: "#B04E3F",
};
export function useText() {
  const { language } = useSession();
  return (key: Label) => labels[language][key];
}
export function Txt({
  children,
  muted = false,
  size = 14,
  bold = false,
  style,
  ...rest
}: any) {
  const { language } = useSession();
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily:
            Platform.OS === "web" ? "DM Sans, sans-serif" : "DMSans_400Regular",
          fontSize: size,
          color: muted ? colors.muted : colors.ink,
          ...(bold
            ? {
                fontFamily:
                  Platform.OS === "web"
                    ? "DM Sans, sans-serif"
                    : "DMSans_600SemiBold",
                fontWeight: "600" as const,
              }
            : {}),
        },
        style,
      ]}
    >
      {translateCopy(children, language)}
    </Text>
  );
}
export function Icon({
  name,
  size = 20,
  color = colors.muted,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function Button({
  children,
  onPress,
  secondary = false,
  disabled = false,
  icon,
  small = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? colors.tint : colors.accent,
          paddingVertical: small ? 10 : 14,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      {icon && (
        <Icon
          name={icon}
          color={secondary ? colors.accent : "white"}
          size={18}
        />
      )}
      <Txt
        bold
        size={small ? 12 : 14}
        style={{ color: secondary ? colors.accent : "white" }}
      >
        {children}
      </Txt>
    </Pressable>
  );
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
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  number?: boolean;
  secret?: boolean;
  multiline?: boolean;
  /** A username, code or address: the keyboard must not "correct" it ("shopowner" became "shop owner"). */
  identifier?: boolean;
}) {
  const { language } = useSession();
  return (
    <View style={{ gap: 7, marginBottom: 13 }}>
      {label && (
        <Txt size={12} bold muted>
          {label}
        </Txt>
      )}
      <TextInput
        accessibilityLabel={translateCopy(label ?? placeholder, language)}
        value={value}
        onChangeText={onChange}
        placeholder={translateCopy(placeholder, language)}
        placeholderTextColor={colors.muted}
        keyboardType={number ? "decimal-pad" : "default"}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={!identifier && !secret}
        spellCheck={!identifier && !secret}
        multiline={multiline}
        style={[
          styles.input,
          multiline && { minHeight: 100, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}
export function Chip({ children, active = false, onPress }: any) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.accent : "transparent",
          borderColor: active ? colors.accent : colors.line,
        },
      ]}
    >
      <Txt size={12} bold style={{ color: active ? "white" : colors.muted }}>
        {children}
      </Txt>
    </Pressable>
  );
}
export function Badge({ children, warning = false }: any) {
  return (
    <View
      style={{
        backgroundColor: warning ? colors.amberBg : colors.tint,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 5,
        alignSelf: "flex-start",
      }}
    >
      <Txt
        size={10}
        bold
        style={{ color: warning ? colors.amber : colors.accent }}
      >
        {children}
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
export function Section({ title, action, children }: any) {
  return (
    <View style={{ gap: 14, marginBottom: 26 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt size={18} bold>
          {title}
        </Txt>
        {action}
      </Row>
      {children}
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
      onRequestClose={onClose}
    >
      {/* On iOS the keyboard would otherwise cover the lower part of the sheet (search results, form fields). */}
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[styles.sheet, keyboard ? { marginBottom: keyboard } : null]}
          pointerEvents={settled ? "auto" : "none"}
        >
          <Row
            style={{
              justifyContent: "space-between",
              padding: 22,
              borderBottomWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Txt size={21} bold>
              {title}
            </Txt>
            <Pressable
              onPress={onClose}
              accessibilityLabel={t("close")}
              style={{ padding: 8 }}
            >
              <Icon name="close" />
            </Pressable>
          </Row>
          <ScrollView
            ref={scroller}
            contentContainerStyle={{ padding: 22, paddingBottom: 40 }}
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
export function Empty({ icon = "file-tray-outline", title, detail }: any) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: 34,
        gap: 12,
      }}
    >
      <View
        style={{ backgroundColor: colors.tint, borderRadius: 22, padding: 20 }}
      >
        <Icon name={icon} size={30} color={colors.accent} />
      </View>
      <Txt size={16} bold>
        {title}
      </Txt>
      {detail && (
        <Txt
          muted
          style={{ textAlign: "center", lineHeight: 21, maxWidth: 270 }}
        >
          {detail}
        </Txt>
      )}
    </View>
  );
}
export const styles = StyleSheet.create({
  button: {
    borderRadius: 10,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 9,
    padding: 13,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: "white",
    minHeight: 46,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(18,36,31,.3)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    width: "100%",
    maxWidth: 600,
    maxHeight: "92%",
  },
  divider: { height: 1, backgroundColor: colors.line },
  listRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  panel: { backgroundColor: "white", borderRadius: 14, padding: 22 },
});
