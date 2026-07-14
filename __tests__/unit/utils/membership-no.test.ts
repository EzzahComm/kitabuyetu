/**
 * Property tests for the Membership Number check digit (production-readiness
 * checklist item 2): the Damm algorithm must catch ALL single-character
 * errors and ALL adjacent transpositions — the guarantees the payment
 * architecture leans on to stop typos paying strangers in other groups.
 */
import {
  composeMembershipNo,
  dammCheckDigit,
  formatMembershipNo,
  isValidMembershipNo,
  looksLikeMembershipNo,
  normalizeAccountRef,
} from '@/lib/utils/membership-no';

// Deterministic sample across the space: several prefixes × sequences.
const PREFIXES = ['BG', 'DF', 'SW', 'AA', 'MZ', 'XX', 'QA', 'KZ'];
const SEQS     = [1, 7, 42, 999, 10253, 54321, 99999];

const samples: string[] = [];
for (const p of PREFIXES) for (const s of SEQS) samples.push(composeMembershipNo(p, s));

describe('composeMembershipNo / isValidMembershipNo', () => {
  it('every composed number validates', () => {
    for (const no of samples) {
      expect(no).toMatch(/^[A-Z]{2}[0-9]{6}$/);
      expect(isValidMembershipNo(no)).toBe(true);
    }
  });

  it('rejects wrong shapes', () => {
    expect(isValidMembershipNo('BG1025')).toBe(false);      // too short
    expect(isValidMembershipNo('BG1025345')).toBe(false);   // too long
    expect(isValidMembershipNo('B1102534')).toBe(false);    // digit in prefix
    expect(isValidMembershipNo('')).toBe(false);
  });

  it('catches ALL single-digit errors (Damm property)', () => {
    for (const no of samples) {
      for (let pos = 2; pos < 8; pos++) {
        for (let d = 0; d <= 9; d++) {
          const mutated = no.slice(0, pos) + String(d) + no.slice(pos + 1);
          if (mutated === no) continue;
          expect(isValidMembershipNo(mutated)).toBe(false);
        }
      }
    }
  });

  it('catches prefix-letter errors that change the mapped digit', () => {
    // Letters map A=0…Z=25 mod 10, so e.g. B(1)→C(2) must break the check.
    for (const no of samples) {
      for (const pos of [0, 1]) {
        const orig = no.charCodeAt(pos);
        for (let c = 65; c <= 90; c++) {
          if (c === orig) continue;
          // Same mapped digit (e.g. A↔K↔U) is undetectable by design — skip.
          if ((c - 65) % 10 === (orig - 65) % 10) continue;
          const mutated = no.slice(0, pos) + String.fromCharCode(c) + no.slice(pos + 1);
          expect(isValidMembershipNo(mutated)).toBe(false);
        }
      }
    }
  });

  it('catches ALL adjacent digit transpositions (Damm property)', () => {
    for (const no of samples) {
      for (let pos = 2; pos < 7; pos++) {
        if (no[pos] === no[pos + 1]) continue; // swap is a no-op
        const swapped =
          no.slice(0, pos) + no[pos + 1] + no[pos] + no.slice(pos + 2);
        expect(isValidMembershipNo(swapped)).toBe(false);
      }
    }
  });
});

describe('normalisation & display', () => {
  it('accepts human input variants', () => {
    const no = composeMembershipNo('BG', 10253);
    expect(isValidMembershipNo(no.toLowerCase())).toBe(true);
    expect(isValidMembershipNo(`${no.slice(0, 2)} ${no.slice(2, 7)} ${no[7]}`)).toBe(true);
    expect(isValidMembershipNo(`${no.slice(0, 2)}-${no.slice(2)}`)).toBe(true);
    expect(normalizeAccountRef(' bg-10253 4 ')).toBe('BG102534');
  });

  it('formats grouped for display and roundtrips', () => {
    const no = composeMembershipNo('DF', 4182);
    const shown = formatMembershipNo(no);
    expect(shown).toMatch(/^[A-Z]{2} [0-9]{5} [0-9]$/);
    expect(normalizeAccountRef(shown)).toBe(no);
  });

  it('looksLikeMembershipNo distinguishes shape from legacy refs', () => {
    expect(looksLikeMembershipNo('BG 10253 4')).toBe(true);
    expect(looksLikeMembershipNo('KYT-CONTR-KY1234567')).toBe(false); // legacy grammar
    expect(looksLikeMembershipNo('INV-2026-000123')).toBe(false);     // invoice
    expect(looksLikeMembershipNo('KY000000100001')).toBe(false);      // member_code (14)
  });
});

describe('boundaries', () => {
  it('rejects out-of-range sequences', () => {
    expect(() => composeMembershipNo('BG', 0)).toThrow();
    expect(() => composeMembershipNo('BG', 100000)).toThrow();
    expect(() => composeMembershipNo('B1', 5)).toThrow();
  });

  it('check digit is a single digit for every sample', () => {
    for (const no of samples) {
      expect(dammCheckDigit(no.slice(0, 7))).toBe(no[7]);
    }
  });
});
