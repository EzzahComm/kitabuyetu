/**
 * Unified cross-entity search for the (admin) command palette and topbar —
 * SUPER_ADMIN_PLATFORM_AUDIT.md Phase 3. The palette's ⌘K shell already
 * existed; this is the missing data source (previously pure static nav).
 */
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';

export interface PlatformSearchResults {
  organizations: Array<{ id: string; name: string; type: string; registration_number: string | null }>;
  groups: Array<{ id: string; name: string; group_type: string; group_code: string | null }>;
  members: Array<{
    id: string; first_name: string; last_name: string; phone: string | null;
    member_code: string | null; group_id: string | null; group_name: string | null;
  }>;
}

export async function searchPlatform(query: string, limit = 5): Promise<PlatformSearchResults> {
  return withAdminDb(async (db: PoolClient) => {
    const q = `%${query}%`;
    const [orgs, groups, members] = await Promise.all([
      db.query(
        `SELECT id, name, type, registration_number FROM public.organizations
         WHERE name ILIKE $1 OR registration_number ILIKE $1 OR phone ILIKE $1
         ORDER BY name LIMIT $2`,
        [q, limit],
      ),
      db.query(
        `SELECT id, name, type AS group_type, group_code FROM public.groups
         WHERE name ILIKE $1 OR registration_number ILIKE $1 OR group_code ILIKE $1
         ORDER BY name LIMIT $2`,
        [q, limit],
      ),
      // member_code (the membership number) lives on group_members, not members.
      db.query(
        `SELECT m.id, m.first_name, m.last_name, m.phone, gm.member_code, gm.group_id, g.name AS group_name
         FROM public.members m
         LEFT JOIN public.group_members gm ON gm.member_id = m.id AND gm.status = 'active'
         LEFT JOIN public.groups g ON g.id = gm.group_id
         WHERE m.first_name ILIKE $1 OR m.last_name ILIKE $1 OR m.phone ILIKE $1 OR gm.member_code ILIKE $1
         ORDER BY m.first_name LIMIT $2`,
        [q, limit],
      ),
    ]);
    return { organizations: orgs.rows, groups: groups.rows, members: members.rows };
  });
}
