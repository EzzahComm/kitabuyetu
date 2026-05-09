import { sendFinancialReport } from './email.service';
import { sendTemplatedEmail } from './email.service';
import { withAdminDb } from '@/lib/db';
import type { EmailResult } from '@/lib/email/provider';
import type { EmailPayload } from '@/lib/email/provider';

const ALLOWED_REPORT_ROLES = ['treasurer', 'group_admin', 'super_admin', 'ngo_coordinator'];

export async function emailPnlReport(opts: {
  groupId: string;
  requesterId: string;
  requesterRole: string;
  requesterEmail: string;
  period: string;
  htmlReport: string;
  attachments?: EmailPayload['attachments'];
}): Promise<EmailResult> {
  return sendFinancialReport({
    to: opts.requesterEmail,
    subject: `Profit & Loss Report — ${opts.period}`,
    html: opts.htmlReport,
    groupId: opts.groupId,
    userId: opts.requesterId,
    requesterRole: opts.requesterRole,
    attachments: opts.attachments,
  });
}

export async function emailBalanceSheet(opts: {
  groupId: string;
  requesterId: string;
  requesterRole: string;
  requesterEmail: string;
  period: string;
  htmlReport: string;
  attachments?: EmailPayload['attachments'];
}): Promise<EmailResult> {
  return sendFinancialReport({
    to: opts.requesterEmail,
    subject: `Balance Sheet — ${opts.period}`,
    html: opts.htmlReport,
    groupId: opts.groupId,
    userId: opts.requesterId,
    requesterRole: opts.requesterRole,
    attachments: opts.attachments,
  });
}

// Send a financial report to ALL authorized officers in a group
export async function broadcastFinancialReport(opts: {
  groupId: string;
  reportType: string;
  period: string;
  generatedAt: string;
  attachments?: EmailPayload['attachments'];
}): Promise<void> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT m.email, m.full_name, gm.role
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
       WHERE m.email IS NOT NULL
         AND gm.role = ANY($2::text[])`,
      [opts.groupId, ALLOWED_REPORT_ROLES],
    ),
  );

  for (const officer of rows) {
    await sendTemplatedEmail({
      templateKey: 'financial_report',
      to: officer.email,
      vars: {
        recipientName: officer.full_name,
        reportType: opts.reportType,
        period: opts.period,
        generatedAt: opts.generatedAt,
      },
      groupId: opts.groupId,
      attachments: opts.attachments,
      referenceType: 'report',
    }).catch(() => {});
  }
}

// Weekly summary broadcast to group admins
export async function sendWeeklySummaries(): Promise<void> {
  const { rows: groups } = await withAdminDb((db) =>
    db.query(`SELECT id, name FROM groups WHERE is_active = true`, []),
  );

  const weekLabel = new Date().toLocaleDateString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  for (const group of groups) {
    const [contribRow, loanRow, repayRow, memberRow] = await Promise.all([
      withAdminDb((db) =>
        db.query(
          `SELECT COALESCE(SUM(amount),0) AS total FROM contributions
           WHERE group_id=$1 AND status='completed'
             AND created_at >= NOW() - INTERVAL '7 days'`,
          [group.id],
        ),
      ),
      withAdminDb((db) =>
        db.query(
          `SELECT COALESCE(SUM(principal_amount),0) AS total FROM loans
           WHERE group_id=$1 AND status='disbursed'
             AND disbursed_at >= NOW() - INTERVAL '7 days'`,
          [group.id],
        ),
      ),
      withAdminDb((db) =>
        db.query(
          `SELECT COALESCE(SUM(amount),0) AS total FROM loan_repayments
           WHERE group_id=$1 AND status='completed'
             AND created_at >= NOW() - INTERVAL '7 days'`,
          [group.id],
        ),
      ),
      withAdminDb((db) =>
        db.query(
          `SELECT COUNT(*) AS total FROM group_members
           WHERE group_id=$1 AND joined_at >= NOW() - INTERVAL '7 days'`,
          [group.id],
        ),
      ),
    ]);

    const vars = {
      weekLabel,
      weekContributions: Number(contribRow.rows[0]?.total ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 }),
      weekLoans: Number(loanRow.rows[0]?.total ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 }),
      weekRepayments: Number(repayRow.rows[0]?.total ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 }),
      newMembers: String(memberRow.rows[0]?.total ?? 0),
    };

    const { rows: officers } = await withAdminDb((db) =>
      db.query(
        `SELECT m.email, m.full_name FROM members m
         JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
         WHERE m.email IS NOT NULL AND gm.role IN ('group_admin','treasurer')`,
        [group.id],
      ),
    );

    for (const officer of officers) {
      await sendTemplatedEmail({
        templateKey: 'weekly_summary',
        to: officer.email,
        vars: { ...vars, recipientName: officer.full_name, groupName: group.name },
        groupId: group.id,
        referenceType: 'report',
      }).catch(() => {});
    }
  }
}
