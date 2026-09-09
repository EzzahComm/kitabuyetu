/**
 * Release step — invalidate every outstanding refresh token.
 *
 * Run AFTER migrations 050–052 are applied and the new code is live.
 *
 *   npx tsx scripts/invalidate-refresh-tokens.ts          # dry run
 *   npx tsx scripts/invalidate-refresh-tokens.ts --commit # actually revoke
 *
 * Why this exists
 * ---------------
 * Migration 050 renames member_role 'group_admin' → 'chairperson'. Access
 * tokens minted before the migration carry the old role and will fail the
 * recreated RLS policies.
 *
 * What this DOES fix: refresh tokens. POST /auth/refresh re-reads the member's
 * role from group_members, so a client that refreshes gets a correct token —
 * but only once its old refresh token is gone and it logs in again.
 *
 * What this does NOT fix: already-issued *access* tokens. They are stateless
 * JWTs, valid for JWT_ACCESS_EXPIRES_IN (default 15m), and nothing but rotating
 * JWT_SECRET can revoke them early. Plan for a window of up to that TTL in
 * which a chairperson's requests are denied, or rotate the secret.
 *
 * Two stores are touched:
 *   - Redis `ky:rt:*`   — the authority POST /auth/refresh actually checks.
 *   - refresh_tokens    — audit trail only; stamped so the table doesn't claim
 *                         tokens are live when Redis has dropped them.
 */
import { revokeAllRefreshTokens } from '../lib/redis';
import { withAdminDb } from '../lib/db';

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');

  const live = await withAdminDb((db) =>
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM refresh_tokens
       WHERE revoked_at IS NULL AND expires_at > NOW()`,
    ).then((r) => parseInt(r.rows[0].count, 10)),
  );

  if (!commit) {
    console.log(`[dry-run] ${live} unrevoked, unexpired refresh_tokens rows.`);
    console.log('[dry-run] Redis ky:rt:* keys would be scanned and deleted.');
    console.log('[dry-run] Re-run with --commit to apply.');
    return;
  }

  // Redis first: it is the enforcement point. If the process dies between the
  // two steps, tokens are already unusable and the audit stamp can be re-run.
  const purged = await revokeAllRefreshTokens();

  const stamped = await withAdminDb((db) =>
    db.query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE revoked_at IS NULL AND expires_at > NOW()`,
    ).then((r) => r.rowCount ?? 0),
  );

  console.log(`Revoked ${purged} Redis refresh tokens; stamped ${stamped} refresh_tokens rows.`);
  console.log('Access tokens remain valid until they expire (JWT_ACCESS_EXPIRES_IN).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('invalidate-refresh-tokens failed:', err);
    process.exit(1);
  });
