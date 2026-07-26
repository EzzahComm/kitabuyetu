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
 * A coordinator belongs to exactly one organization (see
 * `auth/admin/login/verify` — resolved by `coordinator_member_id`, not a
 * membership list), so there is no real multi-workspace switching to build.
 * This shows the real org name/type instead of the old mock's fictional
 * federation picker; a future multi-workspace model would replace this
 * component, not extend it.
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
