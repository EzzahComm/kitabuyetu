/**
 * Organization subscription plans — real, enforced tiers assigned exclusively
 * by super_admin (organizations never self-serve a plan; only Kitabu Yetu
 * staff create organizations at all). See types/enums.ts's
 * ORGANIZATION_PLAN_FEATURES/_MONTHLY_FEES for the static tier definitions
 * this snapshots, and supabase/migrations/20260817000000_152_* for the schema
 * and the full rationale (mirrors subscriptions' snapshot-not-live-join shape;
 * deliberately the opposite of the group side's currently-decorative
 * PLAN_FEATURES gating, chosen on purpose here).
 */
import type { PoolClient } from 'pg';
import { withAdminDb, withDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError, OrganizationCapError, OrganizationFeatureGatedError } from '@/lib/utils/errors';
import {
  ORGANIZATION_PLAN_FEATURES, ORGANIZATION_PLAN_MONTHLY_FEES,
  type OrganizationPlanType, type OrganizationSupportTier,
} from '@/types/enums';

export interface OrganizationSubscription {
  id:                     string;
  organization_id:        string;
  plan_type:               OrganizationPlanType;
  status:                 'active' | 'cancelled';
  monthly_fee:            string;
  max_linked_groups:      number | null;
  max_staff:              number | null;
  max_funding_programs:   number | null;
  sms_allowance_included: string;
  white_label_branding:   boolean;
  advanced_reports:       boolean;
  support_tier:           OrganizationSupportTier;
  is_custom:              boolean;
  started_at:             string;
}

export interface CustomPlanTerms {
  monthlyFee:            number;
  maxLinkedGroups?:      number | null;
  maxStaff?:             number | null;
  maxFundingPrograms?:   number | null;
  smsAllowanceIncluded?: number;
  supportTier?:          OrganizationSupportTier;
}

/**
 * A cap this permissive is what "no plan assigned" should mean: fail toward
 * the most restrictive REAL tier, never toward unlimited. An organization
 * that somehow has no active row (shouldn't happen once assignment is
 * mandatory at creation, but a defensive default matters) is treated as
 * Starter, not as uncapped.
 */
const NO_PLAN_DEFAULTS = ORGANIZATION_PLAN_FEATURES.starter;

/**
 * The allowance-reset job has no interactive caller — it passes a 'system'
 * sentinel, which is not a UUID. Mirrors billing.service.ts's own actorId()
 * guard exactly (that one is module-private, so duplicated here rather than
 * exported across an otherwise-unrelated module boundary for one helper).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function actorId(userId: string | undefined | null): string | null {
  return userId && UUID_RE.test(userId) ? userId : null;
}

async function getActiveSubscriptionForUpdate(
  db: PoolClient, organizationId: string,
): Promise<OrganizationSubscription | null> {
  const { rows } = await db.query<OrganizationSubscription>(
    `SELECT * FROM organization_subscriptions WHERE organization_id = $1 AND status = 'active' FOR UPDATE`,
    [organizationId],
  );
  return rows[0] ?? null;
}

/**
 * Assigns a plan — super_admin only (enforced by the route, not here; this
 * function trusts its caller the same way admin.service.ts's
 * updateGroupProfile/updateMemberProfile do).
 *
 * starter/growth/premium snapshot every field from the static map. premium_plus
 * requires `custom` in full — "custom, including pricing" was explicit, so
 * there is no fallback numeric anywhere in this path for it to silently read.
 */
