import * as SecureStore from "expo-secure-store";

// Which of the client's homes this phone shows (lib/use-project.tsx).

/** The home the client chose in "Mis viviendas". */
export const CHOSEN_KEY = "vitah_project";
/** The home last shown: loading starts with it before the list arrives, and offline. */
export const SHOWN_KEY = "vitah_project_shown";

/** Forgets both on sign-out: the next client to sign in on this phone starts afresh. */
export async function clearProjectChoice() {
  await Promise.all([CHOSEN_KEY, SHOWN_KEY].map((key) => SecureStore.deleteItemAsync(key).catch(() => {})));
}
