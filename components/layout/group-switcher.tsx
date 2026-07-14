'use client';

/**
 * Sidebar group switcher (payment architecture §8, ADR-11).
 *
 * Shows the active membership (group, role, Membership Number) and, for
 * multi-group members, expands to list every active membership with its
 * Membership Number and a lazy-loaded savings snapshot. Selecting one calls
 * /auth/switch-group, which mints a NEW session for that membership — the
 * previous session stays valid on other devices (independent lineages).
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMembershipNo } from '@/lib/utils/membership-no';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import type { MembershipSwitcherItem } from '@/types/api.types';

export function GroupSwitcher() {
  const { user, login } = useAuth();
  const router = useRouter();

  const [open, setOpen]             = useState(false);
  const [items, setItems]           = useState<MembershipSwitcherItem[] | null>(null);
  const [loading, setLoading]       = useState(false);
  const [switchingTo, setSwitching] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && items === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await authApi.memberships();
        setItems(res.items);
      } catch {
        setError('Could not load your groups');
      } finally {
        setLoading(false);
      }
    }
  }, [open, items, loading]);

  const switchTo = useCallback(async (item: MembershipSwitcherItem) => {
    if (item.isCurrent || switchingTo) return;
    setSwitching(item.groupId);
    setError(null);
    try {
      const data = await authApi.switchGroup(item.groupId);
      login(data);            // new session replaces the stored one
      setOpen(false);
      setItems(null);         // stale isCurrent flags — refetch next open
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Switch failed — try again');
    } finally {
      setSwitching(null);
    }
  }, [login, router, switchingTo]);

  if (!isTenantUser(user)) return null;

  return (
    <div className="border-b border-gray-700">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full px-4 py-3 text-left hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 truncate">{user.groupName}</p>
            <p className="text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
            <p className="text-xs text-gray-400 capitalize">{user.groupRole.replace('_', ' ')}</p>
            {user.membershipNo && (
              // The Membership Number is the member's PayBill account number —
              // pinned here so the active membership is always unambiguous
              // (payment architecture §8). Legacy sessions without it re-gain
              // the line at next login.
              <p className="text-xs font-mono text-emerald-400 mt-1" title="Your payment account number">
                A/C {formatMembershipNo(user.membershipNo)}
              </p>
            )}
          </div>
          <ChevronsUpDown size={14} className="shrink-0 text-gray-500" />
        </div>
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-1">
          {loading && (
            <p className="flex items-center gap-2 px-2 py-2 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Loading your groups…
            </p>
          )}
          {error && <p className="px-2 py-1 text-xs text-red-400">{error}</p>}
          {items?.map((item) => (
            <button
              key={item.membershipId}
              type="button"
              disabled={item.isCurrent || switchingTo !== null}
              onClick={() => switchTo(item)}
              className={cn(
                'w-full rounded px-2 py-2 text-left transition-colors',
                item.isCurrent
                  ? 'bg-gray-800 cursor-default'
                  : 'hover:bg-gray-800 disabled:opacity-50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{item.groupName}</p>
                  <p className="text-[11px] text-gray-400 capitalize">
                    {item.role.replace('_', ' ')}
                    {item.membershipNo && (
                      <span className="font-mono text-gray-500"> · {formatMembershipNo(item.membershipNo)}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Savings: KES {Number(item.savingsBalance).toLocaleString()}
                  </p>
                </div>
                {item.isCurrent && <Check size={13} className="shrink-0 text-emerald-400" />}
                {switchingTo === item.groupId && (
                  <Loader2 size={13} className="shrink-0 animate-spin text-gray-400" />
                )}
              </div>
            </button>
          ))}
          {items !== null && items.length === 1 && (
            <p className="px-2 pb-1 text-[11px] text-gray-500">
              You belong to one group. Join another to switch here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
