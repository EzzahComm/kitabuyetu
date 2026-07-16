/**
 * Configuration Service / Policy Resolution Engine (ACCOUNTING_ARCHITECTURE_AUDIT.md
 * §29). Generalizes lib/sms/trigger-engine.ts's loadMatchingRules() —
 * group-beats-organization-beats-platform specificity — into one resolver
 * every policy domain shares, instead of each domain reinventing its own
 * override logic (or, worse, never getting one at all, per §22's finding on
 * the orphaned `group_constitutions` table).
 *
 * No application service should ever know whether an effective value came
 * from the platform, an organization, or a group — it asks for the resolved
 * value and gets one answer (§29.3). Domain-specific typed wrappers (see
 * approval-policy.service.ts) are how the rest of the codebase should use
 * this — calling resolvePolicy/setPolicy directly is the escape hatch for
 * building the next domain, not something loan/journal/disbursement code
 * should do inline.
 */
import type { PoolClient } from 'pg';

export interface PolicyScope {
  organizationId?: string | null;
  groupId?:        string | null;
}

interface PolicyRow {
  organization_id: string | null;
  group_id:        string | null;
  value:           unknown;
}

const specificity = (r: { organization_id: string | null; group_id: string | null }): number =>
  r.group_id ? 2 : r.organization_id ? 1 : 0;

export type PolicySource = 'group' | 'organization' | 'platform';

export interface ResolvedPolicy<T> {
  value:  T;
  source: PolicySource;
}

/**
 * Resolves the effective value for (domain, policyKey) at the given scope,
 * along with which tier it came from — the group's own override wins over
 * its organization's, which wins over the platform-wide default
 * (organization_id AND group_id both NULL). Falls back to `fallback` only if
 * no policy row exists at all for this key — every ApprovalPolicy key is
 * seeded platform-wide by migration 086, so this fallback is a defensive
 * floor for domains that haven't seeded one yet.
 */
export async function resolvePolicyDetailed<T>(
  client:     PoolClient,
  domain:     string,
  policyKey:  string,
  scope:      PolicyScope,
  fallback:   T,
): Promise<ResolvedPolicy<T>> {
  const { rows } = await client.query<PolicyRow>(
    `SELECT organization_id, group_id, value FROM policies
     WHERE is_active AND domain = $1 AND policy_key = $2
       AND (
         (organization_id IS NULL AND group_id IS NULL)
         OR (group_id = $4)
         OR (organization_id = $3)
         OR (group_id IS NULL AND organization_id IN (
               SELECT oga.organization_id FROM organization_group_access oga
               WHERE oga.group_id = $4 AND oga.is_active
             ))
       )`,
    [domain, policyKey, scope.organizationId ?? null, scope.groupId ?? null],
  );
  if (rows.length === 0) return { value: fallback, source: 'platform' };

  const winner = rows.reduce((best, r) => (specificity(r) > specificity(best) ? r : best));
  const source: PolicySource = winner.group_id ? 'group' : winner.organization_id ? 'organization' : 'platform';
  return { value: winner.value as T, source };
}

/** Convenience wrapper over resolvePolicyDetailed for callers that only need the value. */
export async function resolvePolicy<T>(
  client:     PoolClient,
  domain:     string,
  policyKey:  string,
  scope:      PolicyScope,
  fallback:   T,
): Promise<T> {
  return (await resolvePolicyDetailed(client, domain, policyKey, scope, fallback)).value;
}

/**
 * Writes a new policy version at the given scope, retiring whatever was
 * previously active there (§29.8 — never overwrite). Scope must be exactly
 * one of: platform-wide (both null), organization-wide (organizationId set,
 * groupId null), or group-specific (groupId set) — resolvePolicy's
 * cascade only cares about these three shapes.
 */
export async function setPolicy(
  client:     PoolClient,
  domain:     string,
  policyKey:  string,
  scope:      PolicyScope,
  value:      unknown,
  createdBy:  string | null,
): Promise<{ id: string; version: number }> {
  const organizationId = scope.organizationId ?? null;
  const groupId         = scope.groupId ?? null;

  const { rows: existing } = await client.query<{ id: string; version: number }>(
    `SELECT id, version FROM policies
     WHERE is_active AND domain = $1 AND policy_key = $2
       AND organization_id IS NOT DISTINCT FROM $3
       AND group_id        IS NOT DISTINCT FROM $4
     FOR UPDATE`,
    [domain, policyKey, organizationId, groupId],
  );

  if (existing[0]) {
    await client.query(
      `UPDATE policies SET is_active = false, effective_to = NOW() WHERE id = $1`,
      [existing[0].id],
    );
  }

  const { rows } = await client.query<{ id: string; version: number }>(
    `INSERT INTO policies (domain, policy_key, organization_id, group_id, value, version, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, version`,
    [domain, policyKey, organizationId, groupId, JSON.stringify(value), (existing[0]?.version ?? 0) + 1, createdBy],
  );
  return rows[0];
}
