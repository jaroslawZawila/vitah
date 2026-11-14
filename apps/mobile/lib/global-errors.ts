import { reportError } from "./report-error";

// What no screen catches: an error thrown outside rendering (a timer, an
// event handler) and a promise rejected with nobody listening. Both are
// reported; what the app then does is left as it was.

/** How long a fatal error is held so its report can leave before the app closes. */
const FATAL_FLUSH_MS = 1500;

type RejectionTracker = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

let installed = false;

/**
 * Call once, when the app starts. `production` (a release build) also listens
 * for unhandled promise rejections: React Native only tracks them in
 * development, where its own tracker shows them and is left alone.
 */
export function installGlobalErrorHandlers({ production = !__DEV__ }: { production?: boolean } = {}) {
  if (installed) return;
  installed = true;

  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    const sent = reportError(error, { fatal: !!isFatal });
    if (!isFatal) return previous?.(error, isFatal);
    // React Native closes the app on a fatal error: let the report out first,
    // but not for long if it can't get out.
    let handedOn = false;
    const handOn = () => {
      if (handedOn) return;
      handedOn = true;
      clearTimeout(timer);
      previous?.(error, isFatal);
    };
    const timer = setTimeout(handOn, FATAL_FLUSH_MS);
    void sent.then(handOn);
  });

  if (!production) return;
  const hermes = (globalThis as { HermesInternal?: RejectionTracker | null }).HermesInternal;
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, rejection) => void reportError(rejection),
    onHandled: () => {},
  });
}
