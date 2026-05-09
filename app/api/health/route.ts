/**
 * GET /api/health — Lightweight liveness probe.
 *
 * Returns 200 immediately without touching the database or Redis.
 * Used by:
 *   - CI/CD smoke tests after deployment
 *   - Uptime monitors (UptimeRobot, BetterUptime, etc.)
 *   - Load balancer health checks
 *
 * For a deep health check (DB + Redis connectivity), call /api/health/deep.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status:    'ok',
      app:       'kitabuyetu',
      timestamp: new Date().toISOString(),
      version:   process.env.npm_package_version ?? '0.1.0',
      env:       process.env.NODE_ENV ?? 'unknown',
    },
    {
      status:  200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
