/**
 * lib/utils/uuid.ts — deterministic UUID derivation.
 *
 * Guards the fix for the chunked-bulk-SMS outage: the per-chunk dispatch key
 * is persisted into `uuid` columns, so it must be a real uuid, stable across
 * retries of the same chunk and distinct between sibling chunks.
 */
import { deriveUuid, isUuid } from '@/lib/utils/uuid';

const JOB_ID = '55555555-5555-5555-5555-555555555555';
const OTHER_JOB_ID = '66666666-6666-6666-6666-666666666666';

describe('isUuid', () => {
  it('accepts canonical uuids', () => {
    expect(isUuid(JOB_ID)).toBe(true);
    expect(isUuid('44444444-4444-4444-4444-444444444444')).toBe(true);
  });

  it('rejects the exact shape that caused the outage', () => {
    expect(isUuid(`${JOB_ID}:chunk:0`)).toBe(false);
  });

  it('rejects other non-uuids', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    // Right length, wrong grouping.
    expect(isUuid('5555555555555555555555555555555555')).toBe(false);
  });
});

describe('deriveUuid', () => {
  it('produces a valid uuid from a job id and a chunk label', () => {
    const key = deriveUuid(JOB_ID, 'chunk:0');
    expect(isUuid(key)).toBe(true);
  });

  it('is deterministic — a QStash retry of the same chunk reproduces the key', () => {
    // This is what makes the retry dedupe against its own earlier attempt
    // rather than re-billing and re-sending the chunk.
    expect(deriveUuid(JOB_ID, 'chunk:3')).toBe(deriveUuid(JOB_ID, 'chunk:3'));
  });

  it('is distinct per chunk — sibling chunks must not dedupe each other away', () => {
    const keys = [0, 1, 2, 3, 4].map((i) => deriveUuid(JOB_ID, `chunk:${i}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is distinct per job — two jobs chunking the same index never collide', () => {
    expect(deriveUuid(JOB_ID, 'chunk:0')).not.toBe(deriveUuid(OTHER_JOB_ID, 'chunk:0'));
  });

  it('stamps RFC 4122 version 5 and the correct variant', () => {
    const key = deriveUuid(JOB_ID, 'chunk:0');
    expect(key[14]).toBe('5');                       // version nibble
    expect(['8', '9', 'a', 'b']).toContain(key[19]); // variant nibble
  });

  it('rejects a non-uuid namespace rather than emitting a malformed id', () => {
    expect(() => deriveUuid('not-a-uuid', 'chunk:0')).toThrow(/must be a UUID/);
  });
});
