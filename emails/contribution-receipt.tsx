import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { EmailLayout } from './components/layout';
import { Amount, InfoRow, Divider, Panel, AllocationRow, StatusChip, KES } from './components/ui';
import { BRAND } from '@/lib/brand';

export interface ContributionReceiptProps {
  memberName: string;
  groupName: string;
  amount: number;
  mpesaRef: string;
  accountRef: string;
  date: string;
  status?: 'completed' | 'pending';
  /** Optional auto-split breakdown across ledger accounts. */
  allocations?: { label: string; amount: number }[];
}

export default function ContributionReceipt({
  memberName, groupName, amount, mpesaRef, accountRef, date,
  status = 'completed', allocations,
}: ContributionReceiptProps) {
  const total = allocations?.reduce((s, a) => s + a.amount, 0) || amount;
  return (
    <EmailLayout preview={`Receipt: ${KES(amount)} contribution to ${groupName}`}>
      <Heading as="h1" style={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.text, margin: '4px 0 2px', textAlign: 'center' }}>
        Contribution received
      </Heading>
      <Text style={{ textAlign: 'center', margin: 0, fontSize: 14, color: BRAND.colors.textMuted }}>
        Asante, {memberName} 🙌
      </Text>

      <Amount value={amount} label="Amount received" />
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <StatusChip label={status === 'completed' ? 'Completed' : 'Pending'} tone={status === 'completed' ? 'positive' : 'pending'} />
      </div>

      <Divider />

      <InfoRow label="Member" value={memberName} />
      <InfoRow label="Group" value={groupName} />
      <InfoRow label="M-Pesa receipt" value={mpesaRef} mono />
      <InfoRow label="Account ref" value={accountRef} mono />
      <InfoRow label="Date" value={date} />

      {allocations && allocations.length > 0 && (
        <Panel title="Auto-split to ledger">
          {allocations.map((a) => (
            <AllocationRow key={a.label} label={a.label} amount={a.amount} pct={(a.amount / total) * 100} />
          ))}
        </Panel>
      )}

      <Text style={{ textAlign: 'center', margin: '16px 0 0', fontSize: 12, color: BRAND.colors.textMuted }}>
        Journal posted · this receipt is your proof of payment.
      </Text>
    </EmailLayout>
  );
}

ContributionReceipt.PreviewProps = {
  memberName: 'Wanjiku Njeri',
  groupName: 'Umoja Savings Group',
  amount: 3000,
  mpesaRef: 'SKE3X9QW12',
  accountRef: 'KYT-CONTR-KY0000019',
  date: '29 May 2026, 09:14',
  status: 'completed',
  allocations: [
    { label: 'Savings', amount: 2000 },
    { label: 'Welfare fund', amount: 500 },
    { label: 'Loan repayment', amount: 500 },
  ],
} satisfies ContributionReceiptProps;
