/**
 * Shared presentational constants for the (member) portal. Real data comes
 * from hooks/use-member.ts (backed by lib/services/member-*.service.ts) —
 * this file no longer holds any mock data, only the type re-exports and
 * label/emoji lookup table that components/member/*.tsx were already built
 * against.
 */
export type { PassbookEntry, TxnType, TxnStatus } from '@/lib/services/member-passbook.service';
export type { MemberGoal } from '@/lib/services/member-goals.service';

import type { TxnType } from '@/lib/services/member-passbook.service';

/** Labels + visual hints per passbook entry type. */
export const TXN_META: Record<TxnType, { label: string; emoji: string }> = {
  contribution:      { label: 'Contribution',  emoji: '💰' },
  loan_repayment:    { label: 'Loan repayment', emoji: '✅' },
  loan_disbursement: { label: 'Loan',          emoji: '🏦' },
};
