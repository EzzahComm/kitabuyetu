export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb, withDb, type TenantContext } from '@/lib/db';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/treasury/external-funding — disbursements this group has
 * received from partner organizations (grants, revolving funds, loan
 * capital…). Group-side, read-only view of the org → group money trail;
 * scoped strictly to the caller's group. The organization's wallet and
 * ledger remain invisible to groups by design.
 *
 * The tenant-sensitive read (organization_disbursements — amounts, status,
 * references) runs through the RLS-enforced tenant pool: real Postgres
 * policy `organization_disbursements_group_select` restricts it to
 * `group_id = app_current_group_id()`, on top of the explicit WHERE below.
 *
 * The organization/program display names are looked up separately via the
 * admin pool. This is deliberate, not an oversight: `organizations` and
 * `funding_programs` RLS policies (`organizations_select`,
 * `funding_programs_all`) only permit `is_super_admin()` or that org's own
 * `organization_coordinator` — a group officer's tenant-scoped connection
 * cannot read either table at all. The original query INNER JOINed
 * `organizations`, so running it verbatim on the tenant pool would silently
 * return zero rows for every real group officer. The lookup below is safe
 * precisely because it is keyed only off IDs already resolved from the
 * RLS-scoped disbursement rows — never off caller-supplied input — so it
 * exposes nothing beyond the name of an organization/program this group's
 * own (already access-checked) disbursement history references.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const page  = Math.max(1, parseInt(req.nextUrl.searchParams.get('page')  ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));

    const ctx: TenantContext = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };

    const { items, total, totalReceived } = await withDb(ctx, async (db) => {
      const { rows: countRows } = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM organization_disbursements WHERE group_id = $1`,
        [auth.groupId],
      );
      const { rows } = await db.query<{
        id: string; disbursement_type: string; amount: string; currency: string;
        status: string; reference: string | null; notes: string | null;
        created_at: string; completed_at: string | null;
        organization_id: string; funding_program_id: string | null;
      }>(
        `SELECT d.id, d.disbursement_type, d.amount, d.currency, d.status,
                d.reference, d.notes, d.created_at, d.completed_at,
                d.organization_id, d.funding_program_id
         FROM   organization_disbursements d
         WHERE  d.group_id = $1
         ORDER  BY d.created_at DESC
         LIMIT  $2 OFFSET $3`,
        [auth.groupId, limit, (page - 1) * limit],
      );
      const { rows: totals } = await db.query<{ total_received: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total_received
         FROM organization_disbursements
         WHERE group_id = $1 AND status = 'completed'`,
        [auth.groupId],
      );
      return {
        items: rows,
        total: parseInt(countRows[0]?.n ?? '0', 10),
        totalReceived: totals[0]?.total_received ?? '0',
      };
    });

    // Enrich with organization/program display names — see note above on
    // why this runs on the admin pool, keyed only by already-scoped IDs.
    const orgIds = [...new Set(items.map((r) => r.organization_id))];
    const programIds = [...new Set(items.map((r) => r.funding_program_id).filter((id): id is string => !!id))];

    const [orgNames, programNames] = orgIds.length === 0
      ? [new Map<string, string>(), new Map<string, string>()]
      : await withAdminDb(async (db) => {
          const { rows: orgs } = await db.query<{ id: string; name: string }>(
            `SELECT id, name FROM organizations WHERE id = ANY($1::uuid[])`,
            [orgIds],
          );
          const { rows: programs } = programIds.length === 0
            ? { rows: [] as { id: string; name: string }[] }
            : await db.query<{ id: string; name: string }>(
                `SELECT id, name FROM funding_programs WHERE id = ANY($1::uuid[])`,
                [programIds],
              );
          return [
            new Map(orgs.map((o) => [o.id, o.name])),
            new Map(programs.map((p) => [p.id, p.name])),
          ];
        });

    const enrichedItems = items.map(({ organization_id, funding_program_id, ...rest }) => ({
      ...rest,
      organization_name: orgNames.get(organization_id) ?? null,
      program_name: funding_program_id ? programNames.get(funding_program_id) ?? null : null,
    }));

    return ok({ items: enrichedItems, total, totalReceived, page, limit });
  });
}
