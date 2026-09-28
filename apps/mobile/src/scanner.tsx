import React, { useRef, useState } from "react";
import { Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Sheet } from "./ui";
const BARCODES = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "itf14",
  "datamatrix",
  "qr",
] as const;
export const CAMERA_OFF =
  "Camera access is off. Allow it in Settings to scan, or search by name.";
/**
 * Camera sheet that hands over one code per opening (the camera reports the same
 * code many times while it is in view). `open` resolves to false when camera access
 * is refused; `settings` says whether only the Settings app can grant it now.
 */
export function useBarcodeScanner(
  onCode: (raw: string) => void,
  title = "Scan product barcode",
) {
  const [permission, requestPermission] = useCameraPermissions();
  const [visible, setVisible] = useState(false);
  const handled = useRef(false),
    latest = useRef(onCode);
  latest.current = onCode;
  async function open(): Promise<{ opened: boolean; settings: boolean }> {
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted)
        return {
          opened: false,
          settings: !p.canAskAgain && Platform.OS !== "web",
        };
    }
    handled.current = false;
    setVisible(true);
    return { opened: true, settings: false };
  }
  const sheet = (
    <Sheet visible={visible} title={title} onClose={() => setVisible(false)}>
      {visible && (
        <CameraView
          style={{ height: 320 }}
          barcodeScannerSettings={{ barcodeTypes: [...BARCODES] }}
          onBarcodeScanned={(event) => {
            if (handled.current) return;
            handled.current = true;
            setVisible(false);
            latest.current(event.data);
          }}
        />
      )}
    </Sheet>
  );
  return { open, sheet };
}
