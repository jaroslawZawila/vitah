import { File } from "expo-file-system";
import { DOWNLOAD_TIMEOUT_MS } from "./api-config";

/**
 * Downloads `url` with the client's token into `file`, giving up after
 * `DOWNLOAD_TIMEOUT_MS` so a stalled connection never leaves it waiting. On
 * failure no partial file is left behind, and the error is thrown.
 */
export async function downloadWithToken(url: string, file: File, token: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    await File.downloadFileAsync(url, file, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
