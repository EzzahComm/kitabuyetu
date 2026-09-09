/**
 * Send the welcome SMS to members who joined before the member_welcome
 * trigger existed.
 *
 * The rule (migration 157) and the emitter (members.service.create) only
 * cover members added from now on. Anyone already in a group when the rule
 * landed never had the event emitted for them, so this replays it.
 *
 * SAFE TO RUN TWICE. emitBusinessEvent claims an execution row keyed on
 * (rule, eventId), and eventId here is the member id — exactly what the live
 * path uses. A second run finds the execution already claimed and suppresses
 * the send rather than double-messaging anyone.
 *
 * Dispatch is INLINE, not queued: member_welcome has delay_seconds = 0, so
 * this does not depend on the job queue (which at time of writing has an
 * 11.5k backlog). Messages go out as the script runs.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-member-welcome-sms.ts <groupId>
 *   npx tsx --env-file=.env.local scripts/backfill-member-welcome-sms.ts <groupId> --apply
 */
import { withAdminDb } from '../lib/db';
import { emitBusinessEvent } from '../lib/sms/trigger-engine';
import { SMS_EVENTS } from '../lib/sms/events';

interface Row {
  id: string;
  first_name: string;
  last_name: string;
  membership_no: string;
  phone: string | null;
  group_name: string;
  /** pg hands back timestamptz as a Date object, not an ISO string. */
  joined_at: Date;
}

async function main() {
  const groupId = process.argv[2];
  const apply   = process.argv.includes('--apply');

  if (!groupId || groupId.startsWith('--')) {
    console.error('usage: backfill-member-welcome-sms.ts <groupId> [--apply]');
    process.exit(1);
  }

  const { rows } = await withAdminDb((db) =>
    db.query<Row>(
      `SELECT m.id, m.first_name, m.last_name, gm.membership_no, m.phone,
              g.name AS group_name, gm.created_at AS joined_at
       FROM   group_members gm
       JOIN   members m ON m.id = gm.member_id
       JOIN   groups  g ON g.id = gm.group_id
       WHERE  gm.group_id = $1
         AND  gm.status = 'active'
         AND  m.phone IS NOT NULL
         -- Skip anyone the engine has already run this rule for, so a rerun
         -- is a no-op rather than relying solely on the claim to suppress it.
         AND  NOT EXISTS (
                SELECT 1 FROM sms_trigger_executions e
                JOIN   sms_trigger_rules r ON r.id = e.rule_id
                WHERE  e.event_id = m.id AND r.name = 'member_welcome'
              )
       ORDER BY gm.created_at`,
      [groupId],
    ),
  );

  if (rows.length === 0) {
    console.log('Nothing to do — every active member with a phone already has a welcome execution.');
    return;
  }

  console.log(`${rows.length} member(s) in ${rows[0].group_name} without a welcome:\n`);
  for (const r of rows) {
    console.log(`  ${r.membership_no.padEnd(10)} ${`${r.first_name} ${r.last_name}`.padEnd(20)} ${r.phone}  (joined ${r.joined_at.toISOString().slice(0, 10)})`);
  }

  if (!apply) {
    console.log('\nDry run only — rerun with --apply to send.');
    return;
  }

  console.log('\nSending…\n');
  let sent = 0;
  let skipped = 0;

  for (const r of rows) {
    // Mirrors members.service.ts's emitMemberRegisteredEvent payload exactly.
    // group_name is supplied explicitly because the engine's toTemplateVars
    // copies the payload and injects nothing of its own.
    const summary = await emitBusinessEvent({
      eventType: SMS_EVENTS.MEMBER_REGISTERED,
      eventId:   r.id,
      groupId,
      payload: {
        memberId:      r.id,
        first_name:    r.first_name,
        last_name:     r.last_name,
        group_name:    r.group_name,
        membership_no: r.membership_no,
      },
    });

    if (summary.dispatched > 0) {
      sent++;
      console.log(`  sent    ${r.membership_no} ${r.first_name} ${r.last_name}`);
    } else {
      skipped++;
      console.log(`  skipped ${r.membership_no} ${r.first_name} ${r.last_name} — ${JSON.stringify(summary)}`);
    }
  }

  console.log(`\nDone: ${sent} dispatched, ${skipped} skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
