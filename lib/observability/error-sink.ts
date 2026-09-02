/**
 * Where `logger.error` actually goes (SMS-REAUDIT-2026-09-02 F2 / T3-4 item 1).
 *
 * There are 107 `logger.error` call sites and, until this, every one of them
 * reached nobody. `outbox.service.ts` calls its own line "the paging signal"
 * while nothing consumed it. A handful of deliberate conditions were wired to
 * staff email in #132/#137, but that is a curated list — this is the general
 * answer for the other hundred.
 *
 * ── Inert without a DSN, on purpose ──
 * `SENTRY_DSN` is unset today, so nothing here loads, initialises or sends.
 * That is a credential-gated integration rather than an accident: the moment
 * the variable exists in Vercel, every logger.error starts arriving in Sentry
 * with no code change. Until then this costs one `process.env` read per error.
 *
 * ── Why @sentry/node and not @sentry/nextjs ──
 * All 107 call sites are server-side, and the only edge route in the app is
 * the OG image generator. @sentry/nextjs would add a next.config wrapper (a
 * build-time failure mode), a client bundle on a Hobby plan, and source-map
 * upload needing a second credential — all to cover surface this problem does
 * not live on.
 *
 * ── The safety property that matters most ──
 * This is handed data the logger has ALREADY sanitized. That is not a
 * convenience, it is the whole reason it is safe: T0-3 fixed a live leak where
 * an axios error's `config` carried TEXTSMS_API_KEY into the logs, and sending
 * raw arguments to a third-party service would re-open exactly that hole,
 * outward this time. Never call this with unsanitized input.
 */

type SentryModule = typeof import('@sentry/node');

/** null = not yet decided, false = deliberately disabled, module = live. */
let resolved: SentryModule | false | null = null;
let loading: Promise<SentryModule | false> | null = null;

/**
 * Load and initialise Sentry once, or decide once that it is disabled.
 *
 * Deliberately lazy: with no DSN the SDK is never imported at all, so an
 * unconfigured deployment pays nothing and cannot fail on it.
 */
async function getSentry(): Promise<SentryModule | false> {
  if (resolved !== null) return resolved;
  if (loading) return loading;

  loading = (async () => {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
      resolved = false;
      return false;
    }
    try {
      const Sentry = await import('@sentry/node');
      Sentry.init({
        dsn,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
        release:     process.env.VERCEL_GIT_COMMIT_SHA,
        // Errors only. Tracing samples every request and would spend the
        // quota on volume rather than on the thing this exists for.
        tracesSampleRate: 0,
        // The logger has already redacted secrets by key name; this stops the
        // SDK adding anything back from the request it did not get from us.
        sendDefaultPii: false,
      });
      resolved = Sentry;
      return Sentry;
    } catch {
      // A broken or missing SDK must never break the thing that was merely
      // trying to report a problem.
      resolved = false;
      return false;
    }
  })();

  return loading;
}

/**
 * Report one already-sanitized error entry. Fire-and-forget by contract:
 * `logger.error` is synchronous and is called from `finally` blocks, catch
 * handlers and cron paths where an await would change control flow.
 *
 * Swallows everything. An error sink that can throw turns a logged problem
 * into an unlogged crash.
 */
export function reportError(message: string, context: Record<string, unknown>): void {
  // Cheap enough to sit on the error path: one env read when disabled.
  if (resolved === false) return;
  if (resolved === null && !process.env.SENTRY_DSN) {
    resolved = false;
    return;
  }

  void (async () => {
    try {
      const Sentry = await getSentry();
      if (!Sentry) return;
      Sentry.captureException(new Error(message), { extra: context });
    } catch {
      /* never let reporting a failure become a failure */
    }
  })();
}

/** Tests only — the module holds process-lifetime state by design. */
export function resetErrorSink(): void {
  resolved = null;
  loading = null;
}
