'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';

/**
 * Section-level error boundary for the enterprise portal. Keeps a widget
 * crash inside the portal chrome with a retry, instead of Next's bare global
 * error page, and logs the error for diagnosis.
 */
export default function EnterpriseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[enterprise] page error boundary:', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-semibold text-foreground">This page hit an error</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The rest of the portal is unaffected. Retry, or check the browser
          console{error.digest ? ` (digest ${error.digest})` : ''} if it persists.
        </p>
        <Button onClick={reset} size="sm" className="mt-4">
          <RefreshCw size={13} className="mr-1.5" /> Try again
        </Button>
      </div>
    </div>
  );
}
