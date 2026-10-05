/**
 * Changi$ha: a campaign belongs to a group with an active chairperson, treasurer
 * and secretary, and a withdrawal needs all three offices plus Kitabu Yetu
 * (migrations 211, 212) — checked against real Postgres.
 *
 * The service enforces the same rules; these tests prove the database does too,
 * so a code path that forgets them still cannot move money.
 */
import { withAdminDb } from '@/lib/db';
import {
  assertCampaignOfficersComplete,
  CampaignOfficersIncompleteError,
  getCampaignOfficerStatus,
} from '@/lib/services/campaign-officers.service';
import { addGroupOfficer, createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

type Role = 'chairperson' | 'treasurer' | 'secretary';

async function newWithdrawal(groupId: string, memberId: string, requestedByRole: Role | null) {
  const [campaign] = await rawQuery<{ id: string }>(
    `INSERT INTO campaigns (group_id, title, slug, account_code, story, target_amount, status, created_by, reviewed_by, reviewed_at)
     VALUES ($1, 'Water', 'water-' || substr(gen_random_uuid()::text, 1, 8),
             'CH' || upper(substr(md5(random()::text), 1, 6)), 'Story', 50000, 'active', $2, $2, now())
     RETURNING id`,
    [groupId, memberId],
  );
  const [withdrawal] = await rawQuery<{ id: string }>(
    `INSERT INTO campaign_withdrawals
       (campaign_id, group_id, payout_method, payout_phone, gross_amount, platform_fee_pct,
        platform_fee_amount, mpesa_charge_amount, net_amount, status, requested_by, requested_by_role)
     VALUES ($1, $2, 'phone', '254712345678', 1000, 4, 40, 33, 927, 'pending_approval', $3, $4)
     RETURNING id`,
    [campaign.id, groupId, memberId, requestedByRole],
  );
  return withdrawal.id;
}

async function approve(groupId: string, withdrawalId: string, approverId: string, role: Role | null, kind = 'officer') {
  await rawQuery(
    `INSERT INTO settlement_approvals (subject_type, subject_id, group_id, approver_id, approver_kind, decision, approver_role)
     VALUES ('campaign_withdrawal', $1, $2, $3, $4, 'approved', $5)`,
    [withdrawalId, groupId, approverId, kind, role],
  );
}

const setStatus = (id: string, status: string) =>
  rawQuery(`UPDATE campaign_withdrawals SET status = $2 WHERE id = $1`, [id, status]);

describe('campaign officers and withdrawal sign-offs', () => {
  let groupId: string, treasurerId: string, chairpersonId: string, secretaryId: string;

  beforeAll(async () => {
    await resetDatabase();
    const g = await createTestGroup('treasurer');
    groupId = g.groupId;
    treasurerId = g.officerId;
    chairpersonId = await addGroupOfficer(groupId, treasurerId, 'chairperson');
    secretaryId = await addGroupOfficer(groupId, treasurerId, 'secretary');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  describe('officer status', () => {
    it('is complete with a chairperson, treasurer and secretary', async () => {
      const status = await withAdminDb((db) => getCampaignOfficerStatus(db, groupId));
      expect(status.complete).toBe(true);
      expect(status.missing).toEqual([]);
    });

    it('reports a group that only has its founder as missing the other two offices', async () => {
      const lone = await createTestGroup('treasurer');
      const status = await withAdminDb((db) => getCampaignOfficerStatus(db, lone.groupId));
      expect(status.complete).toBe(false);
      expect(status.missing).toEqual(['chairperson', 'secretary']);
      await expect(withAdminDb((db) => assertCampaignOfficersComplete(db, lone.groupId))).rejects.toBeInstanceOf(
        CampaignOfficersIncompleteError,
      );
    });

    it('stops counting an office once its holder is no longer active', async () => {
      await rawQuery(`UPDATE group_members SET status = 'inactive' WHERE group_id = $1 AND member_id = $2`, [
        groupId,
        secretaryId,
      ]);
      try {
        const status = await withAdminDb((db) => getCampaignOfficerStatus(db, groupId));
        expect(status.missing).toEqual(['secretary']);
      } finally {
        await rawQuery(`UPDATE group_members SET status = 'active' WHERE group_id = $1 AND member_id = $2`, [
          groupId,
          secretaryId,
        ]);
      }
    });
  });

  describe('register_campaign() is gone', () => {
    it('no longer exists, so no one can create a throwaway group for a campaign', async () => {
      const rows = await rawQuery(`SELECT 1 FROM pg_proc WHERE proname = 'register_campaign'`);
      expect(rows).toEqual([]);
    });
  });

  describe('database guard on withdrawal stages', () => {
    it('refuses awaiting_platform while an office has not signed off', async () => {
      const id = await newWithdrawal(groupId, treasurerId, 'treasurer');
      await approve(groupId, id, chairpersonId, 'chairperson'); // secretary still missing
      await expect(setStatus(id, 'awaiting_platform')).rejects.toThrow(/chairperson, treasurer and secretary/);
    });

    it('does not count two people from the same office as two offices', async () => {
      const id = await newWithdrawal(groupId, treasurerId, 'treasurer');
      await approve(groupId, id, chairpersonId, 'chairperson');
      // A second chairperson-office approval is blocked by the one-per-office index.
      await expect(approve(groupId, id, secretaryId, 'chairperson')).rejects.toThrow(/one_approval_per_office/);
    });

    it("counts the requester's own office plus the other two", async () => {
      const id = await newWithdrawal(groupId, treasurerId, 'treasurer');
      await approve(groupId, id, chairpersonId, 'chairperson');
      await approve(groupId, id, secretaryId, 'secretary');
      await setStatus(id, 'awaiting_platform');
      const [row] = await rawQuery<{ status: string }>(`SELECT status FROM campaign_withdrawals WHERE id = $1`, [id]);
      expect(row.status).toBe('awaiting_platform');
    });

    it('refuses to jump from pending_approval straight to approved or processing', async () => {
      const id = await newWithdrawal(groupId, treasurerId, 'treasurer');
      await approve(groupId, id, chairpersonId, 'chairperson');
      await approve(groupId, id, secretaryId, 'secretary');
      await expect(setStatus(id, 'approved')).rejects.toThrow(/Kitabu Yetu sign-off/);
      await expect(setStatus(id, 'processing')).rejects.toThrow(/Kitabu Yetu sign-off/);
    });

    it('refuses to release an awaiting_platform row without a backoffice approval, then allows it with one', async () => {
      const id = await newWithdrawal(groupId, treasurerId, 'treasurer');
      await approve(groupId, id, chairpersonId, 'chairperson');
      await approve(groupId, id, secretaryId, 'secretary');
      await setStatus(id, 'awaiting_platform');
      await expect(setStatus(id, 'approved')).rejects.toThrow(/Kitabu Yetu sign-off/);

      await approve(groupId, id, treasurerId, null, 'backoffice');
      await setStatus(id, 'approved');
      const [row] = await rawQuery<{ status: string }>(`SELECT status FROM campaign_withdrawals WHERE id = $1`, [id]);
      expect(row.status).toBe('approved');
    });

    it('lets a rejection through without any sign-offs (the money is returned, not released)', async () => {
      const id = await newWithdrawal(groupId, treasurerId, 'treasurer');
      await setStatus(id, 'rejected');
      const [row] = await rawQuery<{ status: string }>(`SELECT status FROM campaign_withdrawals WHERE id = $1`, [id]);
      expect(row.status).toBe('rejected');
    });
  });
});
