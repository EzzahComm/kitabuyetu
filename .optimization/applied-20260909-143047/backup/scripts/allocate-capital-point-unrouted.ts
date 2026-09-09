/**
 * One-off: allocate two unrouted M-Pesa payments to their real members in
 * CAPITAL POINT CHAMA.
 *
 * Both landed in mpesa_unrouted with reason='unknown_prefix' because the C2B
 * router only recognises a full group+member reference, and candidate_group_id
 * was NULL for both (already fixed by hand, see the memory note on this) — the
 * in-app treasurer Unrouted screen can never reach a NULL-candidate row, which
 * is exactly why these two sat unresolved since 2026-07.
 *
 *   UG11G9WNIU  KES 430  bill_ref '300004'    -> Cyril Murunga (member code
 *               KY000000300004 — '300004' is literally the tail of it)
 *   UF5QT6SMNR  KES 100  bill_ref 'KY0000003' -> Anthony Situma (C2B payload
 *               FirstName='ANTHONY'; the ref itself is only the group code,
 *               which is why routing could get the group but not the member)
 *
 *   npx tsx --env-file=.env.local scripts/allocate-capital-point-unrouted.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/allocate-capital-point-unrouted.ts --apply  # write
 *
 * Calls the real resolveUnrouted('allocate', ...) service — same contribution
 * insert + journal posting + spine allocation a treasurer clicking "Allocate"
 * in the UI would trigger — rather than reimplementing the accounting here.
 * Idempotent: resolveUnrouted no-ops if the row is already resolved, and the
 * contribution insert itself is ON CONFLICT (mpesa_receipt_number) DO NOTHING.
 */
import { resolveUnrouted } from '../lib/services/mpesa-unrouted.service';
import { withAdminDb } from '../lib/db';

const GROUP_ID = 'bcf03d15-9d45-4c69-ad45-5458a726817c'; // CAPITAL POINT CHAMA

const ALLOCATIONS = [
  {
    receipt: 'UG11G9WNIU',
    unroutedId: '2ee3860a-2bfb-4c34-9434-a4682e50e8cb',
    memberId: 'd3fad01b-d192-4aef-95d5-19592665acd8', // Cyril Murunga
    label: 'Cyril Murunga (KES 430, ref 300004 = his member code tail)',
    notes: 'Allocated: bill_ref 300004 is the tail of member code KY000000300004 (Cyril Murunga).',
  },
  {
    receipt: 'UF5QT6SMNR',
    unroutedId: '6c4b19d1-0405-4025-9cb2-f6b2e0e46a54',
    memberId: 'dcaa5e62-3040-42d1-98b7-7f89d848a452', // Anthony Situma
    label: 'Anthony Situma (KES 100, ref KY0000003 = group code only)',
    notes: 'Allocated: C2B payload FirstName=ANTHONY matched Anthony Situma; ref was group-code only.',
  },
] as const;

async function main() {
  const apply = process.argv.includes('--apply');

  const { rows: before } = await withAdminDb((db) =>
    db.query<{ receipt: string; resolved: boolean }>(
      `SELECT receipt, resolved FROM mpesa_unrouted WHERE id = ANY($1)`,
      [ALLOCATIONS.map((a) => a.unroutedId)],
    ),
  );
  console.log('Current state:', before);

  for (const a of ALLOCATIONS) {
    console.log(`\n${apply ? 'ALLOCATING' : '[DRY RUN] would allocate'}: ${a.label}`);
    if (!apply) continue;

    await resolveUnrouted(
      // Joseph Bienda — the group's actual (and only) registered officer
      // (chairperson). resolveUnrouted runs under a real tenant context via
      // withTransaction, which sets RLS session vars from ctx.role — an
      // ops script impersonating a non-officer member risks the insert being
      // rejected by RLS, and would misattribute the action either way. This
      // is an ops correction performed on the group's behalf, not literally
      // Joseph clicking a button; that's recorded plainly in resolution_notes.
      { userId: 'a21e96f0-7fc6-4cb0-b28c-9e7093f5328e', groupId: GROUP_ID, role: 'chairperson' },
      a.unroutedId,
      'allocate',
      { memberId: a.memberId, notes: `${a.notes} (ops correction, run on the group's behalf 2026-08-26)` },
    );
    console.log(`  done: ${a.receipt}`);
  }

  if (!apply) {
    console.log('\nDry run only — rerun with --apply to write.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
