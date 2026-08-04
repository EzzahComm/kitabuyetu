/**
 * UX_UI_OPTIMIZATION_AUDIT_2026-08.md Phase 1 (C3): a plain 'member' — who
 * holds none of the officer permissions (dashboard.view/meetings.view only)
 * — previously always landed on the full officer dashboard, where nearly
 * every action is a permission dead-end, while the simplified (member)
 * portal built for their access level sat completely unreachable.
 * Chairperson/treasurer/secretary keep landing on /dashboard; they need its
 * officer tooling. Used at both fresh login and group-switch time, since
 * switching groups can change which role applies.
 */
export function postLoginPath(groupRole: string | undefined): string {
  return groupRole === 'member' ? '/me' : '/dashboard';
}
