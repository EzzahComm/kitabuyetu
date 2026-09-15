/**
 * Shared React Query key factory for the enterprise/organization portal.
 *
 * Before this existed, Portfolio/Branches/Disbursements/Reports used an
 * `['enterprise', ...]` namespace while Funding Portal used `['organization',
 * ...]` for the SAME server endpoints (dashboard, health, groups,
 * disbursements, accounting, budget/donor reports) — React Query's
 * prefix-matching invalidation means a write in one namespace invalidates
 * nothing the other namespace's pages read, so after a deposit/disburse/
 * program change the Portfolio KPI tiles, the Disbursements wallet tile and
 * the Reports budget/donor tables kept showing pre-write numbers until their
 * own staleTime lapsed (docs/audits/optimization-2026-09). One namespace,
 * one factory, matching the memberKeys pattern (hooks/use-members.ts).
 *
 * `groups`/`disbursements` take the query's actual params as part of the
 * key — different pages request different limits/pages for these two, and
 * giving them identical keys despite different params would make React
 * Query serve one page's cached shape to another (confirmed live: the
 * Portfolio page's unparam'd `groups()` call and the Disbursements page's
 * `groups({ limit: 200 })` call already collided under the old bare
 * `['enterprise', 'groups']` key before this factory existed).
 */
export const enterpriseKeys = {
  all: ['enterprise'] as const,
  dashboard: () => [...enterpriseKeys.all, 'dashboard'] as const,
  health: () => [...enterpriseKeys.all, 'health'] as const,
  groups: (params?: Record<string, unknown>) => [...enterpriseKeys.all, 'groups', params] as const,
  wallet: () => [...enterpriseKeys.all, 'wallet'] as const,
  programs: () => [...enterpriseKeys.all, 'programs'] as const,
  programGroups: (programId: string) => [...enterpriseKeys.all, 'program-groups', programId] as const,
  /** Prefix-only — pass no params to build an invalidation key that matches every disbursements query regardless of its own params. */
  disbursements: (params?: Record<string, unknown>) =>
    params === undefined
      ? ([...enterpriseKeys.all, 'disbursements'] as const)
      : ([...enterpriseKeys.all, 'disbursements', params] as const),
  accounting: () => [...enterpriseKeys.all, 'accounting'] as const,
  reportsBudget: () => [...enterpriseKeys.all, 'reports', 'budget'] as const,
  reportsDonor: () => [...enterpriseKeys.all, 'reports', 'donor'] as const,
  policies: () => [...enterpriseKeys.all, 'policies'] as const,
  members: (page?: number, search?: string) => [...enterpriseKeys.all, 'members', page, search] as const,
  auditLogs: (page?: number, search?: string) => [...enterpriseKeys.all, 'audit-logs', page, search] as const,
  branding: () => [...enterpriseKeys.all, 'branding'] as const,
  smsCredits: () => [...enterpriseKeys.all, 'sms-credits'] as const,
  plan: () => [...enterpriseKeys.all, 'plan'] as const,
};
