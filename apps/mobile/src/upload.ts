import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";

/**
 * A local file as a multipart part. Expo replaces `fetch` on native, and its FormData encoder
 * refuses React Native's `{ uri, name, type }` parts ("Unsupported FormDataPart implementation"),
 * so a picked invoice or recorded sale never left the phone. It reads a part through `bytes()`
 * and takes the file name and type from the part itself.
 */
export async function appendFile(
  form: FormData,
  field: string,
  uri: string,
  name: string,
  type: string,
) {
  if (Platform.OS === "web") {
    form.append(field, await (await fetch(uri)).blob(), name);
    return;
  }
  const file = new FileSystem.File(uri);
  form.append(field, {
    name,
    type,
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
  } as unknown as Blob);
}
