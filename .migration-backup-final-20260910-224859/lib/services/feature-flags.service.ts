/**
 * Runtime feature-flag evaluation (ACCOUNTING_ARCHITECTURE_AUDIT.md §33.4).
 * feature_flags has carried rollout_pct / applies_to / conditions targeting
 * columns since migration 025, but §22 found no code path had ever evaluated
 * them — the table was a de facto global boolean list that only the admin
 * portal read. This service makes the declared semantics real (confirmed
 * product decision: build evaluation, don't drop the columns):
 *
 *   enabled=false           -> off for everyone, unconditionally.
 *   applies_to='all'        -> on for everyone.
 *   applies_to='plan'       -> on for groups whose active/trial subscription
 *                              plan is >= conditions.min_plan
 *                              (starter < growth < enterprise).
 *   applies_to='group'      -> on only for groups in conditions.group_ids.
 *   applies_to='member'     -> on only for members in conditions.member_ids.
 *   rollout_pct < 100       -> deterministic percentage rollout: the same
 *                              group (or member) always hashes into the same
 *                              bucket, so a flag never flickers between
 *                              requests.
 *
 * Fail-open for UNKNOWN keys: a lookup for a key with no row returns true,
 * so gating a long-shipped module behind a flag can never brick it on an
 * environment whose seeds predate the flag. A row that exists is honored
 * exactly.
 */
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { withDb, type TenantContext } from '@/lib/db';
import { ForbiddenError } from '@/lib/utils/errors';

// Ordinal only — must stay in step with the plan_type enum's own ordering
// (migration 138 inserted `premium` BEFORE 'enterprise' for the same reason).
// An unranked plan scores -1 via the lookups below, so a missing entry fails
// closed rather than granting access.
const PLAN_RANK: Record<string, number> = { starter: 0, growth: 1, premium: 2, enterprise: 3 };

interface FlagRow {
  enabled:     boolean;
  rollout_pct: number;
  applies_to:  'all' | 'plan' | 'group' | 'member';
  conditions:  { min_plan?: string; group_ids?: string[]; member_ids?: string[] } | null;
}

/** Deterministic [0,100) bucket — same subject always lands in the same bucket for a given key. */
function rolloutBucket(key: string, subjectId: string): number {
  const digest = createHash('sha256').update(`${key}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export async function isFeatureEnabled(
  client: PoolClient,
  key:    string,
  scope:  { groupId?: string | null; memberId?: string | null },
): Promise<boolean> {
  const { rows } = await client.query<FlagRow>(
    `SELECT enabled, rollout_pct, applies_to, conditions FROM feature_flags WHERE key = $1`,
    [key],
  );
  if (rows.length === 0) return true; // unknown key — fail open (see header)

  const flag = rows[0];
  if (!flag.enabled) return false;

  const conditions = flag.conditions ?? {};

  switch (flag.applies_to) {
    case 'all':
      break;
    case 'plan': {
      const minPlan = conditions.min_plan;
      if (minPlan !== undefined) {
        if (!(minPlan in PLAN_RANK) || !scope.groupId) return false;
        // Since migration 127 a group can hold one subscription per product,
        // so `ORDER BY started_at DESC LIMIT 1` would gate on whichever product
        // was subscribed to most recently — an arbitrary answer that could flip
        // a flag off just because the group added a second product.
        //
        // Take the HIGHEST-ranked plan the group holds anywhere instead: a
        // min_plan condition asks "has this group paid up to at least X", and
        // ranking happens in TS because PLAN_RANK has no SQL equivalent.
        // Deliberately not scoped to kitabu_yetu — a Chama Reminder flag would
        // need the same gate, and nothing here is product-specific.
        const { rows: subs } = await client.query<{ plan_type: string }>(
          `SELECT plan_type FROM subscriptions
           WHERE group_id = $1 AND status IN ('active', 'trial')`,
          [scope.groupId],
        );
        const bestRank = subs.reduce((best, s) => Math.max(best, PLAN_RANK[s.plan_type] ?? -1), -1);
        if (bestRank < PLAN_RANK[minPlan]) return false;
      }
      break;
    }
    case 'group': {
      const groupIds = conditions.group_ids ?? [];
      if (!scope.groupId || !groupIds.includes(scope.groupId)) return false;
      break;
    }
    case 'member': {
      const memberIds = conditions.member_ids ?? [];
      if (!scope.memberId || !memberIds.includes(scope.memberId)) return false;
      break;
    }
  }

  if (flag.rollout_pct >= 100) return true;
  if (flag.rollout_pct <= 0)   return false;
  const subject = scope.groupId ?? scope.memberId;
  if (!subject) return false; // percentage rollout needs a stable subject
  return rolloutBucket(key, subject) < flag.rollout_pct;
}

export const featureFlagsService = {
  /**
   * Route-level gate: throws ForbiddenError when the flag resolves off for
   * this tenant. Used by module entry routes (welfare, investments,
   * meetings) — the flags seeded for those modules are enabled/'all' today,
   * so wiring this changes zero current behavior while making the admin
   * portal's toggles actually mean something.
   */
  async assertEnabled(ctx: TenantContext, key: string): Promise<void> {
    const enabled = await withDb(ctx, (client) =>
      isFeatureEnabled(client, key, { groupId: ctx.groupId, memberId: ctx.userId }),
    );
    if (!enabled) {
      throw new ForbiddenError('This feature is not enabled for your group');
    }
  },
};
