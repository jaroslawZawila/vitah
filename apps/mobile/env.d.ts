/// <reference types="expo/types" />

// Set per build in eas.json (a profile's `env`), written into the bundle by Expo:
// doc/ops/mobile-release.md.
declare namespace NodeJS {
  interface ProcessEnv {
    /** The portal the app talks to. */
    EXPO_PUBLIC_API_URL?: string;
    /** Perfil › "Ayuda y preguntas frecuentes" (https); unset, the row is left out. */
    EXPO_PUBLIC_HELP_URL?: string;
    /** Perfil › "Privacidad y datos", the privacy policy (https); unset, the row is left out. */
    EXPO_PUBLIC_PRIVACY_URL?: string;
    /** "1" sends error reports from development builds too. */
    EXPO_PUBLIC_REPORT_ERRORS?: string;
  }
}
