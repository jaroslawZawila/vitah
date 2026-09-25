import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { File } from "expo-file-system";

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Opens a local PDF in the phone's own viewer: the default PDF app on
 * Android, the share sheet (with Quick Look preview) on iOS.
 */
export async function openPdf(file: File) {
  if (Platform.OS === "android") {
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: file.contentUri,
        type: "application/pdf",
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
      return;
    } catch {
      // No PDF app installed: fall back to the share sheet.
    }
  }
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
}
