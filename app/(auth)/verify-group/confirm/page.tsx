'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authApi } from '@/lib/api/endpoints';
import { configureApiClient } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/utils';

type Status = 'checking' | 'success' | 'error';

/**
 * §4A public email-link landing page. No session is assumed — the click may
 * happen on a different device/browser than the one that registered, and
 * the token itself is the proof of possession.
 */
function ConfirmBody() {
  const params = useSearchParams();
  const token  = params.get('token');

  const [status, setStatus]   = useState<Status>(token ? 'checking' : 'error');
  const [message, setMessage] = useState<string>(token ? '' : 'This verification link is missing its token.');

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });

    if (!token) return;

    authApi.verifyEmailToken(token)
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        setStatus('error');
        setMessage(getErrorMessage(err) || 'This verification link is invalid or has expired.');
      });
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Group verification</CardTitle>
        <CardDescription>Confirming your group via the emailed link.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        {status === 'checking' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Verifying…</p>
          </div>
        )}
        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="font-medium">Your group is verified!</p>
            <p className="text-sm text-muted-foreground">Log in to start using your dashboard.</p>
            <Button asChild className="w-full"><Link href="/login">Go to login</Link></Button>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <XCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium">Verification failed</p>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Button asChild variant="outline" className="w-full"><Link href="/login">Back to login</Link></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyGroupConfirmPage() {
  return (
    <Suspense fallback={<Loader2 className="h-8 w-8 animate-spin mx-auto" />}>
      <ConfirmBody />
    </Suspense>
  );
}
