import { File } from "expo-file-system";

/**
 * Downloads `url` with the client's token into `file`. On failure no partial
 * file is left behind, and the error is thrown.
 */
export async function downloadWithToken(url: string, file: File, token: string) {
  try {
    await File.downloadFileAsync(url, file, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}
