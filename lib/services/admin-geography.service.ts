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
      -- group_stats pre-aggregates each child table PER GROUP first: joining
      -- group_members/contributions/loans directly onto counties (one row per
      -- group, all sharing the same county) fans every contribution and loan
      -- row out across every member row of the same group before the SUM
      -- runs, then again across every OTHER group in the same county. Proven
      -- live: Bungoma's loan_book read KES 32,100,000 here vs a real
      -- KES 1,070,000 — a 30x inflation — same bug class as
      -- admin.service.ts's getGroupById (99x on a single group there).
      WITH group_stats AS (
        SELECT g.id AS group_id, g.county_id,
          (SELECT COUNT(*) FROM public.group_members gm
            WHERE gm.group_id = g.id AND gm.status = 'active') AS member_count,
          (SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0)
             FROM public.contributions cn WHERE cn.group_id = g.id) AS total_contributions,
          (SELECT COALESCE(SUM(principal_amount) FILTER (WHERE status IN ('active', 'disbursed')), 0)
             FROM public.loans l WHERE l.group_id = g.id) AS loan_book
        FROM public.groups g
      )
      SELECT
        c.id AS county_id, c.name AS county_name, c.region,
        COUNT(DISTINCT g.id) AS group_count,
        COALESCE(SUM(gs.member_count), 0) AS member_count,
        COALESCE(SUM(gs.total_contributions), 0) AS total_contributions,
        COALESCE(SUM(gs.loan_book), 0) AS loan_book
      FROM public.counties c
      LEFT JOIN public.groups g ON g.county_id = c.id
      LEFT JOIN group_stats gs ON gs.group_id = g.id
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
      -- LATERAL per child table — see getCountyAggregation's comment above
      -- for why a flat join of group_members alongside contributions fans
      -- the contributions SUM out across the member count.
      SELECT
        COALESCE(NULLIF(TRIM(g.ward), ''), 'Unspecified') AS ward,
        COUNT(DISTINCT g.id) AS group_count,
        COALESCE(SUM(mem.member_count), 0) AS member_count,
        COALESCE(SUM(con.total_contributions), 0) AS total_contributions
      FROM public.groups g
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS member_count FROM public.group_members gm
        WHERE gm.group_id = g.id AND gm.status = 'active'
      ) mem ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'completed'), 0) AS total_contributions
        FROM public.contributions cn WHERE cn.group_id = g.id
      ) con ON true
      WHERE g.county_id = $1
      GROUP BY 1
      ORDER BY group_count DESC, ward
    `, [countyId]);
    return rows;
  });
}
