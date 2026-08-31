export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { SmsGroupSettingsUpdateSchema } from '@/lib/validators/sms.schema';
import { ok } from '@/lib/utils/response';

/**
 * Per-group messaging settings — in practice, the automation toggles.
 *
 * `sms_group_settings.auto_send_birthday` has existed since migration 013 and
 * the job that reads it shipped in Phase 1, but there has never been an API or
 * a UI for it: the column could only be flipped with direct SQL, so the feature
 * was effectively unarmable from inside the product. Same for the other three
 * auto_send_* flags.
 *
 * withAdminDb rather than withDb because register_group never creates this row
 * — the PUT has to be able to INSERT it, and there is nothing to read until it
 * does. Both handlers scope explicitly by auth.groupId.
 */

const DEFAULTS = {
  autoSendContribution: false,
  autoSendLoan:         false,
  autoSendMeeting:      false,
  autoSendBirthday:     false,
  senderId:             null as string | null,
  dailySendLimit:       null as number | null,
};

interface SettingsRow {
  sender_id:               string | null;
  auto_send_contribution:  boolean;
  auto_send_loan:          boolean;
  auto_send_meeting:       boolean;
  auto_send_birthday:      boolean;
  daily_send_limit:        number | null;
}

const present = (row: SettingsRow | undefined) => row ? {
  senderId:             row.sender_id,
  autoSendContribution: row.auto_send_contribution,
  autoSendLoan:         row.auto_send_loan,
  autoSendMeeting:      row.auto_send_meeting,
  autoSendBirthday:     row.auto_send_birthday,
  dailySendLimit:       row.daily_send_limit,
} : DEFAULTS;

export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async (auth) => {
    const { rows } = await withAdminDb((db) => db.query<SettingsRow>(
      `SELECT sender_id, auto_send_contribution, auto_send_loan,
              auto_send_meeting, auto_send_birthday, daily_send_limit
         FROM sms_group_settings WHERE group_id = $1`,
      [auth.groupId],
    ));
    // A group with no row has every automation off, which is the same thing
    // the jobs see — they INNER JOIN this table, so no row means no sends.
    return ok(present(rows[0]));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.manage', async (auth) => {
    const input = SmsGroupSettingsUpdateSchema.parse(await req.json());

    const { rows } = await withAdminDb((db) => db.query<SettingsRow>(
      // Upsert: the row may genuinely not exist yet. COALESCE on every column
      // makes this a partial update — a page that only toggles birthdays must
      // not silently clear the other three automations.
      // daily_send_limit needs a different partial-update idiom from the four
      // booleans. COALESCE cannot express it: null is a MEANINGFUL value here
      // ("no cap"), so COALESCE($6, existing) could only ever set a limit,
      // never clear one. $7 states whether the caller mentioned the field at
      // all, which separates "leave it alone" from "set it to null".
      `INSERT INTO sms_group_settings
         (group_id, auto_send_contribution, auto_send_loan, auto_send_meeting, auto_send_birthday, daily_send_limit)
       VALUES ($1, COALESCE($2, false), COALESCE($3, false), COALESCE($4, false), COALESCE($5, false), $6)
       ON CONFLICT (group_id) DO UPDATE SET
         auto_send_contribution = COALESCE($2, sms_group_settings.auto_send_contribution),
         auto_send_loan         = COALESCE($3, sms_group_settings.auto_send_loan),
         auto_send_meeting      = COALESCE($4, sms_group_settings.auto_send_meeting),
         auto_send_birthday     = COALESCE($5, sms_group_settings.auto_send_birthday),
         daily_send_limit       = CASE WHEN $7::boolean THEN $6::integer
                                       ELSE sms_group_settings.daily_send_limit END,
         updated_at             = NOW()
       RETURNING sender_id, auto_send_contribution, auto_send_loan,
                 auto_send_meeting, auto_send_birthday, daily_send_limit`,
      [
        auth.groupId,
        input.autoSendContribution ?? null,
        input.autoSendLoan         ?? null,
        input.autoSendMeeting      ?? null,
        input.autoSendBirthday     ?? null,
        input.dailySendLimit ?? null,
        Object.prototype.hasOwnProperty.call(input, 'dailySendLimit'),
      ],
    ));

    return ok(present(rows[0]));
  });
}
