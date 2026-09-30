import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { D } from "@counterwell/core";
import { useSession } from "./session";
import { Txt, Icon, Row, colors } from "./ui";

/**
 * Billing is refused until the owner confirms the shop is ready. A new owner lands on an empty
 * shop, so this lists what is left and opens the place to do each step.
 */
export function ShopSetup({
  navigate,
  wide,
}: {
  navigate: (page: string) => void;
  wide: boolean;
}) {
  const s = useSession();
  const [open, setOpen] = useState(true);
  const state = s.state;
  if (!state || s.demo || state.settings.readinessConfirmed) return null;
  const hi = s.language === "hi";
  const pad = { paddingVertical: 12, paddingHorizontal: wide ? 32 : 20 };
  if (s.identity?.actor.role !== "owner")
    return (
      <View style={[pad, { backgroundColor: colors.amberBg }]}>
        <Txt size={13} style={{ color: colors.amber }}>
          {hi
            ? "मालिक अभी दुकान सेट कर रहे हैं। तैयार होने पर बिल बनने लगेंगे।"
            : "The owner is still setting up the shop. Bills can be made once it is ready."}
        </Txt>
      </View>
    );
  const settings = state.settings;
  const steps = [
    {
      done: !!(
        settings.name &&
        settings.address &&
        settings.gstin &&
        settings.drugLicence &&
        settings.stateCode
      ),
      en: "Shop name, address, GSTIN and drug licence",
      hi: "दुकान का नाम, पता, GSTIN और ड्रग लाइसेंस",
      page: "administration",
    },
    {
      done: Object.keys(state.products).length > 0,
      en: "Medicines: import your list or add them",
      hi: "दवाएँ: अपनी सूची इम्पोर्ट करें या जोड़ें",
      page: "inventory",
    },
    {
      done: Object.values(state.batches).some((b) => D(b.quantity).gt(0)),
      en: "Opening stock: count what is on the shelves",
      hi: "शुरुआती स्टॉक: अलमारी में रखा माल गिनें",
      page: "inventory",
    },
    {
      done: Object.values(state.members).some((m) => m.role === "employee"),
      en: "Staff accounts (optional)",
      hi: "स्टाफ़ के खाते (वैकल्पिक)",
      page: "administration",
    },
    {
      done: false,
      en: "Tick the readiness box in Administration to start billing",
      hi: "बिलिंग शुरू करने के लिए प्रबंधन में तैयारी वाला बॉक्स चुनें",
      page: "administration",
    },
  ];
  const done = steps.filter((step) => step.done).length;
  return (
    <View
      style={[
        pad,
        {
          backgroundColor: "white",
          borderBottomWidth: 1,
          borderColor: colors.line,
          gap: 8,
        },
      ]}
    >
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
        <Row style={{ justifyContent: "space-between" }}>
          <Txt bold>
            {hi
              ? `दुकान सेट करें · ${steps.length} में से ${done} हुए`
              : `Set up your shop · ${done} of ${steps.length} done`}
          </Txt>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={18} />
        </Row>
      </Pressable>
      {open &&
        steps.map((step) => (
          <Pressable
            key={step.en}
            accessibilityRole="button"
            onPress={() => navigate(step.page)}
          >
            <Row style={{ gap: 10 }}>
              <Icon
                name={step.done ? "checkmark-circle" : "ellipse-outline"}
                color={step.done ? colors.accent : colors.muted}
                size={18}
              />
              <Txt size={13} style={{ flex: 1 }} muted={step.done}>
                {hi ? step.hi : step.en}
              </Txt>
              {!step.done && <Icon name="chevron-forward" size={14} />}
            </Row>
          </Pressable>
        ))}
    </View>
  );
}
