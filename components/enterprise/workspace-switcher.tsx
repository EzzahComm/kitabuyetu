'use client';

/**
 * Organization identity card at the top of the enterprise sidebar.
 *
 * For staff active at exactly one organization, this is a plain identity
 * card (unchanged from before). For staff active at more than one — genuinely
 * possible since multi-staff organizations (migration 101) — it expands into
 * a switcher: selecting another org calls POST /api/admin/auth/switch-org,
 * which mints a NEW backoffice session for that org (no password re-entry,
 * the existing verified token already proves identity), mirroring how
 * components/layout/group-switcher.tsx already does the same thing for
 * tenant group members via /auth/switch-group.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { organizationApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/context';
import { useMyOrganizations, useSwitchOrg } from '@/hooks/use-admin';
import type { OrganizationProfile } from '@/types/api.types';

const TYPE_LABEL: Record<OrganizationProfile['type'], string> = {
  bank: 'Bank', sacco: 'SACCO', foundation: 'Foundation', ngo: 'NGO',
  government: 'Government', cooperative: 'Cooperative', faith_based: 'Faith-based', other: 'Organization',
};

export function WorkspaceSwitcher() {
  const { loginAdmin } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<OrganizationProfile>({
    queryKey: ['enterprise', 'org-profile'],
    queryFn:  organizationApi.profile,
    staleTime: 5 * 60_000,
  });
  const { data: orgs } = useMyOrganizations();
  const switchOrg = useSwitchOrg();

  const otherOrgs = (orgs?.items ?? []).filter((o) => o.organizationId !== data?.id);
  const canSwitch = otherOrgs.length > 0;

  const switchTo = async (organizationId: string) => {
    if (switchingTo) return;
    setSwitchingTo(organizationId);
    setError(null);
    try {
      const result = await switchOrg.mutateAsync(organizationId);
      loginAdmin(result);
      setOpen(false);
      router.push('/enterprise');
      router.refresh();
    } catch {
      setError('Switch failed — try again');
    } finally {
      setSwitchingTo(null);
    }
  };

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

  const card = (
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
      {canSwitch && <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />}
    </div>
  );

  if (!canSwitch) return card;

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left">
        {card}
      </button>

      {open && (
        <div className="mt-1 space-y-1 rounded-lg border bg-card p-1.5">
          {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
          {data && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5">
              <span className="min-w-0 truncate text-xs font-medium text-foreground">{data.name}</span>
              <Check size={13} className="shrink-0 text-brand-600" />
            </div>
          )}
          {otherOrgs.map((o) => (
            <button
              key={o.organizationId}
              type="button"
              disabled={switchingTo !== null}
              onClick={() => switchTo(o.organizationId)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                'hover:bg-muted disabled:opacity-50',
              )}
            >
              <span className="min-w-0 truncate text-xs font-medium text-foreground">{o.organizationName}</span>
              {switchingTo === o.organizationId && (
                <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
