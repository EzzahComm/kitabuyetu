import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { EmailLayout } from './components/layout';
import { Amount, InfoRow, Divider, CtaButton, StatusChip, KES } from './components/ui';
import { BRAND } from '@/lib/brand';

export type LoanAlertKind = 'disbursed' | 'due' | 'overdue';

export interface LoanAlertProps {
  memberName: string;
  groupName: string;
  kind: LoanAlertKind;
  /** The headline amount: disbursed amount, or the instalment due. */
  amount: number;
  /** Outstanding balance after/for this event. */
  balance: number;
  dueDate?: string;
  payUrl?: string;
}

const COPY: Record<LoanAlertKind, { title: string; lead: (n: string) => string; chip: string; tone: 'positive' | 'pending' | 'negative'; amountLabel: string }> = {
  disbursed: {
    title: 'Your loan has been disbursed',
    lead: (n) => `Hi ${n}, your loan has been sent to your M-Pesa.`,
    chip: 'Disbursed', tone: 'positive', amountLabel: 'Amount disbursed',
  },
  due: {
    title: 'Loan repayment due soon',
    lead: (n) => `Hi ${n}, a friendly reminder that your next instalment is coming up.`,
    chip: 'Due soon', tone: 'pending', amountLabel: 'Instalment due',
  },
  overdue: {
    title: 'Loan repayment overdue',
    lead: (n) => `Hi ${n}, your instalment is past due. Please pay as soon as you can to avoid penalties.`,
    chip: 'Overdue', tone: 'negative', amountLabel: 'Amount overdue',
  },
};

export default function LoanAlert({ memberName, groupName, kind, amount, balance, dueDate, payUrl }: LoanAlertProps) {
  const copy = COPY[kind];
  return (
    <EmailLayout preview={`${copy.title} — ${KES(amount)}`}>
      <Heading as="h1" style={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.text, margin: '4px 0 2px', textAlign: 'center' }}>
        {copy.title}
      </Heading>
      <Text style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 14, color: BRAND.colors.textMuted }}>
        {copy.lead(memberName)}
      </Text>

      <Amount value={amount} label={copy.amountLabel} />
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <StatusChip label={copy.chip} tone={copy.tone} />
      </div>

      <Divider />

      <InfoRow label="Group" value={groupName} />
      <InfoRow label="Outstanding balance" value={KES(balance)} />
      {dueDate && <InfoRow label={kind === 'overdue' ? 'Was due' : 'Due date'} value={dueDate} />}

      {kind !== 'disbursed' && payUrl && <CtaButton href={payUrl}>Pay now via M-Pesa</CtaButton>}

      <Text style={{ textAlign: 'center', margin: '16px 0 0', fontSize: 12, color: BRAND.colors.textMuted }}>
        {kind === 'disbursed'
          ? 'Repayments keep your credit score healthy and your group strong.'
          : 'Already paid? You can safely ignore this message.'}
      </Text>
    </EmailLayout>
  );
}

LoanAlert.PreviewProps = {
  memberName: 'David Otieno',
  groupName: 'Umoja Savings Group',
  kind: 'due',
  amount: 3200,
  balance: 18000,
  dueDate: '5 Jun 2026',
  payUrl: 'https://kitabuyetu.co.ke/me',
} satisfies LoanAlertProps;
