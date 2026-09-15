'use client';

import { KeyRound } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The nav entry for this page is `soon: true` (app/(enterprise)/layout.tsx),
 * which disables the link but doesn't stop a direct URL visit — this body
 * gate is the second half of that fix.
 *
 * Previously this page shipped a fully client-side mock: generate() minted
 * `ky_live_${randomToken(28)}` strings from Math.random and pushed them into
 * React state only — no fetch, no server call, no api_keys/webhooks table in
 * any migration. A coordinator who typed or bookmarked this URL saw a
 * fully-populated, "active"-status credentials page and could generate and
 * copy a string that looks exactly like a production API key but touches no
 * server and does nothing. Any customer who tried to actually use one got an
 * unexplained failure with nothing in any log, because no code path checked
 * it (docs/audits/optimization-2026-09). Removed rather than left gated-but-
 * present: there is no backend for this feature to gate access to yet.
 */
export default function ApiKeysPage() {
  return (
    <EmptyState
      icon={KeyRound}
      title="API & Webhooks — coming soon"
      description="Programmatic access and webhook delivery for the enterprise portal are on the roadmap but not built yet."
    />
  );
}
