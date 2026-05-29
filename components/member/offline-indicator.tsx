'use client';

import * as React from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Offline / sync status pill for the member portal.
 *
 * Offline resilience is a core requirement — members in the field lose
 * connectivity often, so we always show whether their data is synced. When
 * offline, actions queue locally; this surfaces that state honestly instead of
 * silently failing.
 *
 * Reads `navigator.onLine` lazily (client-only initializer to avoid SSR access)
 * and subscribes to online/offline events. State changes happen in event
 * callbacks, not synchronously in the effect body.
 */
export function OfflineIndicator({ className }: { className?: string }) {
  const [online, setOnline] = React.useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [syncing, setSyncing] = React.useState(false);

  React.useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      // Brief "syncing" state when connectivity returns, then settle.
      setSyncing(true);
      const t = setTimeout(() => setSyncing(false), 1600);
      return () => clearTimeout(t);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (!online) {
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800', className)}>
        <CloudOff size={12} /> Offline — changes saved on device
      </span>
    );
  }
  if (syncing) {
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-full bg-brand-blue-50 px-2 py-0.5 text-[11px] font-medium text-brand-blue-600', className)}>
        <RefreshCw size={12} className="animate-spin" /> Syncing…
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700', className)}>
      <Cloud size={12} /> All saved
    </span>
  );
}
