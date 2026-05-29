/**
 * Representative data for the Member self-service portal.
 *
 * ⚠️ No member-self API exists yet — this is the seam for the real hooks:
 *   • wallet/passbook → a `useMyWallet()` / `useMyPassbook()` TanStack hook
 *     reading the member's own ledger (RLS-scoped to their membership)
 *   • goals           → `useMySavingsGoals()`
 *   • announcements   → group feed
 * Keep these shapes stable so swapping mock → live is localised.
 */

export interface MemberProfile {
  firstName: string;
  lastName: string;
  groupName: string;
  memberNo: string;
}

export const member: MemberProfile = {
  firstName: 'Amina',
  lastName: 'Hassan',
  groupName: 'Umoja Women Group',
  memberNo: 'UWG-042',
};

export const wallet = {
  /** Member's total savings balance (KES). */
  savings: 84500,
  /** Share capital value. */
  shares: 32000,
  /** Welfare/contributions this cycle. */
  thisMonth: 5000,
  /** Outstanding loan balance. */
  loanBalance: 18000,
};

export const loan = {
  balance: 18000,
  principal: 30000,
  nextAmount: 3200,
  nextDueLabel: 'Due 5 Jun',
  /** % repaid. */
  progress: 40,
};

export interface SavingsGoal {
  id: string;
  name: string;
  emoji: string;
  target: number;
  saved: number;
  deadline: string;
}

export const goals: SavingsGoal[] = [
  { id: 'g1', name: 'School fees', emoji: '🎓', target: 60000, saved: 42000, deadline: 'Dec 2026' },
  { id: 'g2', name: 'Business stock', emoji: '🛒', target: 100000, saved: 35000, deadline: 'Mar 2027' },
  { id: 'g3', name: 'Emergency fund', emoji: '🛟', target: 30000, saved: 28500, deadline: 'Ongoing' },
];

export type TxnType =
  | 'contribution' | 'loan_repayment' | 'loan_disbursement'
  | 'withdrawal' | 'fine' | 'dividend' | 'share_purchase';

export type TxnStatus = 'success' | 'pending' | 'failed';

export interface PassbookEntry {
  id: string;
  type: TxnType;
  label: string;
  amount: number;
  direction: 'in' | 'out';
  status: TxnStatus;
  method: 'mpesa' | 'cash' | 'auto';
  /** ISO date string. */
  date: string;
  ref?: string;
}

export const passbook: PassbookEntry[] = [
  { id: 't1',  type: 'contribution',      label: 'Weekly contribution',  amount: 1000,  direction: 'in',  status: 'success', method: 'mpesa', date: '2026-05-29T09:12:00', ref: 'QFT3X9AB12' },
  { id: 't2',  type: 'loan_repayment',    label: 'Loan repayment',       amount: 3200,  direction: 'in',  status: 'success', method: 'mpesa', date: '2026-05-28T16:40:00', ref: 'QFT2P8LK90' },
  { id: 't3',  type: 'dividend',          label: 'Annual dividend',      amount: 4500,  direction: 'in',  status: 'success', method: 'auto',  date: '2026-05-25T10:00:00' },
  { id: 't4',  type: 'fine',              label: 'Late meeting fine',    amount: 200,   direction: 'out', status: 'success', method: 'mpesa', date: '2026-05-22T18:05:00', ref: 'QFT0M5JH77' },
  { id: 't5',  type: 'contribution',      label: 'Weekly contribution',  amount: 1000,  direction: 'in',  status: 'success', method: 'mpesa', date: '2026-05-22T08:55:00', ref: 'QFS9K2DD41' },
  { id: 't6',  type: 'share_purchase',    label: 'Share purchase (×4)',  amount: 2000,  direction: 'in',  status: 'success', method: 'mpesa', date: '2026-05-18T14:20:00', ref: 'QFR8L1CC03' },
  { id: 't7',  type: 'contribution',      label: 'Weekly contribution',  amount: 1000,  direction: 'in',  status: 'pending', method: 'mpesa', date: '2026-05-15T09:30:00', ref: 'QFP7H4BB22' },
  { id: 't8',  type: 'loan_disbursement', label: 'Loan disbursed',       amount: 30000, direction: 'out', status: 'success', method: 'mpesa', date: '2026-04-30T11:00:00', ref: 'QFN5G3AA10' },
  { id: 't9',  type: 'contribution',      label: 'Weekly contribution',  amount: 1000,  direction: 'in',  status: 'failed',  method: 'mpesa', date: '2026-04-24T09:10:00' },
  { id: 't10', type: 'withdrawal',        label: 'Welfare payout',       amount: 8000,  direction: 'out', status: 'success', method: 'mpesa', date: '2026-04-20T13:45:00', ref: 'QFL2D9ZZ88' },
];

export interface Announcement {
  id: string;
  title: string;
  body: string;
  author: string;
  date: string;
}

export const announcements: Announcement[] = [
  { id: 'a1', title: 'Next meeting moved to Saturday', body: 'Our June meeting is now on Sat 7 June, 3pm at the community hall. Please carry your passbook.', author: 'Chairperson', date: '2026-05-28T12:00:00' },
  { id: 'a2', title: 'Dividends paid 🎉', body: 'Annual dividends have been credited to your savings. Thank you for a great year!', author: 'Treasurer', date: '2026-05-25T10:05:00' },
];

export const notificationsCount = 3;

/** Labels + visual hints per passbook entry type. */
export const TXN_META: Record<TxnType, { label: string; emoji: string }> = {
  contribution:      { label: 'Contribution',  emoji: '💰' },
  loan_repayment:    { label: 'Loan repayment', emoji: '✅' },
  loan_disbursement: { label: 'Loan',          emoji: '🏦' },
  withdrawal:        { label: 'Withdrawal',    emoji: '↗️' },
  fine:              { label: 'Fine',          emoji: '⚠️' },
  dividend:          { label: 'Dividend',      emoji: '🎉' },
  share_purchase:    { label: 'Shares',        emoji: '📈' },
};
