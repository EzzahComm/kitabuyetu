/**
 * Clamp page/limit query params to safe bounds.
 *
 * Every tenant-facing `/api/v1/*` list route already clamps page/limit
 * inline; none of the 12 `/api/admin/**` list routes did — an unclamped
 * `limit` let a client request an arbitrarily large page, and `page=0`
 * produced a negative SQL OFFSET, which Postgres rejects with a 500
 * (`ERROR: 2201X: OFFSET must not be negative`), confirmed live
 * (docs/audits/optimization-2026-09). A non-numeric value would also have
 * propagated NaN into Math.max/min under the existing inline pattern; this
 * guards that too.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; offset: number } {
  const { defaultLimit = 20, maxLimit = 100 } = opts;

  const rawPage = parseInt(searchParams.get('page') ?? '', 10);
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);

  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10);
  const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit));

  return { page, limit, offset: (page - 1) * limit };
}
