export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok } from '@/lib/utils/response';

/**
 * Birthday automation, read-only.
 *
 * Sending shipped in Phase 1 as a global daily job (handleSmsBirthdayReminders)
 * with no surface anywhere in the product to see it — a group could have the
 * automation on and never know whether a message went out. This adds the view,
 * and no sending logic whatsoever.
 *
 * Two halves, deliberately from two different sources:
 *   upcoming — who has a birthday soon, from members.date_of_birth. Forward
 *              looking; nothing has been sent for these yet.
 *   history  — what was actually dispatched, from reminder_dispatch_log. That
 *              table is the job's own dedup ledger, so it is the truth about
 *              what happened rather than a reconstruction.
 */

const UPCOMING_DAYS = 30;

export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async (auth) => {
    const { upcoming, history } = await withAdminDb(async (db) => {
      const [up, hist] = await Promise.all([
        db.query(
          // The next OCCURRENCE of each birthday, computed once in a LATERAL so
          // the filter and the ordering cannot disagree. Two traps this avoids:
          //
          //  - The stored YEAR is irrelevant, so anything comparing
          //    date_of_birth directly against CURRENT_DATE returns nothing.
          //  - The window wraps: on 20 December, a 3 January birthday IS
          //    upcoming. Computing the occurrence first turns that from special
          //    -case logic into a plain BETWEEN.
          //
          // 29 February is folded to 28 February in non-leap years, which is
          // what MAKE_DATE would otherwise reject outright.
          `SELECT m.id            AS "memberId",
                  m.first_name    AS "firstName",
                  m.last_name     AS "lastName",
                  m.date_of_birth AS "dateOfBirth",
                  gm.id           AS "membershipId",
                  nb.next_birthday AS "nextBirthday"
             FROM members m
             JOIN group_members gm ON gm.member_id = m.id
             CROSS JOIN LATERAL (
               SELECT MIN(d) AS next_birthday
                 FROM (
                   SELECT MAKE_DATE(
                            y,
                            EXTRACT(MONTH FROM m.date_of_birth)::int,
                            LEAST(
                              EXTRACT(DAY FROM m.date_of_birth)::int,
                              EXTRACT(DAY FROM (
                                MAKE_DATE(y, EXTRACT(MONTH FROM m.date_of_birth)::int, 1)
                                + INTERVAL '1 month - 1 day'
                              ))::int
                            )
                          ) AS d
                     FROM (VALUES
                       (EXTRACT(YEAR FROM CURRENT_DATE)::int),
                       (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
                     ) AS years(y)
                 ) candidates
                WHERE d >= CURRENT_DATE
             ) nb
            WHERE gm.group_id = $1
              AND gm.status = 'active'
              AND m.date_of_birth IS NOT NULL
              AND nb.next_birthday <= CURRENT_DATE + $2::int
            ORDER BY nb.next_birthday
            LIMIT 100`,
          [auth.groupId, UPCOMING_DAYS],
        ),
        db.query(
          // reference_id is the MEMBERSHIP row (gm.id), not the member — see
          // handleSmsBirthdayReminders for why. Joining on m.id here would
          // return nothing.
          `SELECT rdl.id,
                  rdl.status,
                  rdl.channel,
                  rdl.reason,
                  rdl.attempts,
                  rdl.sent_at        AS "sentAt",
                  rdl.created_at     AS "createdAt",
                  rdl.reminder_stage AS "stage",
                  m.first_name       AS "firstName",
                  m.last_name        AS "lastName"
             FROM reminder_dispatch_log rdl
             JOIN members m ON m.id = rdl.member_id
            WHERE rdl.group_id = $1
              AND rdl.reference_type = 'birthday'
            ORDER BY rdl.created_at DESC
            LIMIT 100`,
          [auth.groupId],
        ),
      ]);
      return { upcoming: up.rows, history: hist.rows };
    });

    return ok({ upcoming, history });
  });
}
