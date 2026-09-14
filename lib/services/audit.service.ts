/**
 * Audit writing — the organization axis (R11).
 *
 * R11 covers reads on role-gated surfaces as well as writes. Every existing
 * caller hand-writes its own `INSERT INTO audit_logs`, so there was no single
 * place to add read auditing; this is that place for the organization tree.
 *
 * Two deliberate constraints shape it:
 *
 * 1. WHICH reads. Not all of them. The funding page carries
 *    `refetchInterval: 120_000`, so a coordinator who simply leaves the tab
 *    open would generate ~720 rows a day by doing nothing. An audit log that
 *    large stops answering the question it exists for ("who looked at this?"),
 *    so only *significant* reads are recorded — report generation, exports,
 *    and drill-downs into a named group — and repeats inside a short window
 *    collapse to one row.
 *
 * 2. PRIVILEGED WRITE. audit_logs_insert is `WITH CHECK (is_super_admin())` —
 *    direct inserts are blocked for app roles by design, so this uses
 *    withAdminDb rather than the tenant pool. Rows are also immutable
 *    (audit_logs_immutable trigger), so this only ever INSERTs.
 */
import { withAdminDb, type TenantContext } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface OrgReadAudit {
  ctx:           TenantContext;
  /** Dotted action, matching the existing convention, e.g. 'portfolio.report.generate'. */
  action:        string;
  /** 'organization' | 'group' | 'funding_program' | … */
  resourceType:  string;
  /** The specific thing read, when there is one. */
  resourceId?:   string | null;
  /** Set when the read targets one group, so it is visible on the group axis too. */
  groupId?:      string | null;
  ipAddress?:    string | null;
  userAgent?:    string | null;
  /**
   * Repeats by the same actor, on the same action and resource, inside this
   * window collapse into the row already there. Postgres interval literal.
   */
  dedupeWindow?: string;
}

/**
 * Record a significant organization-axis read.
 *
 * Best-effort by design: a failure here is logged loudly but does NOT fail the
 * request. Refusing to show a coordinator their own report because the audit
 * insert failed trades a real outage for a bookkeeping gap — the wrong way
 * round for a read. (A *write* path must not make that trade: there the audit
 * row belongs in the same transaction as the change it describes.)
 */
export async function recordOrgRead(a: OrgReadAudit): Promise<void> {
  const organizationId = a.ctx.organizationId ?? null;
  if (!organizationId) {
    // Without an organization the row would be attributable to nobody and
    // invisible to the audit viewer (see migration 168). Better to say so than
    // to write a row that silently cannot be read.
    logger.warn('[audit] recordOrgRead called without an organization context', { action: a.action });
    return;
  }

  try {
    await withAdminDb(async (db) => {
      await db.query(
        // Every parameter is cast explicitly. Each of $1/$3/$4/$6 appears both in
        // the SELECT list and in the NOT EXISTS comparison, and Postgres infers
        // those two positions independently — an uncast $4 comes out `text` in
        // the SELECT but `character varying` against the column in the WHERE,
        // which fails with "inconsistent types deduced for parameter $4".
        `INSERT INTO audit_logs
           (organization_id, group_id, actor_id, action, resource_type, resource_id, ip_address, user_agent)
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::varchar, $6::uuid, $7::inet, $8::text
         WHERE NOT EXISTS (
           SELECT 1 FROM audit_logs
           WHERE organization_id IS NOT DISTINCT FROM $1::uuid
             AND actor_id       IS NOT DISTINCT FROM $3::uuid
             AND action          = $4::varchar
             AND resource_id    IS NOT DISTINCT FROM $6::uuid
             AND created_at > NOW() - $9::interval
         )`,
        [
          organizationId,
          a.groupId ?? null,
          a.ctx.userId,
          a.action,
          a.resourceType,
          a.resourceId ?? null,
          a.ipAddress ?? null,
          a.userAgent ?? null,
          a.dedupeWindow ?? '15 minutes',
        ],
      );
    });
  } catch (err) {
    logger.error('[audit] failed to record organization read', {
      action: a.action, organizationId, err: String(err),
    });
  }
}

/** Pulls the client address and agent off a request, for the fields above. */
export function auditRequestMeta(req: { headers: { get(name: string): string | null } }): {
  ipAddress: string | null; userAgent: string | null;
} {
  const fwd = req.headers.get('x-forwarded-for');
  return {
    // x-forwarded-for is a list; the client is the first entry.
    ipAddress: fwd?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null,
    userAgent: req.headers.get('user-agent'),
  };
}
