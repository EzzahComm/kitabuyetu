/**
 * Payment-identity sweep (payment architecture §1.1, ADR-4, Gap 2).
 *
 * The Membership Number is the ONLY payment identifier members ever see.
 * `member_code` (KY…) is internal/regulatory and must never appear on a
 * member-facing payment surface: PDF receipts/certificates, transactional
 * emails, or member-facing SMS bodies built in lib/.
 *
 * This test is the CI guard: it fails the build if someone reintroduces
 * member_code (or the retired mpesa_ref) into those surfaces. Admin/backoffice
 * screens and API internals are deliberately out of scope — member_code is
 * allowed there.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

// Member-facing payment surfaces. Extend this list as new surfaces are built
// (membership cards, statements, QR screens…).
const SWEPT_DIRS = [
  'components/pdf',
  'emails',
];

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /member_?code/i, why: 'member_code is internal/regulatory — show the Membership Number instead' },
  // Snake_case only: camelCase `mpesaRef` legitimately names the M-Pesa
  // RECEIPT number in email props; the dropped column was `mpesa_ref`.
  { pattern: /mpesa_ref\b/, why: 'mpesa_ref was dropped in migration 056 — the Membership Number replaced it' },
  { pattern: /KYT-(CONTR|LOAN|WELF|SHARE|SUB)/, why: 'legacy KYT refs must not be printed on new surfaces — show the Membership Number' },
];

function collectFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path.join(dir, entry.name)));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('member-facing payment surfaces use only the Membership Number', () => {
  const files = SWEPT_DIRS.flatMap(collectFiles);

  it('finds surfaces to sweep (guard against silent path drift)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f] as const))(
    '%s carries no internal payment identifiers',
    (_rel, file) => {
      const src = fs.readFileSync(file, 'utf8');
      for (const { pattern, why } of FORBIDDEN) {
        const match = src.match(pattern);
        if (match) {
          throw new Error(
            `Found forbidden identifier '${match[0]}' in ${_rel}: ${why}`,
          );
        }
      }
    },
  );

  it('the contribution receipt shows the Membership Number', () => {
    const receipt = fs.readFileSync(
      path.join(ROOT, 'components/pdf/contribution-receipt.tsx'), 'utf8',
    );
    expect(receipt).toMatch(/membershipNo/);
  });

  it('the share certificate shows the Membership Number', () => {
    const cert = fs.readFileSync(
      path.join(ROOT, 'components/pdf/share-certificate.tsx'), 'utf8',
    );
    expect(cert).toMatch(/membershipNo/);
  });
});