export async function assignOrganizationPlan(
  organizationId: string,
  planType:       OrganizationPlanType,
  adminId:        string,
  opts:           { custom?: CustomPlanTerms; notes?: string } = {},
): Promise<OrganizationSubscription> {
  let snapshot: {
    monthlyFee: number; maxLinkedGroups: number | null; maxStaff: number | null;
    maxFundingPrograms: number | null; smsAllowanceIncluded: number;
    whiteLabelBranding: boolean; advancedReports: boolean; supportTier: OrganizationSupportTier;
    isCustom: boolean;
  };

  if (planType === 'premium_plus') {
    if (!opts.custom || !(opts.custom.monthlyFee >= 0)) {
      throw new ValidationError('Premium+ requires a monthly fee — every term is negotiated per contract');
    }
    snapshot = {
      monthlyFee:           opts.custom.monthlyFee,
      maxLinkedGroups:      opts.custom.maxLinkedGroups ?? null,
      maxStaff:             opts.custom.maxStaff ?? null,
      maxFundingPrograms:   opts.custom.maxFundingPrograms ?? null,
      smsAllowanceIncluded: opts.custom.smsAllowanceIncluded ?? 0,
      whiteLabelBranding:   true, // Premium+ is the ONLY tier with white-label
      advancedReports:      true,
      supportTier:          opts.custom.supportTier ?? 'priority_plus',
      isCustom:             true,
    };
  } else {
    const f = ORGANIZATION_PLAN_FEATURES[planType];
    snapshot = {
      monthlyFee:           ORGANIZATION_PLAN_MONTHLY_FEES[planType],
      maxLinkedGroups:      f.maxLinkedGroups,
      maxStaff:             f.maxStaff,
      maxFundingPrograms:   f.maxFundingPrograms,
      smsAllowanceIncluded: f.smsAllowanceIncluded,
      whiteLabelBranding:   f.whiteLabelBranding,
      advancedReports:      f.advancedReports,
      supportTier:          f.supportTier,
      isCustom:             false,
    };
  }

  return withAdminDb(async (db) => {
    const org = await db.query<{ id: string }>(`SELECT id FROM organizations WHERE id = $1`, [organizationId]);
    if (!org.rows[0]) throw new NotFoundError('Organization', organizationId);

    const before = await getActiveSubscriptionForUpdate(db, organizationId);
    if (before) {
      await db.query(
        `UPDATE organization_subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
        [before.id],
      );
    }

    const { rows } = await db.query<OrganizationSubscription>(
      `INSERT INTO organization_subscriptions
         (organization_id, plan_type, monthly_fee, max_linked_groups, max_staff,
          max_funding_programs, sms_allowance_included, white_label_branding,
          advanced_reports, support_tier, is_custom, assigned_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        organizationId, planType, snapshot.monthlyFee.toFixed(2),
        snapshot.maxLinkedGroups, snapshot.maxStaff, snapshot.maxFundingPrograms,
        snapshot.smsAllowanceIncluded.toFixed(2), snapshot.whiteLabelBranding,
        snapshot.advancedReports, snapshot.supportTier, snapshot.isCustom,
        adminId, opts.notes ?? null,
      ],
    );
    const after = rows[0];

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
       VALUES ($1, 'organization.plan_assigned', 'organization', $2, $3::jsonb, $4::jsonb)`,
      [
        adminId, organizationId,
        JSON.stringify(before ? { plan_type: before.plan_type, monthly_fee: before.monthly_fee } : null),
        JSON.stringify({ plan_type: after.plan_type, monthly_fee: after.monthly_fee }),
      ],
    );

    // Grant the bundled SMS allowance immediately, same as a fresh top-up —
    // see organization-plan-allowance.ts's granting helper for why this is a
    // credited balance addition rather than the group side's separate
    // used/included counter (deliberately simpler; see migration 152).
    if (snapshot.smsAllowanceIncluded > 0) {
      await grantSmsAllowanceInTx(db, organizationId, snapshot.smsAllowanceIncluded, adminId, 'Plan assignment allowance');
    }

    return after;
  });
}

/** Current plan + live usage against its caps — for the admin plan card and the org-facing Billing page. */
export async function getOrganizationPlan(organizationId: string): Promise<{
  subscription: OrganizationSubscription | null;
  usage: { linkedGroups: number; staff: number; activeFundingPrograms: number };
}> {
  return withAdminDb(async (db) => {
    const { rows: sub } = await db.query<OrganizationSubscription>(
      `SELECT * FROM organization_subscriptions WHERE organization_id = $1 AND status = 'active'`,
      [organizationId],
    );
    const { rows: usage } = await db.query<{ linked_groups: string; staff: string; active_programs: string }>(
      `SELECT
         (SELECT COUNT(*) FROM organization_group_access WHERE organization_id = $1 AND is_active) AS linked_groups,
         (SELECT COUNT(*) FROM organization_members       WHERE organization_id = $1 AND status = 'active') AS staff,
         (SELECT COUNT(*) FROM funding_programs           WHERE organization_id = $1 AND status = 'active') AS active_programs`,
      [organizationId],
    );
    return {
      subscription: sub[0] ?? null,
      usage: {
        linkedGroups:          Number(usage[0].linked_groups),
        staff:                 Number(usage[0].staff),
        activeFundingPrograms: Number(usage[0].active_programs),
      },
    };
  });
}

/** The active plan's caps/flags, or the Starter defaults when no plan is assigned (see NO_PLAN_DEFAULTS). */
async function getEffectiveLimits(db: PoolClient, organizationId: string): Promise<{
  maxLinkedGroups: number | null; maxStaff: number | null; maxFundingPrograms: number | null;
  whiteLabelBranding: boolean; advancedReports: boolean;
}> {
  const { rows } = await db.query<{
    max_linked_groups: number | null; max_staff: number | null; max_funding_programs: number | null;
    white_label_branding: boolean; advanced_reports: boolean;
  }>(
    `SELECT max_linked_groups, max_staff, max_funding_programs, white_label_branding, advanced_reports
     FROM organization_subscriptions WHERE organization_id = $1 AND status = 'active'`,
    [organizationId],
  );
  if (!rows[0]) {
    return {
      maxLinkedGroups:    NO_PLAN_DEFAULTS.maxLinkedGroups,
      maxStaff:           NO_PLAN_DEFAULTS.maxStaff,
      maxFundingPrograms: NO_PLAN_DEFAULTS.maxFundingPrograms,
      whiteLabelBranding: NO_PLAN_DEFAULTS.whiteLabelBranding,
      advancedReports:    NO_PLAN_DEFAULTS.advancedReports,
    };
  }
  return {
    maxLinkedGroups:    rows[0].max_linked_groups,
    maxStaff:           rows[0].max_staff,
    maxFundingPrograms: rows[0].max_funding_programs,
    whiteLabelBranding: rows[0].white_label_branding,
    advancedReports:    rows[0].advanced_reports,
  };
}

/**
 * Every assert* below takes the PoolClient already open in the caller's own
 * transaction (mirrors billingService.assertMemberCap's exact shape) so the
 * cap check and the row it's protecting commit or roll back together.
 */
export async function assertLinkedGroupCap(db: PoolClient, organizationId: string, groupId: string): Promise<void> {
  const { maxLinkedGroups } = await getEffectiveLimits(db, organizationId);
  if (maxLinkedGroups === null) return;

  // A re-grant of an already-active link is a no-op for the count — only a
  // genuinely NEW (or reactivated-from-revoked) link consumes a slot.
  const { rows: existing } = await db.query<{ is_active: boolean }>(
    `SELECT is_active FROM organization_group_access WHERE organization_id = $1 AND group_id = $2`,
    [organizationId, groupId],
  );
  if (existing[0]?.is_active) return;

  const { rows: count } = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM organization_group_access WHERE organization_id = $1 AND is_active`,
    [organizationId],
  );
  if (parseInt(count[0].n, 10) >= maxLinkedGroups) throw new OrganizationCapError('linked groups', maxLinkedGroups);
}

export async function assertStaffCap(db: PoolClient, organizationId: string): Promise<void> {
  const { maxStaff } = await getEffectiveLimits(db, organizationId);
  if (maxStaff === null) return;

  const { rows: count } = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM organization_members WHERE organization_id = $1 AND status = 'active'`,
    [organizationId],
  );
  if (parseInt(count[0].n, 10) >= maxStaff) throw new OrganizationCapError('staff seats', maxStaff);
}

export async function assertFundingProgramCap(db: PoolClient, organizationId: string): Promise<void> {
  const { maxFundingPrograms } = await getEffectiveLimits(db, organizationId);
  if (maxFundingPrograms === null) return;

  const { rows: count } = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM funding_programs WHERE organization_id = $1 AND status = 'active'`,
    [organizationId],
  );
  if (parseInt(count[0].n, 10) >= maxFundingPrograms) throw new OrganizationCapError('active funding programs', maxFundingPrograms);
}

export async function assertReportsAccess(db: PoolClient, organizationId: string): Promise<void> {
  const { advancedReports } = await getEffectiveLimits(db, organizationId);
  if (!advancedReports) throw new OrganizationFeatureGatedError('Advanced reports', 'Growth');
}

export async function assertWhiteLabelAccess(db: PoolClient, organizationId: string): Promise<void> {
  const { whiteLabelBranding } = await getEffectiveLimits(db, organizationId);
  if (!whiteLabelBranding) throw new OrganizationFeatureGatedError('White-label branding', 'Premium+');
}

/**
 * Credits the bundled allowance directly onto the org's SMS balance via the
 * existing generic ledger function — reuses sms_ledger_append's
 * allowance_amount column (migration 141), the first time it's ever been
 * used for an organization. Runs on the CALLER's open transaction/client so
 * a plan assignment and its allowance grant commit atomically.
 */
async function grantSmsAllowanceInTx(
  db: PoolClient, organizationId: string, amount: number, adminId: string, notes: string,
): Promise<void> {
  const { rows: account } = await db.query<{ id: string }>(
    `INSERT INTO organization_billing_accounts (organization_id) VALUES ($1)
     ON CONFLICT (organization_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [organizationId],
  );
  const { rows: after } = await db.query<{ sms_credits: string }>(
    `UPDATE organization_billing_accounts
     SET sms_credits = sms_credits + $1, sms_allowance_period_start = NOW(), updated_at = NOW()
     WHERE organization_id = $2 RETURNING sms_credits`,
    [amount.toFixed(4), organizationId],
  );
  void account; // id not needed beyond ensuring the row exists
  await db.query(
    `SELECT sms_ledger_append($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9::uuid,$10::uuid,$11::uuid,$12)`,
    ['organization', null, organizationId, 'adjustment', amount.toFixed(4), amount.toFixed(4),
     after[0]?.sms_credits ?? null, 'plan_allowance', null, null, actorId(adminId), notes],
  );
}

/**
 * Daily job (mirrors resetDueSmsAllowances' anniversary-anchored shape
 * exactly, migration 151) — grants each organization's bundled allowance once
 * per monthly anniversary of its subscription's started_at. Idempotent: an
 * org whose sms_allowance_period_start already covers the current period is
 * skipped by the WHERE clause, so running this hourly or twice in a minute
 * cannot double-grant.
 */
export async function grantDueOrganizationSmsAllowances(): Promise<{ organizationsGranted: number }> {
  return withAdminDb(async (db) => {
    const { rows: due } = await db.query<{
      organization_id: string; allowance: string;
    }>(
      `SELECT s.organization_id, s.sms_allowance_included AS allowance
       FROM organization_subscriptions s
       JOIN organization_billing_accounts ba ON ba.organization_id = s.organization_id
       WHERE s.status = 'active' AND s.sms_allowance_included > 0
         AND (
           ba.sms_allowance_period_start IS NULL
           OR ba.sms_allowance_period_start < (
             s.started_at::date
               + ((date_part('year',  age(CURRENT_DATE, s.started_at::date)) * 12
                 + date_part('month', age(CURRENT_DATE, s.started_at::date)))::int)
                 * INTERVAL '1 month'
           )::date
         )`,
    );

    for (const row of due) {
      await grantSmsAllowanceInTx(db, row.organization_id, Number(row.allowance), 'system', 'Monthly plan allowance');
    }
    return { organizationsGranted: due.length };
  });
}

/** Read-only, RLS-scoped — for the coordinator's own Billing page (real app_tenant enforcement, not the admin pool). */
export async function getOrganizationPlanForCoordinator(ctx: TenantContext): Promise<OrganizationSubscription | null> {
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  return withDb(ctx, async (db) => {
    const { rows } = await db.query<OrganizationSubscription>(
      `SELECT * FROM organization_subscriptions WHERE organization_id = $1 AND status = 'active'`,
      [ctx.organizationId],
    );
    return rows[0] ?? null;
  });
}
