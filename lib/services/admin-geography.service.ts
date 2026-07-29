/**
 * County/ward-level rollup for the platform's existing geographic hierarchy
 * (counties → sub_counties → wards, seeded from the IEBC dataset) —
 * SUPER_ADMIN_PLATFORM_AUDIT.md Phase 3. `groups.county_id` is the
 * consistently-written FK (used here); `groups.ward_id`/`sub_county_id` are
 * unpopulated dead schema, so ward-level rollup groups on the free-text
 * `groups.ward` column instead, scoped to a county for the drill-down.
 * "Start with a sortable table before an interactive map" — no map yet.
 */
import { withAdminDb } from '@/lib/db';
import type { PoolClient } from 'pg';
import { cached, keys } from '@/lib/redis';

/** Every county, including ones with zero groups — a coverage gap is itself signal. */
export async function getCountyAggregation() {
  return cached(keys.cache('geography-counties', 'platform'), 120, () => withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query(`
      SELECT
        c.id AS county_id, c.name AS county_name, c.region,
        COUNT(DISTINCT g.id) AS group_count,
        COUNT(DISTINCT gm.id) FILTER (WHERE gm.status = 'active') AS member_count,
        COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'completed'), 0) AS total_contributions,
        COALESCE(SUM(l.principal_amount) FILTER (WHERE l.status IN ('active', 'disbursed')), 0) AS loan_book
      FROM public.counties c
      LEFT JOIN public.groups g ON g.county_id = c.id
      LEFT JOIN public.group_members gm ON gm.group_id = g.id
      LEFT JOIN public.contributions cn ON cn.group_id = g.id
      LEFT JOIN public.loans l ON l.group_id = g.id
      GROUP BY c.id, c.name, c.region
      ORDER BY group_count DESC, c.name
    `);
    return rows;
  }));
}

/** Ward breakdown within one county, for the table's row drill-down. */
export async function getWardAggregation(countyId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query(`
      SELECT
        COALESCE(NULLIF(TRIM(g.ward), ''), 'Unspecified') AS ward,
        COUNT(DISTINCT g.id) AS group_count,
        COUNT(DISTINCT gm.id) FILTER (WHERE gm.status = 'active') AS member_count,
        COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'completed'), 0) AS total_contributions
      FROM public.groups g
      LEFT JOIN public.group_members gm ON gm.group_id = g.id
      LEFT JOIN public.contributions cn ON cn.group_id = g.id
      WHERE g.county_id = $1
      GROUP BY 1
      ORDER BY group_count DESC, ward
    `, [countyId]);
    return rows;
  });
}
