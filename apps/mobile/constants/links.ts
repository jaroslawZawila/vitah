// Pages Perfil links to, set per build in eas.json (a profile's `env`):
// doc/ops/mobile-release.md. A link not set (or not https) is left out of the
// screen. The pages and their text are the owner's, never written here.

/** An https address as given, else null. */
export function linkOf(value: string | undefined): string | null {
  const url = value?.trim();
  return url && /^https:\/\/\S+$/i.test(url) ? url : null;
}

// Read as `process.env.EXPO_PUBLIC_…` one by one: Expo writes each into the bundle by that exact name.
/** "Ayuda y preguntas frecuentes". */
export const HELP_URL = linkOf(process.env.EXPO_PUBLIC_HELP_URL);
/** "Privacidad y datos": the privacy policy the stores ask for. */
export const PRIVACY_URL = linkOf(process.env.EXPO_PUBLIC_PRIVACY_URL);
