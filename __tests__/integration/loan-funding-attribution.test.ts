/**
 * Loan funding attribution — capital layer Phase 3 (migration 118). THE KEYSTONE.
 *
 * This is what distinguishes
 *   "the group lent its own savings to a member"
 * from
 *   "the group on-lent an organization's capital to a member"
 * which are otherwise the same row in `loans`.
 *
 * Modelled on the real EZZAHCOMM → THE FIONA'S operation: capital arrives as a
 * mobile-money funding allocation, and the group on-lends it to individual members.
 */
import { loansService } from '@/lib/services/loans.service';
import { getLoanFundingSplits } from '@/lib/services/funding-sources.service';
import { createTestGroup, addGroupOfficer } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';

describe('loan funding attribution', () => {
  let groupId: string, officerId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
  });

  afterAll(async () => {
    await resetDatabase();
  });

  function groupCtx() {
    return { userId: officerId, groupId, role: 'chairperson' } as never;
  }

  it('does not post loan funding attribution from a manual disbursement or typed receipt', async () => {
    const borrowerId = await addGroupOfficer(groupId, officerId, 'member');
    const loan = await loansService.apply(groupCtx(), {
      memberId: borrowerId,
      principalAmount: 50_000,
      interestRate: 10,
      loanTermMonths: 6,
    } as never);
    await loansService.approve(groupCtx(), loan.id, {} as never);

    await expect(
      loansService.disburse(groupCtx(), loan.id, {
        disbursementDate: new Date().toISOString().slice(0, 10),
        paymentMethod: 'mpesa',
        mpesaReceiptNumber: 'FAKE-MANUAL-RECEIPT',
      } as never),
    ).rejects.toThrow(/Manual loan disbursement is disabled/i);

    const splits = await getLoanFundingSplits(groupCtx(), loan.id);
    expect(splits).toHaveLength(0);
  });
});
