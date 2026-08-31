/* eslint-disable no-console */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level:   LogLevel;
  message: string;
  ts:      string;
  [key: string]: unknown;
}

/**
 * Read at call time, not captured at module load, so the branch is decided by
 * the environment the process is actually in. Module-load capture also made
 * this untestable without reloading the whole module graph per case.
 * The cost is one env lookup per log line, immaterial next to console I/O.
 */
function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Keys whose VALUE is never safe to log, matched case-insensitively as a
 * substring so `apikey`, `TEXTSMS_API_KEY`, `x-api-key` and `apiKey` all hit.
 *
 * `partnerid` is here because TextSMS authenticates on the pair
 * (apikey, partnerID) — redacting only the key would still publish half the
 * credential.
 */
const SECRET_KEY_RE =
  /api[-_]?key|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|secret|password|passwd|passphrase|credential|cookie|session[-_]?id|partner[-_]?id|signing[-_]?key|private[-_]?key/i;

const REDACTED = '[REDACTED]';

/** Objects deeper than this are almost never useful in a log line. */
const MAX_DEPTH = 6;

/**
 * Reduce a value to something safe to serialize.
 *
 * The load-bearing case is `value instanceof Error`. An AxiosError is an
 * Error, and its `toJSON()` includes `config` — which for this codebase's
 * provider calls carries `apikey` in `params` (GET: delivery reports, balance)
 * or in `data` (POST: sends). So `JSON.stringify({ err: axiosError })` used to
 * write the live TextSMS credential into the log stream in cleartext.
 *
 * The previous implementation only narrowed a TOP-LEVEL Error argument, which
 * made safety depend on call-site style: `logger.error('x', err)` was safe
 * while `logger.error('x', { id, err })` was not. Five call sites in the SMS
 * subsystem alone use the nested form, so the reduction has to happen here,
 * at every depth, rather than being a rule each caller has to remember.
 *
 * `seen` breaks cycles — an Error's `config.request` graph is self-referential,
 * and JSON.stringify throws on that.
 */
function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    // Deliberately a fixed shape: name/message/stack only. Never spread the
    // error's own enumerable properties — that is exactly where `config` lives.
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : sanitize(v, depth + 1, seen);
  }
  return out;
}

function emit(level: LogLevel, args: unknown[]): void {
  if (isProd()) {
    // Structured JSON in production — easy to ingest by Logtail/Datadog/CloudWatch
    const [first, ...rest] = args;
    const entry: LogEntry = {
      level,
      ts:      new Date().toISOString(),
      message: typeof first === 'string' ? first : JSON.stringify(sanitize(first)),
    };
    // Merge additional context objects into the log entry
    for (const extra of rest) {
      if (extra instanceof Error) {
        // Same `entry.error` shape as before — anything parsing these logs
        // keeps working.
        entry.error = sanitize(extra);
      } else if (extra !== null && typeof extra === 'object') {
        Object.assign(entry, sanitize(extra) as Record<string, unknown>);
      } else if (extra !== undefined) {
        entry.detail = extra;
      }
    }
    // In production always write errors/warns; suppress debug in quiet mode
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else if (level === 'info' || level === 'debug') {
      console.log(JSON.stringify(entry));
    }
  } else {
    // Human-readable in development — sanitized on the same terms as
    // production. Preview and CI both run non-production, and their logs are
    // routinely more widely readable than production's, so this branch is if
    // anything the more important one to keep clean. `stack` is preserved, so
    // debuggability is unchanged.
    const prefix = `[${level.toUpperCase()}]`;
    const safe = args.map((a) => sanitize(a));
    if (level === 'error')      console.error(prefix, ...safe);
    else if (level === 'warn')  console.warn(prefix, ...safe);
    else                        console.log(prefix, ...safe);
  }
}

export const logger = {
  debug: (...args: unknown[]): void => { if (!isProd()) emit('debug', args); },
  info:  (...args: unknown[]): void => emit('info',  args),
  warn:  (...args: unknown[]): void => emit('warn',  args),
  error: (...args: unknown[]): void => emit('error', args),
};
