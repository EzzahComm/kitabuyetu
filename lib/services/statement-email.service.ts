/**
 * Per-member account statements — closes ACCOUNTING_ARCHITECTURE_AUDIT.md §12
 * ("A React-email template (emails/account-statement.tsx) defines a full
 * statement layout but is referenced nowhere outside its own file — designed,
 * never wired"). Renders that template with real savings/shares/loan/activity
 * data and sends it through the existing sendReactEmail pipeline, honoring
 * the same 'monthly_statement' email_preferences category the template's own
 * footer already promises ("Manage email preferences in your member settings").
 */
import { createElement } from 'react';
import { withAdminDb } from '@/lib/db';
import { sendReactEmail } from '@/lib/email/react/send';
import AccountStatement, { type StatementTxn } from '@/emails/account-statement';
import { formatDate } from '@/lib/utils';
import { computeMemberFinancialSnapshot } from './member-balances.service';

const STATEMENT_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke'}/me/passbook`;

interface MemberStatementRow {
  id: string;
  full_name: string;
  email: string;
  group_name: string;
}

/** Sends every active member of one group their statement for `period` (e.g. "May 2026"). */
export async function sendMemberStatements(
  groupId: string,
  period: string,
): Promise<{ sent: number; skipped: number }> {
  const { rows: members } = await withAdminDb((db) =>
    db.query<MemberStatementRow>(
      `SELECT m.id, m.first_name || ' ' || m.last_name AS full_name, m.email,
              g.name AS group_name
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
       JOIN groups g ON g.id = gm.group_id
       WHERE gm.status = 'active' AND m.email IS NOT NULL
         AND COALESCE(
           (SELECT ep.enabled FROM email_preferences ep
            WHERE ep.member_id = m.id AND ep.category = 'monthly_statement'
              AND (ep.group_id = $1 OR ep.group_id IS NULL)
            ORDER BY ep.group_id NULLS LAST
            LIMIT 1),
           true
         )`,
      [groupId],
    ),
  );

  if (members.length === 0) return { sent: 0, skipped: 0 };

  const snapshots = await withAdminDb((db) => computeMemberFinancialSnapshot(db, groupId));
  const snapshotByMember = new Map(snapshots.map((s) => [s.memberId, s]));

  const { rows: txns } = await withAdminDb((db) =>
    db.query<{ member_id: string; txn_date: string; label: string; amount: string; direction: 'in' | 'out' }>(
      `SELECT member_id, contribution_date::text AS txn_date, 'Contribution' AS label,
              amount::text AS amount, 'in' AS direction
       FROM contributions
       WHERE group_id = $1 AND status = 'completed'
         AND contribution_date >= CURRENT_DATE - INTERVAL '90 days'
       UNION ALL
       SELECT member_id, payment_date::text AS txn_date, 'Loan repayment' AS label,
              amount_paid::text AS amount, 'in' AS direction
       FROM loan_repayments
       WHERE group_id = $1 AND status = 'completed' AND payment_date IS NOT NULL
         AND payment_date >= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY txn_date DESC`,
      [groupId],
    ),
  );

  const txnsByMember = new Map<string, StatementTxn[]>();
  for (const t of txns) {
    const list = txnsByMember.get(t.member_id) ?? [];
    list.push({ date: formatDate(t.txn_date), label: t.label, amount: parseFloat(t.amount), direction: t.direction });
    txnsByMember.set(t.member_id, list);
  }

  let sent = 0;
  let skipped = 0;
  for (const m of members) {
    const snapshot = snapshotByMember.get(m.id) ??
      { memberId: m.id, savings: 0, loanBalance: 0, shares: 0, contributedThisPeriod: 0 };
    const result = await sendReactEmail({
      to: m.email,
      subject: `Your ${period} statement — ${m.group_name}`,
      element: createElement(AccountStatement, {
        memberName: m.full_name,
        groupName: m.group_name,
        period,
        savings: snapshot.savings,
        shares: snapshot.shares,
        loanBalance: snapshot.loanBalance,
        contributedThisPeriod: snapshot.contributedThisPeriod,
        transactions: txnsByMember.get(m.id) ?? [],
        statementUrl: STATEMENT_URL,
      }),
      groupId,
      userId: m.id,
      templateKey: 'account_statement',
      category: 'monthly_statement',
      referenceType: 'member',
    }).then(() => true).catch(() => false);

    if (result) sent++; else skipped++;
  }
  return { sent, skipped };
}

/** Fans out `sendMemberStatements` to every active group — the monthly cron entry point. */
export async function sendAllGroupMemberStatements(): Promise<{ groups: number; sent: number; skipped: number }> {
  const { rows: groups } = await withAdminDb((db) =>
    db.query<{ id: string }>(`SELECT id FROM groups WHERE is_active = true`, []),
  );

  const period = new Date().toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  let sent = 0;
  let skipped = 0;
  for (const group of groups) {
    const result = await sendMemberStatements(group.id, period).catch(() => ({ sent: 0, skipped: 0 }));
    sent += result.sent;
    skipped += result.skipped;
  }
  return { groups: groups.length, sent, skipped };
}
