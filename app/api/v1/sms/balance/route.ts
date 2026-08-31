export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { smsService } from '@/lib/services/sms.service';
import { ok } from '@/lib/utils/response';

// sms_provider_balances is KITABU YETU'S OWN float with TextSMS — the
// platform's purchasing position, not any tenant's credit. A group's own
// balance is a different number entirely and lives at GET /sms/credits, which
// SmsCreditsPanel already shows on both portals.
//
// This was widened to messaging.view by migration 140 on the reasoning that
// "reading the balance is part of running the messaging surface". That
// conflates the two balances: it let any of the three officer roles watch the
// platform's float and its drawdown rate, and so infer total platform SMS
// volume over time. Same class of internal-only figure that
// sms-analytics.service.ts is careful to keep off tenant surfaces.
//
// super_admin on both verbs. POST additionally spends a live provider API
// call against that same platform account.
export async function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const { rows } = await withAdminDb((db) =>
      db.query(
        `SELECT balance, currency, queried_at
         FROM sms_provider_balances
         WHERE provider='textsms'
         ORDER BY queried_at DESC LIMIT 1`,
        [],
      ),
    );
    const latest = rows[0] ?? null;
    return ok({ balance: latest?.balance ?? null, currency: 'KES', lastChecked: latest?.queried_at ?? null });
  });
}

// POST — live query from TextSMS + snapshot
export async function POST(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const result = await smsService.getProviderBalance(auth.userId);
    return ok(result);
  });
}
