import React, { useEffect, useRef, useState } from "react";
import { View, Image, Pressable, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system";
import { Sheet, Button, Txt, Row, Icon, colors } from "./ui";

export type BillFile = { uri: string; name: string; type: string };
type Page = { uri: string; base64: string; width: number; height: number };

/**
 * Photographs a supplier bill one page at a time. One page is sent as the photo itself;
 * several become one PDF, so a two-page bill is read as a single invoice.
 */
export function BillCamera({
  visible,
  close,
  onReady,
  hi,
}: {
  visible: boolean;
  close: () => void;
  onReady: (file: BillFile) => void;
  hi: boolean;
}) {
  const t = (en: string, hindi: string) => (hi ? hindi : en);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [pages, setPages] = useState<Page[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!visible) return;
    setPages([]);
    setError("");
    if (permission && !permission.granted && permission.canAskAgain)
      void requestPermission();
  }, [visible]);
  async function shoot() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError("");
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 0.55,
        base64: true,
      });
      if (!photo?.base64) throw new Error("No photo");
      setPages((current) => [
        ...current,
        {
          uri: photo.uri,
          base64: photo.base64!,
          width: photo.width,
          height: photo.height,
        },
      ]);
    } catch {
      setError(
        t(
          "The photo was not taken. Try again.",
          "फ़ोटो नहीं खिंची। फिर कोशिश करें।",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function use() {
    if (!pages.length || busy) return;
    setBusy(true);
    setError("");
    try {
      // India time in the name, as the owner would read it.
      const stamp = new Date(Date.now() + 330 * 60_000)
        .toISOString()
        .slice(0, 16)
        .replace(/[:T]/g, "-");
      if (pages.length === 1) {
        onReady({
          uri: pages[0].uri,
          name: `Supplier bill ${stamp}.jpg`,
          type: "image/jpeg",
        });
      } else {
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}body{margin:0}div{page-break-after:always;height:100vh;display:flex;align-items:center;justify-content:center}div:last-child{page-break-after:auto}img{max-width:100%;max-height:100vh}</style></head><body>${pages
          .map(
            (p) => `<div><img src="data:image/jpeg;base64,${p.base64}"/></div>`,
          )
          .join("")}</body></html>`;
        const pdf = await Print.printToFileAsync({
          html,
          width: 595,
          height: 842,
        });
        const size = new FileSystem.File(pdf.uri).size ?? 0;
        if (size > 10 * 1024 * 1024)
          throw new Error(
            t(
              "These pages are too large together. Send fewer pages at a time.",
              "ये पन्ने मिलकर बहुत बड़े हैं। एक बार में कम पन्ने भेजें।",
            ),
          );
        onReady({
          uri: pdf.uri,
          name: `Supplier bill ${stamp}.pdf`,
          type: "application/pdf",
        });
      }
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const denied = permission && !permission.granted;
  return (
    <Sheet
      visible={visible}
      title={t("Photograph the bill", "बिल की फ़ोटो लें")}
      onClose={close}
    >
      {visible && Platform.OS !== "web" && !denied && (
        <View style={{ gap: 14 }}>
          <Txt muted size={12}>
            {t(
              "Lay the bill flat in good light and fill the frame. Take one photo for each page.",
              "बिल को अच्छी रोशनी में सीधा रखें और पूरा फ़्रेम भरें। हर पन्ने की एक फ़ोटो लें।",
            )}
          </Txt>
          <CameraView
            ref={camera}
            style={{ height: 420, borderRadius: 12, overflow: "hidden" }}
            facing="back"
          />
          {pages.length > 0 && (
            <Row style={{ flexWrap: "wrap" }}>
              {pages.map((p, index) => (
                <Pressable
                  key={p.uri}
                  accessibilityLabel={t(
                    `Remove page ${index + 1}`,
                    `पन्ना ${index + 1} हटाएँ`,
                  )}
                  onPress={() =>
                    setPages((current) =>
                      current.filter((x) => x.uri !== p.uri),
                    )
                  }
                >
                  <Image
                    source={{ uri: p.uri }}
                    style={{
                      width: 64,
                      height: 86,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: colors.line,
                    }}
                  />
                  <View
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      backgroundColor: colors.surface,
                      borderRadius: 10,
                    }}
                  >
                    <Icon name="close-circle" size={18} />
                  </View>
                </Pressable>
              ))}
            </Row>
          )}
          <Button
            icon="camera-outline"
            secondary
            disabled={busy}
            onPress={() => void shoot()}
          >
            {pages.length
              ? t(
                  `Take page ${pages.length + 1}`,
                  `पन्ना ${pages.length + 1} लें`,
                )
              : t("Take photo", "फ़ोटो लें")}
          </Button>
          {pages.length > 0 && (
            <Button
              icon="cloud-upload-outline"
              disabled={busy}
              onPress={() => void use()}
            >
              {pages.length === 1
                ? t("Send this page", "यह पन्ना भेजें")
                : t(
                    `Send ${pages.length} pages as one bill`,
                    `${pages.length} पन्ने एक बिल की तरह भेजें`,
                  )}
            </Button>
          )}
          {!!error && <Txt style={{ color: colors.red }}>{error}</Txt>}
        </View>
      )}
      {visible && denied && (
        <Txt>
          {t(
            "Camera access is off. Allow it in Settings, or choose a photo or PDF instead.",
            "कैमरा की अनुमति बंद है। सेटिंग में चालू करें, या फ़ोटो/PDF चुनें।",
          )}
        </Txt>
      )}
    </Sheet>
  );
}
