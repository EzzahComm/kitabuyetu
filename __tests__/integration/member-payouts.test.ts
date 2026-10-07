/**
 * Group → member disbursements (migration 218) against a real Postgres.
 *
 *   Chairperson / Secretary initiate → Treasurer approves → Kitabu Yetu signs
 *   off → the system executes and posts the group ledger + member ledger.
 *
 * Covers authorization (server-side, incl. cross-group and bypass attempts),
 * validation, the full workflow with ledger reconciliation (cash and M-Pesa),
 * rollback on a ledger failure, idempotency, double/concurrent approval, and
 * that notifications fire only after commit.
 *
 * Hermetic: Daraja's HTTP call is the only thing mocked (the real
 * mpesa-b2c.service bookkeeping still runs), and the SMS trigger engine is
 * mocked so notifications are asserted rather than sent.
 */
jest.mock('@/lib/services/daraja.service', () => ({
  ...jest.requireActual('@/lib/services/daraja.service'),
  initiateB2C: jest.fn(),
}));
jest.mock('@/lib/sms/trigger-engine', () => ({
  emitBusinessEvent: jest.fn().mockResolvedValue({ evaluated: 0, matched: 0, dispatched: 0, deferred: 0, skipped: 0 }),
}));

import { createTestGroup, addGroupOfficer, fundGroupCashAccount } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';
import { authHeaders, backofficeHeaders, buildRequest } from './helpers/request';
import { POST as initiateRoute } from '@/app/api/v1/member-payouts/route';
import { GET as detailRoute, POST as actionRoute } from '@/app/api/v1/member-payouts/[id]/route';
import { POST as platformApproveRoute } from '@/app/api/admin/member-payouts/[id]/approve/route';
import { POST as platformRejectRoute } from '@/app/api/admin/member-payouts/[id]/reject/route';
import { POST as spineActionRoute } from '@/app/api/v1/mpesa/disbursements/[id]/route';
import { handleB2CResult } from '@/lib/services/mpesa-b2c.service';
import { getReconciliation } from '@/lib/services/member-payouts.service';
import { computeMemberFinancialSnapshot } from '@/lib/services/member-balances.service';
import { listMyPassbook } from '@/lib/services/member-passbook.service';
import { initiateB2C as darajaB2C } from '@/lib/services/daraja.service';
import { emitBusinessEvent } from '@/lib/sms/trigger-engine';
import { withAdminDb } from '@/lib/db';

const PLATFORM_ADMIN = '00000000-0000-4000-8000-000000000001';
const PERMS = ['member_payouts.manage'];

interface Officers {
  groupId: string;
  chairId: string;
  treasurerId: string;
  secretaryId: string;
  memberId: string;
}
interface Actor {
  id: string;
  role: string;
  permissions?: string[];
}
interface ApiBody {
  data?: { id: string; reference: string; status: string };
  error?: string;
}

async function makeGroup(): Promise<Officers> {
  const { groupId, officerId: chairId } = await createTestGroup('chairperson');
  const treasurerId = await addGroupOfficer(groupId, chairId, 'treasurer');
  const secretaryId = await addGroupOfficer(groupId, chairId, 'secretary');
  const memberId = await addGroupOfficer(groupId, chairId, 'member');
  return { groupId, chairId, treasurerId, secretaryId, memberId };
}

const as = (userId: string, groupId: string, role: string, permissions: string[] = PERMS) =>
  authHeaders({ userId, groupId, role, permissions });

async function initiate(g: Officers, by: Actor, body: Record<string, unknown>, key = crypto.randomUUID()) {
  const res = await initiateRoute(
    buildRequest('/api/v1/member-payouts', {
      method: 'POST',
      headers: { ...as(by.id, g.groupId, by.role, by.permissions), 'Idempotency-Key': key },
      body: {
        memberId: g.memberId,
        amount: 10_000,
        purpose: 'other',
        description: 'Member emergency support',
        paymentMethod: 'cash',
        ...body,
      },
    }),
  );
  return { status: res.status, json: (await res.json()) as ApiBody };
}

