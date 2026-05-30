import * as React from 'react';
import { Column, Heading, Row, Section, Text } from '@react-email/components';
import { EmailLayout } from './components/layout';
import { InfoRow, Divider, CtaButton, KES } from './components/ui';
import { BRAND } from '@/lib/brand';

const c = BRAND.colors;

export interface StatementTxn {
  date: string;
  label: string;
  amount: number;
  direction: 'in' | 'out';
}

export interface AccountStatementProps {
  memberName: string;
  groupName: string;
  period: string;
  savings: number;
  shares: number;
  loanBalance: number;
  contributedThisPeriod: number;
  transactions: StatementTxn[];
  statementUrl?: string;
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <Column style={{ width: '50%', padding: 4 }}>
      <Section style={{ backgroundColor: '#F6F8FB', borderRadius: 10, padding: '12px 14px' }}>
        <Text style={{ margin: 0, fontSize: 11, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
        <Text style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700, color: c.blue }}>{KES(value)}</Text>
      </Section>
    </Column>
  );
}

export default function AccountStatement({
  memberName, groupName, period, savings, shares, loanBalance,
  contributedThisPeriod, transactions, statementUrl,
}: AccountStatementProps) {
  return (
    <EmailLayout
      preview={`Your ${period} statement for ${groupName}`}
      footerNote="This is a periodic account statement. Manage email preferences in your member settings."
    >
      <Heading as="h1" style={{ fontSize: 20, fontWeight: 700, color: c.text, margin: '4px 0 2px' }}>
        Your statement
      </Heading>
      <Text style={{ margin: 0, fontSize: 14, color: c.textMuted }}>
        {memberName} · {groupName} · {period}
      </Text>

      <Section style={{ padding: '14px 0 4px' }}>
        <Row>
          <SummaryTile label="Savings" value={savings} />
          <SummaryTile label="Shares" value={shares} />
        </Row>
        <Row>
          <SummaryTile label="Loan balance" value={loanBalance} />
          <SummaryTile label="Contributed" value={contributedThisPeriod} />
        </Row>
      </Section>

      <Divider />

      <Text style={{ margin: '0 0 6px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted }}>
        Recent activity
      </Text>
      {transactions.slice(0, 8).map((t, i) => (
        <InfoRow
          key={i}
          label={`${t.date} · ${t.label}`}
          value={
            <span style={{ color: t.direction === 'in' ? c.green : c.text }}>
              {t.direction === 'in' ? '+' : '−'}{KES(t.amount)}
            </span>
          }
        />
      ))}

      {statementUrl && <CtaButton href={statementUrl}>View full statement</CtaButton>}
    </EmailLayout>
  );
}

AccountStatement.PreviewProps = {
  memberName: 'Amina Hassan',
  groupName: 'Umoja Women Group',
  period: 'May 2026',
  savings: 84500,
  shares: 32000,
  loanBalance: 18000,
  contributedThisPeriod: 5000,
  transactions: [
    { date: '29 May', label: 'Weekly contribution', amount: 1000, direction: 'in' },
    { date: '28 May', label: 'Loan repayment', amount: 3200, direction: 'in' },
    { date: '25 May', label: 'Annual dividend', amount: 4500, direction: 'in' },
    { date: '22 May', label: 'Late meeting fine', amount: 200, direction: 'out' },
  ],
  statementUrl: 'https://kitabuyetu.co.ke/me/passbook',
} satisfies AccountStatementProps;
