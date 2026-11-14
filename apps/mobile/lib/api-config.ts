// Where the portal is and how long the app waits for it. Apart from `api.ts`
// so the error reporter and the downloads don't depend on the whole client.

/** The portal the app talks to; a build gets it from its EAS profile (`eas.json`). */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/** How long a call may take before it is given up as "timeout". */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Files (a document, an acta, an invoice) may take longer on a slow connection. */
export const DOWNLOAD_TIMEOUT_MS = 90_000;