async function act(g: Officers, by: Actor, id: string, body: Record<string, unknown>) {
  const res = await actionRoute(
    buildRequest(`/api/v1/member-payouts/${id}`, { method: 'POST', headers: as(by.id, g.groupId, by.role), body }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: (await res.json()) as ApiBody };
}

async function platform(id: string, decision: 'approve' | 'reject', reason?: string) {
  const route = decision === 'approve' ? platformApproveRoute : platformRejectRoute;
  const res = await route(
    buildRequest(`/api/admin/member-payouts/${id}/${decision}`, {
      method: 'POST',
      headers: backofficeHeaders({ userId: PLATFORM_ADMIN, platformRole: 'super_admin' }),
      ...(reason ? { body: { reason } } : {}),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: (await res.json()) as ApiBody };
}

const cash = async (groupId: string) => {
  const [a] = await rawQuery<{ balance: string; reserved_amount: string }>(
    `SELECT balance, reserved_amount FROM accounts WHERE group_id = $1 AND account_code = '1001'`,
    [groupId],
  );
  return { balance: parseFloat(a.balance), reserved: parseFloat(a.reserved_amount) };
};
const row = async (id: string) =>
  (
    await rawQuery<{ status: string; journal_entry_id: string | null; reference: string }>(
      `SELECT status::text, journal_entry_id, reference FROM disbursement_requests WHERE id = $1`,
      [id],
    )
  )[0];
const emitted = (type: string) =>
  (emitBusinessEvent as jest.Mock).mock.calls.filter(([e]) => e.eventType === type).map(([e]) => e.eventId as string);

describe('member disbursements', () => {
  let g: Officers;
  let other: Officers;
  let chair: Actor;
  let treasurer: Actor;
  let secretary: Actor;
  const reconFor = () => getReconciliation({ userId: g.chairId, groupId: g.groupId, role: 'chairperson' });

  beforeAll(async () => {
    await resetDatabase();
    g = await makeGroup();
    other = await makeGroup();
    chair = { id: g.chairId, role: 'chairperson' };
    treasurer = { id: g.treasurerId, role: 'treasurer' };
    secretary = { id: g.secretaryId, role: 'secretary' };
    await fundGroupCashAccount(g.groupId, 100_000);
    await fundGroupCashAccount(other.groupId, 100_000);

    const [gm] = await rawQuery<{ id: string }>(`SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2`, [
      g.groupId,
      g.memberId,
    ]);
    await rawQuery(
      `INSERT INTO contributions (group_id, member_id, group_membership_id, amount, status, contribution_date)
       VALUES ($1, $2, $3, 50000, 'completed', CURRENT_DATE)`,
      [g.groupId, g.memberId, gm.id],
    );
  });

  afterAll(async () => {
    await resetDatabase();
  });

  beforeEach(() => (emitBusinessEvent as jest.Mock).mockClear());

  // ─── Authorization ──────────────────────────────────────────────────────

  describe('authorization', () => {
    it('chairperson and secretary can initiate; it parks awaiting the treasurer', async () => {
      const a = await initiate(g, chair, { amount: 1_000 });
      const b = await initiate(g, secretary, { amount: 1_000 });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.json.data?.status).toBe('pending_approval');
      expect(a.json.data?.reference).toMatch(/^KY-DIS-\d{6}$/);
      expect(emitted('member_payout.requested')).toEqual([a.json.data?.id, b.json.data?.id]);
      await act(g, chair, a.json.data!.id, { action: 'cancel' });
      await act(g, secretary, b.json.data!.id, { action: 'cancel' });
    });

    it('a treasurer cannot initiate, and an ordinary member is refused outright', async () => {
      expect((await initiate(g, treasurer, {})).status).toBe(403);
      expect((await initiate(g, { id: g.memberId, role: 'member', permissions: [] }, {})).status).toBe(403);
    });

    it('only the treasurer approves — not the initiator, the secretary, the generic route or Kitabu Yetu first', async () => {
      const { json } = await initiate(g, chair, { amount: 1_000 });
      const id = json.data!.id;
      expect((await act(g, chair, id, { action: 'approve' })).status).toBe(403);
      expect((await act(g, secretary, id, { action: 'approve' })).status).toBe(403);
      const bypass = await spineActionRoute(
        buildRequest(`/api/v1/mpesa/disbursements/${id}`, {
          method: 'POST',
          headers: as(g.chairId, g.groupId, 'chairperson', ['payouts.manage']),
          body: { action: 'approve' },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(bypass.status).toBe(403);
      expect((await platform(id, 'approve')).status).toBe(422);
      expect((await row(id)).status).toBe('pending_approval');
      await act(g, chair, id, { action: 'cancel' });
    });

    it('the database refuses a status change that skips the approvals', async () => {
      const { json } = await initiate(g, chair, { amount: 1_000 });
      const id = json.data!.id;
      await expect(
        rawQuery(`UPDATE disbursement_requests SET status = 'completed' WHERE id = $1`, [id]),
      ).rejects.toThrow(/treasurer/);
      await act(g, chair, id, { action: 'cancel' });
    });

    it('is scoped to the caller’s group', async () => {
      expect((await initiate(g, chair, { memberId: other.memberId })).status).toBe(404);

      const otherChair = { id: other.chairId, role: 'chairperson' };
      const { json } = await initiate(other, otherChair, { amount: 1_000 });
      const id = json.data!.id;
      expect((await act(g, treasurer, id, { action: 'approve' })).status).toBe(404);
      const detail = await detailRoute(
        buildRequest(`/api/v1/member-payouts/${id}`, { headers: as(g.treasurerId, g.groupId, 'treasurer') }),
        { params: Promise.resolve({ id }) },
      );
      expect(detail.status).toBe(404);
      await act(other, otherChair, id, { action: 'cancel' });
    });
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  describe('validation', () => {
    it.each([[0], [-500], [10.5], ['1000']])('rejects amount %p', async (amount) => {
      expect((await initiate(g, chair, { amount })).status).toBe(422);
    });

    it('requires a purpose', async () => {
      expect((await initiate(g, chair, { description: '' })).status).toBe(422);
    });

    it('rejects more than the group has available', async () => {
      const res = await initiate(g, chair, { amount: 150_000 });
      expect(res.status).toBe(422);
      expect(res.json.error).toMatch(/Insufficient available balance/);
    });

    it('rejects a savings withdrawal above the member’s savings', async () => {
      const res = await initiate(g, chair, { amount: 60_000, purpose: 'savings_withdrawal' });
      expect(res.status).toBe(422);
      expect(res.json.error).toMatch(/withdrawable savings/);
    });

    it('rejects an inactive member', async () => {
      await rawQuery(`UPDATE group_members SET status = 'suspended' WHERE group_id = $1 AND member_id = $2`, [
        g.groupId,
        g.memberId,
      ]);
      try {
        expect((await initiate(g, chair, {})).status).toBe(404);
      } finally {
        await rawQuery(`UPDATE group_members SET status = 'active' WHERE group_id = $1 AND member_id = $2`, [
          g.groupId,
          g.memberId,
        ]);
      }
    });

    it('leaves nothing reserved after the failed attempts', async () => {
      expect(await cash(g.groupId)).toEqual({ balance: 100_000, reserved: 0 });
    });
  });

  // ─── Workflow + reconciliation ──────────────────────────────────────────

  describe('workflow and ledger reconciliation', () => {
    it('100,000 − 10,000 cash disbursement reconciles the group and member ledgers', async () => {
      const { json } = await initiate(g, chair, { amount: 10_000 });
      const id = json.data!.id;
      expect(await cash(g.groupId)).toEqual({ balance: 100_000, reserved: 10_000 });

      expect((await act(g, treasurer, id, { action: 'approve' })).json.data?.status).toBe('awaiting_platform');
      const done = await platform(id, 'approve');
      expect(done.status).toBe(200);
      expect(done.json.data?.status).toBe('completed');

      // Group ledger: one member-attributed journal, DR 4001 / CR 1001, same reference.
      const r = await row(id);
      expect(r.journal_entry_id).not.toBeNull();
      const [je] = await rawQuery<{ reference: string; member_id: string }>(
        `SELECT reference, member_id FROM journal_entries WHERE id = $1`,
        [r.journal_entry_id],
      );
      expect(je).toEqual({ reference: r.reference, member_id: g.memberId });
      const lines = await rawQuery<{ code: string; debit: string; credit: string }>(
        `SELECT a.account_code AS code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
         WHERE jl.journal_entry_id = $1 ORDER BY a.account_code`,
        [r.journal_entry_id],
      );
      expect(lines.map((l) => [l.code, parseFloat(l.debit), parseFloat(l.credit)])).toEqual([
        ['1001', 0, 10_000],
        ['4001', 10_000, 0],
      ]);
      expect(await cash(g.groupId)).toEqual({ balance: 90_000, reserved: 0 });

      // Member ledger: on the passbook under the same reference.
      const passbook = await listMyPassbook({ userId: g.memberId, groupId: g.groupId, role: 'member' }, {
        page: 1,
        limit: 20,
      } as Parameters<typeof listMyPassbook>[1]);
      expect(passbook.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'member_payout',
            amount: 10_000,
            status: 'success',
            ref: r.reference,
            label: 'Member emergency support',
          }),
        ]),
      );

      const audit = await rawQuery<{ action: string }>(`SELECT action FROM audit_logs WHERE resource_id = $1`, [id]);
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'disbursement.initiate',
          'member_payout.treasurer_approve',
          'member_payout.journal_posted',
          'member_payout.platform_approve',
        ]),
      );
      expect(emitted('member_payout.completed')).toEqual([id]);
      expect((await reconFor()).reconciled).toBe(true);
    });

    it('a second (savings) disbursement keeps both ledgers reconciled', async () => {
      const { json } = await initiate(g, secretary, { amount: 20_000, purpose: 'savings_withdrawal' });
      const id = json.data!.id;
      await act(g, treasurer, id, { action: 'approve' });
      expect((await platform(id, 'approve')).json.data?.status).toBe('completed');

      expect(await cash(g.groupId)).toEqual({ balance: 70_000, reserved: 0 });
      const [snap] = await withAdminDb((db) => computeMemberFinancialSnapshot(db, g.groupId, g.memberId));
      expect(snap.savings).toBe(30_000);
      const recon = await reconFor();
      expect(recon.reconciled).toBe(true);
      expect(recon.completed).toEqual({ count: 2, total: 30_000 });
      expect(recon.postedToLedger).toEqual({ count: 2, total: 30_000 });
    });

    it('a ledger failure at execution rolls everything back', async () => {
      const { json } = await initiate(g, chair, { amount: 5_000 });
      const id = json.data!.id;
      await act(g, treasurer, id, { action: 'approve' });

      await rawQuery(`UPDATE accounts SET is_active = false WHERE group_id = $1 AND account_code = '4001'`, [
        g.groupId,
      ]);
      try {
        const failed = await platform(id, 'approve');
        expect(failed.status).toBe(422);
        expect(await row(id)).toEqual(expect.objectContaining({ status: 'awaiting_platform', journal_entry_id: null }));
        expect(await cash(g.groupId)).toEqual({ balance: 70_000, reserved: 5_000 });
        const signoffs = await rawQuery(
          `SELECT 1 FROM settlement_approvals WHERE subject_id = $1 AND approver_kind = 'backoffice'`,
          [id],
        );
        expect(signoffs).toHaveLength(0);
        expect(emitted('member_payout.completed')).toEqual([]);
      } finally {
        await rawQuery(`UPDATE accounts SET is_active = true WHERE group_id = $1 AND account_code = '4001'`, [
          g.groupId,
        ]);
      }
      expect((await platform(id, 'approve')).json.data?.status).toBe('completed');
      expect(await cash(g.groupId)).toEqual({ balance: 65_000, reserved: 0 });
    });
  });

  // ─── Duplicates and concurrency ─────────────────────────────────────────

  describe('duplicates and concurrency', () => {
    it('a retried submission (same Idempotency-Key) returns the same disbursement, reserved once', async () => {
      const key = crypto.randomUUID();
      const first = await initiate(g, chair, { amount: 2_000 }, key);
      const retry = await initiate(g, chair, { amount: 2_000 }, key);
      expect(retry.json.data?.id).toBe(first.json.data?.id);
      expect((await cash(g.groupId)).reserved).toBe(2_000);
      expect(emitted('member_payout.requested')).toEqual([first.json.data?.id, first.json.data?.id]);
      await act(g, chair, first.json.data!.id, { action: 'cancel' });
    });

    it('double and concurrent approvals execute exactly once', async () => {
      const { json } = await initiate(g, chair, { amount: 3_000 });
      const id = json.data!.id;
      expect((await act(g, treasurer, id, { action: 'approve' })).status).toBe(200);
      expect((await act(g, treasurer, id, { action: 'approve' })).status).toBe(422);

      const results = await Promise.all([platform(id, 'approve'), platform(id, 'approve')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
      const journals = await rawQuery(`SELECT 1 FROM journal_entries WHERE reference = $1`, [
        (await row(id)).reference,
      ]);
      expect(journals).toHaveLength(1);
      expect(await cash(g.groupId)).toEqual({ balance: 62_000, reserved: 0 });
    });

    it('concurrent requests cannot together exceed the available balance', async () => {
      // 62,000 available: two 40,000 requests race — exactly one wins.
      const results = await Promise.all([
        initiate(g, chair, { amount: 40_000 }),
        initiate(g, secretary, { amount: 40_000 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
      expect((await cash(g.groupId)).reserved).toBe(40_000);
      const winnerIdx = results.findIndex((r) => r.status === 200);
      await act(g, winnerIdx === 0 ? chair : secretary, results[winnerIdx].json.data!.id, { action: 'cancel' });
    });
  });

  // ─── Rejection and cancellation ─────────────────────────────────────────

  describe('rejection and cancellation', () => {
    it('treasurer rejection needs a reason, releases the funds, keeps the record and tells the initiator', async () => {
      const { json } = await initiate(g, chair, { amount: 4_000 });
      const id = json.data!.id;
      expect((await act(g, treasurer, id, { action: 'reject' })).status).toBe(422);
      expect((await act(g, treasurer, id, { action: 'reject', reason: 'Not minuted' })).json.data?.status).toBe(
        'rejected',
      );
      expect((await cash(g.groupId)).reserved).toBe(0);
      expect(emitted('member_payout.rejected')).toEqual([id]);
      expect((await row(id)).status).toBe('rejected');
    });

    it('only the initiator can cancel', async () => {
      const { json } = await initiate(g, chair, { amount: 4_000 });
      const id = json.data!.id;
      expect((await act(g, secretary, id, { action: 'cancel' })).status).toBe(403);
      expect((await act(g, chair, id, { action: 'cancel' })).json.data?.status).toBe('cancelled');
      expect((await cash(g.groupId)).reserved).toBe(0);
    });

    it('Kitabu Yetu can decline after the treasurer approved', async () => {
      const { json } = await initiate(g, chair, { amount: 4_000 });
      const id = json.data!.id;
      await act(g, treasurer, id, { action: 'approve' });
      expect((await platform(id, 'reject', 'Supporting minutes missing')).json.data?.status).toBe('rejected');
      expect((await cash(g.groupId)).reserved).toBe(0);
      expect(emitted('member_payout.rejected')).toEqual([id]);
    });
  });

  // ─── M-Pesa ─────────────────────────────────────────────────────────────

  describe('M-Pesa disbursement', () => {
    it('dispatches on sign-off and posts both ledgers when Safaricom confirms — once', async () => {
      (darajaB2C as jest.Mock).mockResolvedValueOnce({
        conversationId: 'conv-member-1',
        originatorConversationId: 'oc-member-1',
        responseDescription: 'Accept the service request successfully.',
      });
      const { json } = await initiate(g, chair, { amount: 5_000, paymentMethod: 'mpesa' });
      const id = json.data!.id;
      await act(g, treasurer, id, { action: 'approve' });
      expect((await platform(id, 'approve')).status).toBe(200);
      expect((await row(id)).status).toBe('dispatched');
      expect(emitted('member_payout.completed')).toEqual([]);

      const success = {
        Result: {
          ResultType: 0,
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          OriginatorConversationID: 'oc-member-1',
          ConversationID: 'conv-member-1',
          TransactionID: 'RCPTMEMBER1',
          ResultParameters: { ResultParameter: [{ Key: 'TransactionReceipt', Value: 'RCPTMEMBER1' }] },
        },
      };
      await handleB2CResult(success, '127.0.0.1');
      await handleB2CResult(success, '127.0.0.1'); // Safaricom replay

      const r = await row(id);
      expect(r.status).toBe('completed');
      const journals = await rawQuery(`SELECT 1 FROM journal_entries WHERE reference = $1`, [r.reference]);
      expect(journals).toHaveLength(1);
      expect((await cash(g.groupId)).reserved).toBe(0);
      // Emitted once per callback that posted; the replay posts nothing.
      expect(emitted('member_payout.completed')).toEqual([id]);
      expect((await reconFor()).reconciled).toBe(true);
    });
  });
});
