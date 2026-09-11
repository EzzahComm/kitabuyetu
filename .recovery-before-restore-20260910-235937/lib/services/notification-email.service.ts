import { createElement } from 'react';
import { sendTemplatedEmail, queueEmail } from './email.service';
import { sendReactEmail } from '@/lib/email/react/send';
import ContributionReceipt from '@/emails/contribution-receipt';
import type { EmailResult } from '@/lib/email/provider';

const kesFromString = (v: string): number => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

// ─── Contribution Notifications ───────────────────────────────────────────────

// Renders the React Email contribution receipt (emails/contribution-receipt.tsx)
// and sends it through the existing pipeline via sendReactEmail. New fields are
// optional so existing callers keep working.
export async function sendContributionConfirmation(opts: {
  email: string;
  memberName: string;
  amount: string;
  periodLabel: string;
  reference: string;
  date: string;
  paymentMethod: string;
  totalContributions: string;
  groupId: string;
  memberId: string;
  contributionId: string;
  groupName?: string;
  accountRef?: string;
  status?: 'completed' | 'pending';
}): Promise<EmailResult> {
  const amount = kesFromString(opts.amount);
  const isCash = opts.paymentMethod?.toLowerCase().includes('cash');
  return sendReactEmail({
    to: opts.email,
    subject: `Receipt — ${new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(amount)} contribution received`,
    element: createElement(ContributionReceipt, {
      memberName: opts.memberName,
      amount,
      date: opts.date,
      groupName: opts.groupName,
      periodLabel: opts.periodLabel,
      paymentMethod: opts.paymentMethod,
      mpesaRef: isCash ? undefined : opts.reference || undefined,
      accountRef: opts.accountRef,
      totalContributions: opts.totalContributions || undefined,
      status: opts.status ?? 'completed',
    }),
    groupId: opts.groupId,
    userId: opts.memberId,
    templateKey: 'contribution_received',
    category: 'contribution',
    referenceId: opts.contributionId,
    referenceType: 'contribution',
  });
}

export async function sendContributionReminder(opts: {
  email: string;
  memberName: string;
  amount: string;
  periodLabel: string;
  dueDate: string;
  shortcode: string;
  accountNumber: string;
  groupId: string;
  memberId: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'contribution_reminder',
    to: opts.email,
    vars: {
      memberName: opts.memberName,
      amount: opts.amount,
      periodLabel: opts.periodLabel,
      dueDate: opts.dueDate,
      shortcode: opts.shortcode,
      accountNumber: opts.accountNumber,
    },
    groupId: opts.groupId,
    userId: opts.memberId,
    referenceType: 'contribution',
  });
}

// ─── Loan Notifications ───────────────────────────────────────────────────────

export async function sendLoanApprovedEmail(opts: {
  email: string;
  memberName: string;
  principal: string;
  interestRate: string;
  termMonths: string;
  monthlyRepayment: string;
  groupId: string;
  memberId: string;
  loanId: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'loan_approved',
    to: opts.email,
    vars: {
      memberName: opts.memberName,
      principal: opts.principal,
      interestRate: opts.interestRate,
      termMonths: opts.termMonths,
      monthlyRepayment: opts.monthlyRepayment,
    },
    groupId: opts.groupId,
    userId: opts.memberId,
    referenceId: opts.loanId,
    referenceType: 'loan',
  });
}

export async function sendLoanRejectedEmail(opts: {
  email: string;
  memberName: string;
  principal: string;
  reason: string;
  reapplyDate: string;
  groupId: string;
  memberId: string;
  loanId: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'loan_rejected',
    to: opts.email,
    vars: {
      memberName: opts.memberName,
      principal: opts.principal,
      reason: opts.reason,
      reapplyDate: opts.reapplyDate,
    },
    groupId: opts.groupId,
    userId: opts.memberId,
    referenceId: opts.loanId,
    referenceType: 'loan',
  });
}

export async function sendLoanDisbursedEmail(opts: {
  email: string;
  memberName: string;
  amount: string;
  phone: string;
  mpesaRef: string;
  monthlyRepayment: string;
  firstDueDate: string;
  groupId: string;
  memberId: string;
  loanId: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'loan_disbursed',
    to: opts.email,
    vars: {
      memberName: opts.memberName,
      amount: opts.amount,
      phone: opts.phone,
      mpesaRef: opts.mpesaRef,
      monthlyRepayment: opts.monthlyRepayment,
      firstDueDate: opts.firstDueDate,
    },
    groupId: opts.groupId,
    userId: opts.memberId,
    referenceId: opts.loanId,
    referenceType: 'loan',
  });
}

export async function sendLoanRepaymentReceivedEmail(opts: {
  email: string;
  memberName: string;
  amount: string;
  paymentDate: string;
  remainingBalance: string;
  nextDueDate: string;
  groupId: string;
  memberId: string;
  loanId: string;
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'loan_repayment_received',
    to: opts.email,
    vars: {
      memberName: opts.memberName,
      amount: opts.amount,
      paymentDate: opts.paymentDate,
      remainingBalance: opts.remainingBalance,
      nextDueDate: opts.nextDueDate,
    },
    groupId: opts.groupId,
    userId: opts.memberId,
    referenceId: opts.loanId,
    referenceType: 'loan',
  });
}

// ─── Meeting Notifications ────────────────────────────────────────────────────

export async function sendMeetingInvites(opts: {
  memberEmails: { email: string; name: string; memberId: string }[];
  meetingType: string;
  meetingDate: string;
  meetingTime: string;
  venue: string;
  agenda: string;
  organizerName: string;
  groupId: string;
  groupName: string;
}): Promise<void> {
  for (const m of opts.memberEmails) {
    await queueEmail({
      templateKey: 'meeting_invite',
      to: m.email,
      vars: {
        memberName: m.name,
        groupName: opts.groupName,
        meetingType: opts.meetingType,
        meetingDate: opts.meetingDate,
        meetingTime: opts.meetingTime,
        venue: opts.venue,
        agenda: opts.agenda,
        organizerName: opts.organizerName,
      },
      groupId: opts.groupId,
      userId: m.memberId,
      priority: 'normal',
      referenceType: 'meeting',
    }).catch(() => {});
  }
}

export async function sendMeetingReminders(opts: {
  memberEmails: { email: string; name: string; memberId: string }[];
  meetingType: string;
  meetingDate: string;
  meetingTime: string;
  venue: string;
  groupId: string;
  groupName: string;
}): Promise<void> {
  for (const m of opts.memberEmails) {
    await queueEmail({
      templateKey: 'meeting_reminder',
      to: m.email,
      vars: {
        memberName: m.name,
        groupName: opts.groupName,
        meetingType: opts.meetingType,
        meetingDate: opts.meetingDate,
        meetingTime: opts.meetingTime,
        venue: opts.venue,
      },
      groupId: opts.groupId,
      userId: m.memberId,
      priority: 'normal',
      referenceType: 'meeting',
    }).catch(() => {});
  }
}
