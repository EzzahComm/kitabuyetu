/**
 * ApprovalPolicy — the first Configuration Service domain wired end-to-end
 * (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.5 names AccountingPolicy/LoanPolicy
 * as the two domains to build first; ApprovalPolicy is the accounting-side
 * proof). Unifies three flat, independent columns §25's Policy Inheritance &
 * Override Matrix found broken today:
 *   - groups.journal_approval_threshold           (manual journal maker-checker)
 *   - groups.disbursement_approval_threshold      (group B2C payout maker-checker)
 *   - organizations.disbursement_approval_threshold (org->group funding maker-checker)
 * into one cascading, versioned Platform -> Organization -> Group resolver.
 *
 * `journal_threshold` is the one key with a DB-level enforcement backstop
 * (migration 081's assert_journal_maker_checker trigger, reading
 * groups.journal_approval_threshold directly) — deliberately left
 * untouched, since it is the authoritative, already-proven guard against a
 * bypassed application check. Rather than teach that trigger to resolve a
 * cascade itself, every write here keeps the flat column in sync as a
 * denormalized cache of "the effective value right now" so the trigger
 * keeps working exactly as before. `group_disbursement_threshold` and
 * `org_disbursement_threshold` have no DB trigger (they only ever decided a
 * requires_approval flag at request-creation time), so those two are read
 * straight from the resolver with nothing to keep in sync.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { organizationService } from './organization.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'approval';

export type ApprovalPolicyKey =
  | 'journal_threshold'
  | 'group_disbursement_threshold'
  | 'org_disbursement_threshold';

interface ThresholdValue { threshold: number }

const FALLBACKS: Record<ApprovalPolicyKey, number> = {
  journal_threshold:            0,
  group_disbursement_threshold: 20000,
  org_disbursement_threshold:   50000,
};

export interface EffectiveThreshold {
  key:       ApprovalPolicyKey;
  threshold: number;
  source:    PolicySource;
}

/** Used inline by accounting/disbursement services — no route/role concerns, just a read. */
export async function getEffectiveThreshold(
  client: PoolClient,
  key:    ApprovalPolicyKey,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<number> {
  const { threshold } = await resolvePolicy<ThresholdValue>(
    client, DOMAIN, key, scope, { threshold: FALLBACKS[key] },
  );
  return threshold;
}

/**
 * Keeps groups.journal_approval_threshold (the DB trigger's authoritative
 * read) in sync with whatever the resolver now says is effective, for every
 * group actually affected by the scope that just changed. Deliberately
 * simple (one query to find affected groups, then a loop) rather than a
 * single set-based UPDATE — correct and easy to verify at today's scale;
 * revisit if the platform reaches enough tenants for this to matter.
 */
async function syncJournalThresholdColumn(
  client: PoolClient,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<void> {
  let affectedGroupIds: string[];

  if (scope.groupId) {
    affectedGroupIds = [scope.groupId];
  } else if (scope.organizationId) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT g.id FROM organization_group_access oga
       JOIN groups g ON g.id = oga.group_id
       WHERE oga.organization_id = $1 AND oga.is_active
         AND NOT EXISTS (
           SELECT 1 FROM policies p
           WHERE p.is_active AND p.domain = $2 AND p.policy_key = 'journal_threshold' AND p.group_id = g.id
         )`,
      [scope.organizationId, DOMAIN],
    );
    affectedGroupIds = rows.map((r) => r.id);
  } else {
    const { rows } = await client.query<{ id: string }>(
      `SELECT g.id FROM groups g
       WHERE NOT EXISTS (
         SELECT 1 FROM policies p
         WHERE p.is_active AND p.domain = $1 AND p.policy_key = 'journal_threshold' AND p.group_id = g.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM policies p
         JOIN organization_group_access oga
           ON oga.organization_id = p.organization_id AND oga.is_active AND oga.group_id = g.id
         WHERE p.is_active AND p.domain = $1 AND p.policy_key = 'journal_threshold' AND p.group_id IS NULL
       )`,
      [DOMAIN],
    );
    affectedGroupIds = rows.map((r) => r.id);
  }

  for (const groupId of affectedGroupIds) {
    const threshold = await getEffectiveThreshold(client, 'journal_threshold', { groupId });
    await client.query(
      `UPDATE groups SET journal_approval_threshold = $1 WHERE id = $2`,
      [threshold.toFixed(2), groupId],
    );
  }
}

export const approvalPolicyService = {
  /** Effective thresholds for the caller's own group, with resolution provenance for the settings UI. */
  async getGroupPolicies(ctx: TenantContext): Promise<EffectiveThreshold[]> {
    return withDb(ctx, async (client) => {
      const keys: ApprovalPolicyKey[] = ['journal_threshold', 'group_disbursement_threshold'];
      const results: EffectiveThreshold[] = [];
      for (const key of keys) {
        const resolved = await resolvePolicyDetailed<ThresholdValue>(
          client, DOMAIN, key, { groupId: ctx.groupId }, { threshold: FALLBACKS[key] },
        );
        results.push({ key, threshold: resolved.value.threshold, source: resolved.source });
      }
      return results;
    });
  },

  /**
   * Sets a group-level override. Access is gated at the route (withRole(req,
   * 'treasurer', ...)), same as every other accounting-settings endpoint
   * (fiscal periods, journals, accounts) — not re-checked here.
   */
  async setGroupOverride(ctx: TenantContext, key: ApprovalPolicyKey, threshold: number): Promise<void> {
    if (key === 'org_disbursement_threshold') {
      throw new ValidationError('org_disbursement_threshold has no group-level scope');
    }
    if (!(threshold >= 0)) throw new ValidationError('Threshold must be zero or positive');

    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, key, { groupId: ctx.groupId }, { threshold }, ctx.userId);
      if (key === 'journal_threshold') {
        await syncJournalThresholdColumn(client, { groupId: ctx.groupId });
      }
    });
  },

  /** Effective thresholds for the caller's own organization, with provenance. */
  async getOrganizationPolicies(ctx: TenantContext): Promise<EffectiveThreshold[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (client) => {
      const keys: ApprovalPolicyKey[] = ['org_disbursement_threshold', 'group_disbursement_threshold', 'journal_threshold'];
      const results: EffectiveThreshold[] = [];
      for (const key of keys) {
        const resolved = await resolvePolicyDetailed<ThresholdValue>(
          client, DOMAIN, key, { organizationId: ctx.organizationId }, { threshold: FALLBACKS[key] },
        );
        results.push({ key, threshold: resolved.value.threshold, source: resolved.source });
      }
      return results;
    });
  },

  /**
   * Sets an organization-level override — either the organization's own
   * disbursement threshold, or a default the organization imposes on every
   * group it oversees (which any of those groups can still override
   * locally, per the cascade).
   */
  async setOrganizationOverride(ctx: TenantContext, key: ApprovalPolicyKey, threshold: number): Promise<void> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!(threshold >= 0)) throw new ValidationError('Threshold must be zero or positive');

    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, key, { organizationId: ctx.organizationId }, { threshold }, ctx.userId);
      if (key === 'journal_threshold') {
        await syncJournalThresholdColumn(client, { organizationId: ctx.organizationId });
      }
    });
  },

  /** Platform-wide defaults — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformPolicies(client: PoolClient): Promise<EffectiveThreshold[]> {
    const keys: ApprovalPolicyKey[] = ['journal_threshold', 'group_disbursement_threshold', 'org_disbursement_threshold'];
    const results: EffectiveThreshold[] = [];
    for (const key of keys) {
      const resolved = await resolvePolicyDetailed<ThresholdValue>(
        client, DOMAIN, key, {}, { threshold: FALLBACKS[key] },
      );
      results.push({ key, threshold: resolved.value.threshold, source: resolved.source });
    }
    return results;
  },

  /** Platform-wide default — super_admin only (enforced at the route via withPlatformRole). */
  async setPlatformDefault(userId: string, client: PoolClient, key: ApprovalPolicyKey, threshold: number): Promise<void> {
    if (!(threshold >= 0)) throw new ValidationError('Threshold must be zero or positive');
    await setPolicy(client, DOMAIN, key, {}, { threshold }, userId);
    if (key === 'journal_threshold') {
      await syncJournalThresholdColumn(client, {});
    }
  },
};
