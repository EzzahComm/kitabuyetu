export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole, withPermission } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { smsService } from '@/lib/services/sms.service';
import { ok } from '@/lib/utils/response';

// GET â€” latest snapshot from DB.
// messaging.view rather than withRole('treasurer') (migration 140): reading the
// balance is part of running the messaging surface, which the secretary does.
// POST below stays treasurer-gated — it spends a live provider API call.
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async () => {
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

// POST â€” live query from TextSMS + snapshot
export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const result = await smsService.getProviderBalance(auth.userId);
    return ok(result);
  });
}
