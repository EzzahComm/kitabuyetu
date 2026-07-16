/**
 * FinePolicy — advisory fine schedule per group (domain 'fine', key
 * 'schedule'), migrated from the retired group_constitutions.fine_schedule
 * column by migration 088 (ACCOUNTING_ARCHITECTURE_AUDIT.md §33.1). A typed
 * wrapper over configuration.service.ts, same shape as ApprovalPolicy and
 * LoanPolicy.
 *
 * Advisory only: 'fine' exists as a payment-request category (migration
 * 059), and these amounts are the group's reference tariff for each offence
 * — nothing auto-charges them.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'fine';
const POLICY_KEY = 'schedule';

/** Offence category -> fine amount (KES). Keys are group-defined. */
export type FineSchedule = Record<string, number>;

// Kept identical to migration 088's seed (the retired
// group_constitutions.fine_schedule column default).
const DEFAULT_FINE_SCHEDULE: FineSchedule = {
  late_attendance: 50, absence: 100, misconduct: 200,
};

export interface EffectiveFineSchedule {
  schedule: FineSchedule;
  source:   PolicySource;
}

function validateSchedule(schedule: FineSchedule): void {
  const entries = Object.entries(schedule);
  if (entries.length === 0) throw new ValidationError('Fine schedule must have at least one offence category');
  if (entries.length > 50) throw new ValidationError('Fine schedule cannot have more than 50 categories');
  for (const [category, amount] of entries) {
    if (!category.trim()) throw new ValidationError('Offence category names cannot be blank');
    if (!(typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)) {
      throw new ValidationError(`${category}: amount must be zero or positive`);
    }
  }
}

export const finePolicyService = {
  async getGroupSchedule(ctx: TenantContext): Promise<EffectiveFineSchedule> {
    return withDb(ctx, async (client) => {
      const resolved = await resolvePolicyDetailed<FineSchedule>(
        client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, DEFAULT_FINE_SCHEDULE,
      );
      return { schedule: resolved.value, source: resolved.source };
    });
  },

  /** Access gated at the route (withRole(req, 'chairperson', ...)) — sets the whole group's fine tariff. */
  async setGroupOverride(ctx: TenantContext, schedule: FineSchedule): Promise<void> {
    validateSchedule(schedule);
    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, schedule, ctx.userId);
    });
  },

  /** Platform-wide default — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformSchedule(client: PoolClient): Promise<EffectiveFineSchedule> {
    const resolved = await resolvePolicyDetailed<FineSchedule>(client, DOMAIN, POLICY_KEY, {}, DEFAULT_FINE_SCHEDULE);
    return { schedule: resolved.value, source: resolved.source };
  },

  async setPlatformDefault(userId: string, client: PoolClient, schedule: FineSchedule): Promise<void> {
    validateSchedule(schedule);
    await setPolicy(client, DOMAIN, POLICY_KEY, {}, schedule, userId);
  },
};
