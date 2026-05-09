export const dynamic = 'force-dynamic'
import { withAdminDb } from '@/lib/db';
import { ok, handleError } from '@/lib/utils/response';

// Public endpoint â€” no JWT required.
// Returns minimal group info for the login page group selector.
export async function GET() {
  try {
    const groups = await withAdminDb(async (client) => {
      const { rows } = await client.query<{ id: string; name: string; group_type: string }>(
        `SELECT id, name, group_type
         FROM   groups
         WHERE  is_active = true
         ORDER  BY name`,
      );
      return rows.map((r) => ({ id: r.id, name: r.name, type: r.group_type }));
    });

    return ok(groups);
  } catch (err) {
    return handleError(err);
  }
}
