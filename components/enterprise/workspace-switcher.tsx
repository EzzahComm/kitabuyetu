'use client';

import { Building2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { organizationApi } from '@/lib/api/endpoints';
import type { OrganizationProfile } from '@/types/api.types';

const TYPE_LABEL: Record<OrganizationProfile['type'], string> = {
  bank: 'Bank', sacco: 'SACCO', foundation: 'Foundation', ngo: 'NGO',
  government: 'Government', cooperative: 'Cooperative', faith_based: 'Faith-based', other: 'Organization',
};

/**
 * Organization identity card at the top of the enterprise sidebar.
 *
 * Multi-staff organizations (migration 101) mean a person genuinely CAN be
 * active staff at more than one org — `app/api/v1/auth/admin/login/verify
 * /route.ts` already resolves that via `organization_members`, not a single
 * `coordinator_member_id`, and prompts an org picker at login time when it's
 * ambiguous. This card intentionally shows only the one org chosen at login
 * (scoped server-side into the session JWT) — there is no in-app switcher
 * today, so switching orgs mid-session means logging out and back in through
 * that picker. Whether to build a real in-app switcher now that the
 * underlying data model supports it is an open product decision (see
 * docs/audits/UX_SURFACE_AUDIT_2026-07.md §8 item 8), not a technical gap —
 * don't read the absence of one here as an oversight.
 */
export function WorkspaceSwitcher() {
  const { data, isLoading } = useQuery<OrganizationProfile>({
    queryKey: ['enterprise', 'org-profile'],
    queryFn:  organizationApi.profile,
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-lg border bg-card p-2">
        <Skeleton className="h-8 w-8 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-2.5 rounded-lg border bg-card p-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-blue-600 text-white">
        <Building2 size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{data?.name ?? 'Your organization'}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {data ? TYPE_LABEL[data.type] : '—'}
        </span>
      </span>
    </div>
  );
}
