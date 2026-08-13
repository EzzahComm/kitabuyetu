'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { configureApiClient } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { resolvePostLoginPath } from '@/lib/auth/post-login-path';

type Step = 'choose' | 'email-sent' | 'sms-code';

/**
 * §4A registrant verification. Shown to a signed-in member whose group is
 * still `pending_verification` — every feature route 403s for them
 * server-side (proxy.ts) until this completes.
 */
export default function VerifyGroupPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, accessToken, isLoading, login } = useAuth();

  const [step, setStep]         = useState<Step>('choose');
  const [busy, setBusy]         = useState(false);
  const [code, setCode]         = useState('');

  useEffect(() => {
    configureApiClient({ getToken: () => accessToken, onUnauthorized: () => router.push('/login') });
  }, [accessToken, router]);

  /**
   * Where a verified group belongs.
   *
   * Resolved at redirect time rather than through useEntitlements, because for
   * most of this page's life the group is still pending_verification and every
   * such request 403s server-side — a hook here would fire a doomed call on
   * mount. Falls back to the plain role-based path if the lookup fails, which
   * is the pre-migration-140 behaviour.
   *
   * This matters here specifically: a standalone Chama Reminder signup LANDS on
   * this page, and sending it to /dashboard drops it into a locked Kitabu Yetu
   * shell quoting Kitabu Yetu prices with no route back to what it signed up
   * for.
   */
  const goToPortal = useCallback(async (groupRole: string | undefined) => {
    router.push(await resolvePostLoginPath(groupRole));
  }, [router]);

  useEffect(() => {
    if (isLoading) return;
    if (!user || !isTenantUser(user)) { router.push('/login'); return; }
    if (user.groupStatus !== 'pending_verification') { void goToPortal(user.groupRole); }
  }, [isLoading, user, router, goToPortal]);

  if (isLoading || !user || !isTenantUser(user)) return null;

  const startVerification = async (channel: 'email' | 'sms') => {
    setBusy(true);
    try {
      await authApi.verifyStart(channel);
      setStep(channel === 'email' ? 'email-sent' : 'sms-code');
      toast({
        title: channel === 'email' ? 'Verification link sent' : 'Verification code sent',
        description: channel === 'email'
          ? `Check ${user.email} for a link to verify your group.`
          : `A 6-digit code was sent to ${user.phone}.`,
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not send verification', description: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    try {
      const data = await authApi.verifyComplete(code);
      // login() writes the new token to localStorage synchronously, and the api
      // client reads it from there — so the entitlements lookup inside
      // goToPortal runs as the now-verified group.
      login(data);
      toast({ title: 'Group verified!', description: 'Welcome aboard.' });
      await goToPortal(data.member.groupRole);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Verification failed', description: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your group</CardTitle>
        <CardDescription>
          {"You're almost done — verify "}<strong>{user.groupName}</strong>{" to unlock your dashboard."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'choose' && (
          <div className="space-y-3">
            {user.email && (
              <Button className="w-full" disabled={busy} onClick={() => startVerification('email')}>
                Send verification link to {user.email}
              </Button>
            )}
            <Button
              className="w-full"
              variant={user.email ? 'outline' : 'default'}
              disabled={busy}
              onClick={() => startVerification('sms')}
            >
              Send 6-digit code to {user.phone}
            </Button>
          </div>
        )}

        {step === 'email-sent' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              We sent a verification link to <strong>{user.email}</strong>. Click it to activate {user.groupName}.
            </p>
            <p className="text-xs text-muted-foreground">The link expires in 24 hours.</p>
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => startVerification('email')}>
              Resend link
            </Button>
            <Button variant="ghost" className="w-full" disabled={busy} onClick={() => setStep('choose')}>
              Use a different method
            </Button>
          </div>
        )}

        {step === 'sms-code' && (
          <div className="space-y-3">
            <Label htmlFor="otp">Enter the 6-digit code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <Button className="w-full" disabled={busy || code.length !== 6} onClick={submitCode}>
              Verify
            </Button>
            <p className="text-xs text-center text-muted-foreground">The code expires in 10 minutes.</p>
            <Button variant="ghost" className="w-full" disabled={busy} onClick={() => startVerification('sms')}>
              Resend code
            </Button>
            <Button variant="ghost" className="w-full" disabled={busy} onClick={() => setStep('choose')}>
              Use a different method
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
