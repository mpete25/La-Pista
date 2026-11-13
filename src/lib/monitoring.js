/**
 * Error monitoring (Sentry), switched on by setting VITE_SENTRY_DSN.
 *
 * Without a DSN nothing is loaded or sent; errors only go to the console.
 * The SDK is imported lazily so it never weighs on the app's first load.
 *
 * Privacy: no IP addresses, cookies or request bodies are sent
 * (sendDefaultPii: false), only the user's opaque id — never a name, e-mail
 * or phone number.
 */
let sentry = null;
const queue = [];

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  import("@sentry/react")
    .then((S) => {
      S.init({
        dsn,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_APP_VERSION || undefined,
        sendDefaultPii: false,
        tracesSampleRate: 0,
      });
      sentry = S;
      queue.splice(0).forEach(([err, ctx]) => S.captureException(err, ctx));
    })
    .catch((e) => console.warn("Could not load error monitoring:", e));
}

/** Report an error with optional extra context. Safe to call any time. */
export function reportError(error, context) {
  console.error(error);
  const ctx = context ? { extra: context } : undefined;
  if (sentry) sentry.captureException(error, ctx);
  else if (import.meta.env.VITE_SENTRY_DSN) queue.push([error, ctx]);
}

/** Tag reports with the signed-in user's id (nothing else), or clear it. */
export function setMonitoringUser(id) {
  if (sentry) sentry.setUser(id ? { id } : null);
}
