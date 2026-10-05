/**
 * Tells a group's own officers where a Changi$ha withdrawal stands.
 *
 * Platform admins are alerted through lib/notifications (emitWithdrawalEvent).
 * The chairperson, treasurer and secretary, who must sign it off, are reached
 * here through the same member-notification path every other group workflow
 * uses (notifyMember: in-app feed, then WhatsApp/SMS). Best-effort: a failed
 * notice never fails the workflow it describes.
 */
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyMember } from './notifications.service';
import { CAMPAIGN_OFFICER_ROLES, type CampaignOfficerRole } from './campaign-officers.service';

export type WithdrawalNotice =
  | { kind: 'approval_needed'; offices: CampaignOfficerRole[]; requestedByRole: CampaignOfficerRole }
  | { kind: 'with_platform' }
  | { kind: 'rejected'; reason: string; by: 'officer' | 'platform' }
  | { kind: 'released' }
  | { kind: 'completed'; receipt?: string }
  | { kind: 'failed'; reason?: string };

interface WithdrawalFacts {
  id: string;
  group_id: string;
  gross_amount: string;
  net_amount: string;
  campaign_title: string;
}

const money = (v: string | number) => `KES ${Number(v).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const ref = (id: string) => `WD-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

function compose(n: WithdrawalNotice, w: WithdrawalFacts): { title: string; body: string } {
  const what = `${money(w.gross_amount)} withdrawal (${ref(w.id)}) from "${w.campaign_title}"`;
  switch (n.kind) {
    case 'approval_needed':
      return {
        title: 'Withdrawal needs your approval',
        body: `Kitabu Yetu: the ${n.requestedByRole} requested a ${what}. Your approval is needed. Sign in to review it.`,
      };
    case 'with_platform':
      return {
        title: 'Withdrawal sent to Kitabu Yetu',
        body: `Kitabu Yetu: the chairperson, treasurer and secretary have approved the ${what}. It now awaits Kitabu Yetu review.`,
      };
    case 'rejected':
      return {
        title: 'Withdrawal declined',
        body: `Kitabu Yetu: the ${what} was declined${n.by === 'platform' ? ' by Kitabu Yetu' : ''}. Reason: ${n.reason}. The funds are back in your group's available cash.`,
      };
    case 'released':
      return {
        title: 'Withdrawal approved',
        body: `Kitabu Yetu: the ${what} was approved and is being sent (${money(w.net_amount)} to the payee).`,
      };
    case 'completed':
      return {
        title: 'Withdrawal sent',
        body: `Kitabu Yetu: the ${what} was sent${n.receipt ? ` (M-Pesa ${n.receipt})` : ''}.`,
      };
    case 'failed':
      return {
        title: 'Withdrawal failed',
        body: `Kitabu Yetu: the ${what} did not go through${n.reason ? `: ${n.reason}` : ''}. The funds are back in your group's available cash.`,
      };
  }
}

/** Offices a notice goes to: those named for approval_needed, otherwise all three. */
function targetOffices(n: WithdrawalNotice): readonly CampaignOfficerRole[] {
  return n.kind === 'approval_needed' ? n.offices : CAMPAIGN_OFFICER_ROLES;
}

export async function notifyWithdrawalOfficers(withdrawalId: string, notice: WithdrawalNotice): Promise<void> {
  try {
    const offices = targetOffices(notice);
    if (offices.length === 0) return;

    const { facts, officers } = await withAdminDb(async (db) => {
      const { rows } = await db.query<WithdrawalFacts>(
        `SELECT w.id, w.group_id, w.gross_amount, w.net_amount, c.title AS campaign_title
         FROM   campaign_withdrawals w JOIN campaigns c ON c.id = w.campaign_id
         WHERE  w.id = $1`,
        [withdrawalId],
      );
      if (!rows[0]) return { facts: null, officers: [] as { member_id: string; phone: string | null }[] };
      const { rows: people } = await db.query<{ member_id: string; phone: string | null }>(
        `SELECT gm.member_id, m.phone
         FROM   group_members gm JOIN members m ON m.id = gm.member_id
         WHERE  gm.group_id = $1 AND gm.status = 'active' AND gm.role::text = ANY($2::text[])`,
        [rows[0].group_id, offices as unknown as string[]],
      );
      return { facts: rows[0], officers: people };
    });
    if (!facts) return;

    const { title, body } = compose(notice, facts);
    for (const officer of officers) {
      if (!officer.phone) continue;
      await notifyMember({
        groupId: facts.group_id,
        memberId: officer.member_id,
        phone: officer.phone,
        body,
        title,
        referenceType: 'campaign_withdrawal',
        referenceId: facts.id,
        notificationType: `campaign_withdrawal.${notice.kind}`,
        billingMode: 'unbilled',
      });
    }
  } catch (err) {
    logger.error('[campaign-withdrawals] officer notice failed', { withdrawalId, kind: notice.kind, err });
  }
}
