/* eslint-disable no-console */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level:   LogLevel;
  message: string;
  ts:      string;
  [key: string]: unknown;
}

const isProd = process.env.NODE_ENV === 'production';

function emit(level: LogLevel, args: unknown[]): void {
  if (isProd) {
    // Structured JSON in production — easy to ingest by Logtail/Datadog/CloudWatch
    const [first, ...rest] = args;
    const entry: LogEntry = {
      level,
      ts:      new Date().toISOString(),
      message: typeof first === 'string' ? first : JSON.stringify(first),
    };
    // Merge additional context objects into the log entry
    for (const extra of rest) {
      if (extra instanceof Error) {
        entry.error = { message: extra.message, stack: extra.stack, name: extra.name };
      } else if (extra !== null && typeof extra === 'object') {
        Object.assign(entry, extra);
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
    // Human-readable in development
    const prefix = `[${level.toUpperCase()}]`;
    if (level === 'error')      console.error(prefix, ...args);
    else if (level === 'warn')  console.warn(prefix, ...args);
    else                        console.log(prefix, ...args);
  }
}

export const logger = {
  debug: (...args: unknown[]): void => { if (!isProd) emit('debug', args); },
  info:  (...args: unknown[]): void => emit('info',  args),
  warn:  (...args: unknown[]): void => emit('warn',  args),
  error: (...args: unknown[]): void => emit('error', args),
};
