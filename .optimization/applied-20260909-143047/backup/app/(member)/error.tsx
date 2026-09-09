'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';

/**
 * Section-level error boundary for the member self-service app. Keeps a
 * screen crash inside the phone-width shell with a retry, instead of Next's
 * bare global error page, and logs the error for diagnosis.
 */
export default function MemberError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[member] page error boundary:', error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center py-6 text-center">
      <div>
        <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" />
        <h2 className="text-base font-semibold text-foreground">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Give it another try{error.digest ? ` (ref ${error.digest})` : ''}.
        </p>
        <Button onClick={reset} size="sm" className="mt-4">
          <RefreshCw size={13} className="mr-1.5" /> Try again
        </Button>
      </div>
    </div>
  );
}
