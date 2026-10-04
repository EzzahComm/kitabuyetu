/**
 * The Changi$ha plan: a group may create and launch campaigns only while it
 * holds an active 'changisha' subscription (migration 213), bought through the
 * shared plan checkout. Withdrawals of money already raised are deliberately
 * NOT gated here: a lapsed plan must not trap donors' money.
 */
import type { PoolClient } from 'pg';
import { AppError } from '@/lib/utils/errors';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import type { CampaignOfficerStatus } from './campaign-officers.service';

type Queryable = Pick<PoolClient, 'query'>;

/** What GET /campaigns/eligibility returns: the offices, the plan, and whether both are in place. */
export interface CampaignEligibility extends CampaignOfficerStatus {
  planActive: boolean;
  eligible: boolean;
}

export class ChangishaPlanRequiredError extends AppError {
  constructor() {
    super(
      `Subscribe to a Changi$ha plan (from KES ${PLAN_MONTHLY_FEES.changisha.starter} a month) to create or launch campaigns.`,
      'CHANGISHA_PLAN_REQUIRED',
      402,
    );
    this.name = 'ChangishaPlanRequiredError';
  }
}

export async function hasActiveChangishaPlan(db: Queryable, groupId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM subscriptions
     WHERE  group_id = $1 AND product = 'changisha' AND status IN ('active', 'trial')
     LIMIT  1`,
    [groupId],
  );
  return rows.length > 0;
}

/** Throws ChangishaPlanRequiredError unless the group's Changi$ha plan is active. */
export async function assertChangishaPlanActive(db: Queryable, groupId: string): Promise<void> {
  if (!(await hasActiveChangishaPlan(db, groupId))) throw new ChangishaPlanRequiredError();
}
