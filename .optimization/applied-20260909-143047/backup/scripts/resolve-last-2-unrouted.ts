/**
 * Resolve the last 2 genuinely open rows in mpesa_unrouted (KES 101 total).
 *
 * UF6QZ6QA8I (KES 100, bill_ref='KY0000003') — same pattern as Anthony's
 * UF5QT6SMNR from earlier this session: bill_ref is exactly CAPITAL POINT
 * CHAMA's group_code (KY0000003) with no member suffix, but the C2B
 * payload's FirstName is 'POLYCAP', and Polycap Akoth is an active member
 * there (CP000080). Allocated to him as a real capital-point contribution.
 *
 * UETQZ5SNUZ (KES 1, bill_ref='CONTRIB') — the generic STK-only contribution
 * reference, carrying no group signal at all (unlike KY0000003 above), from
 * the payer already confirmed this session to have sent one other clearly-
 * test payment (the KES 15,000 'it was a test' row). A KES 1 probe against a
 * reference that can't identify which of Polycap's 3 memberships it's for
 * matches that same test-payment pattern far more than a real contribution
 * would. Dismissed as a test/probe payment, not guessed into one of his 3
 * groups — flagged clearly in the resolution notes so it's easy to correct
 * if that judgment call is wrong.
 *
 *   npx tsx --env-file=.env.local scripts/resolve-last-2-unrouted.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/resolve-last-2-unrouted.ts --apply  # write
 */
import { resolveUnroutedPayment } from '../lib/services/admin.service';
import { withAdminDb } from '../lib/db';

const CAPITAL_POINT_GROUP_ID = 'bcf03d15-9d45-4c69-ad45-5458a726817c';
const POLYCAP_MEMBER_ID = '8b7114df-0585-4500-a0e2-8e52ab97e617';

async function main() {
  const apply = process.argv.includes('--apply');

  const { rows: unrouted } = await withAdminDb((db) =>
    db.query<{ id: string; receipt: string; resolved: boolean }>(
      `SELECT id, receipt, resolved FROM mpesa_unrouted WHERE receipt = ANY($1)`,
      [['UF6QZ6QA8I', 'UETQZ5SNUZ']],
    ),
  );

  const allocate = unrouted.find((u) => u.receipt === 'UF6QZ6QA8I');
  const dismiss = unrouted.find((u) => u.receipt === 'UETQZ5SNUZ');

  if (allocate && !allocate.resolved) {
    console.log(`${apply ? 'ALLOCATING' : '[DRY RUN] would allocate'}: UF6QZ6QA8I (KES 100) -> Polycap Akoth, CAPITAL POINT CHAMA`);
    if (apply) {
      await resolveUnroutedPayment(allocate.id, 'allocate', {
        adminId: 'script:resolve-last-2-unrouted',
        groupId: CAPITAL_POINT_GROUP_ID,
        memberId: POLYCAP_MEMBER_ID,
        notes: `bill_ref='KY0000003' is CAPITAL POINT CHAMA's group_code with no member suffix; ` +
               `C2B FirstName='POLYCAP' and Polycap Akoth (CP000080) is an active member there. ` +
               `Same identification pattern as Anthony Situma's UF5QT6SMNR earlier this session.`,
      });
      console.log('  done: UF6QZ6QA8I');
    }
  } else {
    console.log(`SKIP UF6QZ6QA8I — ${!allocate ? 'not found' : 'already resolved'}`);
  }

  if (dismiss && !dismiss.resolved) {
    console.log(`${apply ? 'DISMISSING' : '[DRY RUN] would dismiss'}: UETQZ5SNUZ (KES 1) as a test/probe payment`);
    if (apply) {
      await resolveUnroutedPayment(dismiss.id, 'dismiss', {
        adminId: 'script:resolve-last-2-unrouted',
        notes: `KES 1 against the generic 'CONTRIB' reference, which carries no group signal ` +
               `(payer Polycap Akoth holds 3 active memberships — Capital Point Chama, Joka Ezra, ` +
               `The Fiona's — and nothing in this row indicates which). Judged a test/probe payment, ` +
               `consistent with this same payer's confirmed KES 15,000 test payment earlier this ` +
               `session, rather than guessed into one of the 3 groups. Reopen and reallocate if wrong.`,
      });
      console.log('  done: UETQZ5SNUZ');
    }
  } else {
    console.log(`SKIP UETQZ5SNUZ — ${!dismiss ? 'not found' : 'already resolved'}`);
  }

  if (!apply) console.log('\nDry run only — rerun with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
