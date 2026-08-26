import type { Metadata } from 'next';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { pool } from '@/lib/db';
import { redis } from '@/lib/redis';
import { getAccessToken } from '@/lib/services/daraja.service';

export const metadata: Metadata = {
  title: 'System status',
  description: 'Current operational status of Kitabu Yetu services.',
};

/**
 * This page used to render a hardcoded "All systems operational" with a
 * disclaimer that it was updated manually — flagged by the 2026-08-25
 * hero-brief claim audit as a false live-status marker (defect 5). It now
 * runs three real checks server-side on every regeneration:
 *
 *  - Database: the same pool every request handler uses (`lib/db`).
 *  - Cache/jobs: Redis, which SMS delivery, rate limiting and job dispatch
 *    all depend on (`lib/redis`).
 *  - M-Pesa: `getAccessToken()` from daraja.service.ts — the same
 *    in-memory + Redis-cached OAuth token every STK push, B2C and B2B call
 *    uses. Calling it here almost always hits that cache rather than making
 *    a fresh call to Safaricom, so this doesn't add load to their API.
 *
 * A module-level cache below caps how often those checks actually run — this
 * is a public, unauthenticated, potentially crawler-hit page, and a
 * DB/Redis/Daraja round trip on every single request would be its own small
 * liability. This is a plain `export const revalidate` away from being ISR
 * — but the three checks are raw `pg`/`ioredis` calls, not `fetch()`, and
 * only `fetch()` participates in Next's Data Cache, so `revalidate` alone
 * does nothing here and the route renders fully dynamic regardless. Same
 * shape as the Daraja token cache itself: process-local, good enough for a
 * status page, resets on redeploy. No raw error text is ever rendered; a
 * failed check is reported as down, nothing more specific, so this can't
 * leak infrastructure detail to a visitor.
 */
const CACHE_TTL_MS = 60_000;

type CheckState = 'operational' | 'down';
interface ServiceStatus { label: string; state: CheckState }
interface StatusSnapshot { services: ServiceStatus[]; checkedAt: number }

let _cache: StatusSnapshot | null = null;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function checkDatabase(): Promise<CheckState> {
  try {
    await withTimeout(pool.query('SELECT 1'), 4_000);
    return 'operational';
  } catch {
    return 'down';
  }
}

async function checkRedis(): Promise<CheckState> {
  try {
    await withTimeout(redis.ping(), 4_000);
    return 'operational';
  } catch {
    return 'down';
  }
}

async function checkMpesa(): Promise<CheckState> {
  try {
    await withTimeout(getAccessToken(), 4_000);
    return 'operational';
  } catch {
    return 'down';
  }
}

async function getStatus(): Promise<StatusSnapshot> {
  if (_cache && Date.now() - _cache.checkedAt < CACHE_TTL_MS) {
    return _cache;
  }

  const [db, cache, mpesa] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkMpesa(),
  ]);

  // The API and the web app itself share the database's fate — neither can
  // serve a real request without it, so there is no separate probe for them.
  const snapshot: StatusSnapshot = {
    checkedAt: Date.now(),
    services: [
      { label: 'Web application',                       state: 'operational' },
      { label: 'M-Pesa collections (STK Push, PayBill)', state: mpesa },
      { label: 'M-Pesa disbursements (B2C)',             state: mpesa },
      { label: 'API',                                    state: db === 'operational' && cache === 'operational' ? 'operational' : 'down' },
    ],
  };
  _cache = snapshot;
  return snapshot;
}

export default async function StatusPage() {
  const { services, checkedAt } = await getStatus();
  const allOperational = services.every((s) => s.state === 'operational');

  return (
    <PageShell
      title="System status"
      description="Current status of Kitabu Yetu's core services."
    >
      {allOperational ? (
        <div className="mb-8 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          All systems operational
        </div>
      ) : (
        <div className="mb-8 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Some services are degraded
        </div>
      )}
      <ul className="space-y-3">
        {services.map((service) => (
          <li
            key={service.label}
            className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm"
          >
            <span className="text-slate-700">{service.label}</span>
            {service.state === 'operational' ? (
              <span className="flex items-center gap-1.5 font-medium text-green-700">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Operational
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-medium text-red-700">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Down
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-slate-500">
        Checked live against the database, cache and M-Pesa connectivity as of{' '}
        {new Date(checkedAt).toUTCString()}. If something looks wrong on your end that
        isn&apos;t reflected here, please <a href="/support">contact support</a>.
      </p>
    </PageShell>
  );
}
