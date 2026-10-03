/**
 * applyGroupSignupExtras (lib/services/group-signup-extras.ts), against real
 * Postgres: the optional data written right after register_group() commits — the
 * contribution plan, and the government-registration flag with its number and
 * certificate.
 *
 * What must hold: a blank plan writes nothing; amounts are ignored for a product
 * with no ledger; registration is only recorded when the box was ticked; and a
 * certificate that cannot be stored never undoes the rest (the group is still
 * marked registered, with no certificate recorded). The groups CHECK constraint
 * `chk_registration_fields_consistent` is exercised for real here too.
 */
import { applyGroupSignupExtras } from '@/lib/services/group-signup-extras';
import { contributionPlanService } from '@/lib/services/contribution-plan.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

const mockUploadGroupDocument = jest.fn();

// Storage needs real Supabase credentials; everything else in the module is real
// (including registrationCertificatePath, so the stored path is the real one).
jest.mock('@/lib/supabase/group-document-storage', () => {
  const actual = jest.requireActual('@/lib/supabase/group-document-storage');
  return { ...actual, uploadGroupDocument: (...args: unknown[]) => mockUploadGroupDocument(...args) };
});

const pdf = { buffer: Buffer.from('%PDF-1.7\n'), contentType: 'application/pdf' as const };

async function registrationOf(groupId: string) {
  const [row] = await rawQuery<{
    is_government_registered: boolean;
    registration_number: string | null;
    registration_certificate_url: string | null;
  }>(`SELECT is_government_registered, registration_number, registration_certificate_url FROM groups WHERE id = $1`, [
    groupId,
  ]);
  return row;
}

async function planRowsOf(groupId: string) {
  return rawQuery<{ value: { monthlyContribution: number; welfareAmount: number } }>(
    `SELECT value FROM policies WHERE group_id = $1 AND domain = 'contribution_plan' AND policy_key = 'amounts' AND is_active`,
    [groupId],
  );
}

describe('applyGroupSignupExtras', () => {
  beforeEach(() => {
    mockUploadGroupDocument.mockReset();
    mockUploadGroupDocument.mockResolvedValue(undefined);
  });

  it('stores the contribution plan for a Kitabu Yetu group, readable back through the service', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');

    const result = await applyGroupSignupExtras(
      {
        product: 'kitabu_yetu',
        groupId,
        memberId: officerId,
        role: 'treasurer',
        monthlyContribution: 500,
        welfareAmount: 200,
      },
      'test',
    );

    expect(result).toEqual({ certificateStored: false });
    expect((await planRowsOf(groupId)).map((r) => r.value)).toEqual([{ monthlyContribution: 500, welfareAmount: 200 }]);
    expect(await contributionPlanService.getGroupPlan({ userId: officerId, groupId, role: 'treasurer' })).toEqual({
      plan: { monthlyContribution: 500, welfareAmount: 200 },
      source: 'group',
    });
  });

  it('writes no plan row when both amounts are blank or zero', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');

    await applyGroupSignupExtras(
      { product: 'kitabu_yetu', groupId, memberId: officerId, role: 'treasurer', monthlyContribution: 0 },
      'test',
    );

    expect(await planRowsOf(groupId)).toHaveLength(0);
  });

  it('ignores amounts for a product with no ledger', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer', { product: 'chama_reminder' });

    await applyGroupSignupExtras(
      {
        product: 'chama_reminder',
        groupId,
        memberId: officerId,
        role: 'treasurer',
        monthlyContribution: 500,
        welfareAmount: 200,
      },
      'test',
    );

    expect(await planRowsOf(groupId)).toHaveLength(0);
  });

  it('marks the group registered with its number, trimmed, and no certificate', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');

    const result = await applyGroupSignupExtras(
      {
        product: 'kitabu_yetu',
        groupId,
        memberId: officerId,
        role: 'treasurer',
        isGovernmentRegistered: true,
        registrationNumber: '  CBO/12345/2026  ',
      },
      'test',
    );

    expect(result).toEqual({ certificateStored: false });
    expect(await registrationOf(groupId)).toEqual({
      is_government_registered: true,
      registration_number: 'CBO/12345/2026',
      registration_certificate_url: null,
    });
    expect(mockUploadGroupDocument).not.toHaveBeenCalled();
  });

  it('records nothing about registration when the box was not ticked, even if a number and certificate arrive', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');

    const result = await applyGroupSignupExtras(
      {
        product: 'kitabu_yetu',
        groupId,
        memberId: officerId,
        role: 'treasurer',
        isGovernmentRegistered: false,
        registrationNumber: 'CBO/1/2026',
        certificate: pdf,
      },
      'test',
    );

    expect(result).toEqual({ certificateStored: false });
    expect(await registrationOf(groupId)).toEqual({
      is_government_registered: false,
      registration_number: null,
      registration_certificate_url: null,
    });
    expect(mockUploadGroupDocument).not.toHaveBeenCalled();
  });

  it('stores the certificate at the group’s own path and records it', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');

    const result = await applyGroupSignupExtras(
      {
        product: 'kitabu_yetu',
        groupId,
        memberId: officerId,
        role: 'treasurer',
        isGovernmentRegistered: true,
        certificate: pdf,
      },
      'test',
    );

    expect(result).toEqual({ certificateStored: true });
    expect(mockUploadGroupDocument).toHaveBeenCalledWith(`${groupId}/certificate.pdf`, pdf.buffer, 'application/pdf');
    expect(await registrationOf(groupId)).toEqual({
      is_government_registered: true,
      registration_number: null,
      registration_certificate_url: `${groupId}/certificate.pdf`,
    });
  });

  it('a certificate that cannot be stored never undoes the rest: registered, number kept, no certificate recorded', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    mockUploadGroupDocument.mockRejectedValue(new Error('storage is down'));

    const result = await applyGroupSignupExtras(
      {
        product: 'kitabu_yetu',
        groupId,
        memberId: officerId,
        role: 'treasurer',
        monthlyContribution: 500,
        welfareAmount: 0,
        isGovernmentRegistered: true,
        registrationNumber: 'CBO/9/2026',
        certificate: pdf,
      },
      'test',
    );

    expect(result).toEqual({ certificateStored: false });
    expect(await registrationOf(groupId)).toEqual({
      is_government_registered: true,
      registration_number: 'CBO/9/2026',
      registration_certificate_url: null,
    });
    // The plan, written before the certificate, is unaffected too.
    expect((await planRowsOf(groupId)).map((r) => r.value)).toEqual([{ monthlyContribution: 500, welfareAmount: 0 }]);
  });
});
