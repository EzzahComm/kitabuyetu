import { sendTemplatedEmail, queueEmail } from './email.service';
import { withAdminDb } from '@/lib/db';
import type { EmailResult } from '@/lib/email/provider';

export async function sendWelcomeEmail(opts: {
  email: string;
  name: string;
  groupName: string;
  groupId: string;
  memberId: string;
  tempPassword: string;
  loginUrl: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'welcome',
    to: opts.email,
    vars: {
      name: opts.name,
      groupName: opts.groupName,
      tempPassword: opts.tempPassword,
      loginUrl: opts.loginUrl,
    },
    groupId: opts.groupId,
    userId: opts.memberId,
    referenceType: 'member',
  });
}

export async function sendOtpEmail(opts: {
  email: string;
  otp: string;
  expiresIn: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'otp',
    to: opts.email,
    vars: { otp: opts.otp, expiresIn: opts.expiresIn },
  });
}

export async function sendPasswordResetEmail(opts: {
  email: string;
  resetUrl: string;
  expiresIn: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'password_reset',
    to: opts.email,
    vars: { resetUrl: opts.resetUrl, expiresIn: opts.expiresIn },
  });
}

export async function sendAccountUpdateEmail(opts: {
  email: string;
  name: string;
  changeDescription: string;
  changedAt: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'account_update',
    to: opts.email,
    vars: {
      name: opts.name,
      changeDescription: opts.changeDescription,
      changedAt: opts.changedAt,
    },
  });
}

// Send birthday emails to all members with birthday today
export async function sendBirthdayEmails(): Promise<void> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT m.id, m.first_name || ' ' || m.last_name AS full_name, m.email,
              g.name AS group_name, gm.group_id
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id
       JOIN groups g ON g.id = gm.group_id
       WHERE m.email IS NOT NULL
         AND m.date_of_birth IS NOT NULL
         AND EXTRACT(MONTH FROM m.date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND EXTRACT(DAY   FROM m.date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)`,
      [],
    ),
  );

  for (const row of rows) {
    await queueEmail({
      templateKey: 'birthday',
      to: row.email,
      vars: { memberName: row.full_name, groupName: row.group_name },
      groupId: row.group_id,
      userId: row.id,
      priority: 'low',
      referenceType: 'member',
    }).catch(() => {});
  }
}

// Send monthly statements to all members in a group
export async function sendMonthlyStatements(groupId: string, month: string): Promise<void> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `-- LATERAL per child table, not a flat multi-table LEFT JOIN: a member
       -- with e.g. 3 contributions this month and 2 loans would otherwise
       -- have their contributions SUM doubled (fanned out across the 2 loan
       -- rows) and their loan balance SUM tripled (fanned out across the 3
       -- contribution rows) — same bug class proven live elsewhere in the
       -- admin/organization portals.
       SELECT m.id, m.first_name || ' ' || m.last_name AS full_name, m.email,
              COALESCE(con.total_contributions, 0) AS total_contributions,
              COALESCE(ln.loan_balance, 0) AS loan_balance,
              g.name AS group_name
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
       JOIN groups g ON g.id = gm.group_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(c.amount) FILTER (
                  WHERE c.status = 'completed'
                    AND DATE_TRUNC('month', c.created_at) = DATE_TRUNC('month', NOW())
                ), 0) AS total_contributions
         FROM contributions c WHERE c.member_id = m.id AND c.group_id = $1
       ) con ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(l.outstanding_balance), 0) AS loan_balance
         FROM loans l WHERE l.member_id = m.id AND l.group_id = $1 AND l.status IN ('active','disbursed')
       ) ln ON true
       WHERE m.email IS NOT NULL`,
      [groupId],
    ),
  );

  for (const row of rows) {
    await queueEmail({
      templateKey: 'monthly_statement',
      to: row.email,
      vars: {
        memberName: row.full_name,
        groupName: row.group_name,
        month,
        totalContributions: Number(row.total_contributions).toLocaleString('en-KE', { minimumFractionDigits: 2 }),
        loanBalance: Number(row.loan_balance).toLocaleString('en-KE', { minimumFractionDigits: 2 }),
        fundShare: '0.00',
      },
      groupId,
      userId: row.id,
      priority: 'low',
      referenceType: 'member',
    }).catch(() => {});
  }
}
