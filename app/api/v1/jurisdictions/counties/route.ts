// Public read of the canonical Kenya counties list.
// Used by the registration form's county dropdown — must be reachable
// pre-auth, which is granted in proxy.ts.

export const dynamic = 'force-dynamic';

import { withAdminDb } from '@/lib/db';
import { ok, handleError } from '@/lib/utils/response';

interface County {
  id:     string;
  code:   string;
  name:   string;
  region: string | null;
}

export async function GET(): Promise<Response> {
  try {
    const counties = await withAdminDb(async (client) => {
      const { rows } = await client.query<County>(
        `SELECT id, code, name, region
         FROM counties
         ORDER BY code`,
      );
      return rows;
    });

    // Counties don't change — cache the response aggressively at the CDN.
    const res = ok(counties);
    res.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res;
  } catch (err) {
    return handleError(err);
  }
}
