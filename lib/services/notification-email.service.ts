import { sendTemplatedEmail, queueEmail } from './email.service';
import type { EmailResult } from '@/lib/email/provider';

// ─── Contribution Notifications ───────────────────────────────────────────────

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
}): Promise<EmailResult> {
  return sendTemplatedEmail({
    templateKey: 'contribution_received',
    to: opts.email,
    vars: {
      memberName: opts.memberName,
      amount: opts.amount,
      periodLabel: opts.periodLabel,
      reference: opts.reference,
      date: opts.date,
      paymentMethod: opts.paymentMethod,
      totalContributions: opts.totalContributions,
    },
    groupId: opts.groupId,
    userId: opts.memberId,
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
