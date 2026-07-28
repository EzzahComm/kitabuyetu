'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orgInvitationApi, type OrgInvitationLookup } from '@/lib/api/endpoints';
import { configureApiClient } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/utils';

type Step = 'loading' | 'otp' | 'password' | 'success' | 'error';

/**
 * Public, unauthenticated (a visitor with only the emailed link, no
 * session). Visiting this page IS the "click the link" proof of inbox
 * control — it auto-confirms and sends the SMS OTP the moment the
 * invitation is still at status='invited'. Reloading mid-flow (status
 * already 'otp_sent'/'verified') resumes at the right step instead of
 * re-sending unnecessarily.
 */
function AcceptInviteBody() {
  const params = useParams<{ token: string }>();
  const token  = params.token;

  const [step, setStep]     = useState<Step>('loading');
  const [error, setError]   = useState('');
  const [invite, setInvite] = useState<OrgInvitationLookup | null>(null);
  const [busy, setBusy]     = useState(false);
  const [phone, setPhone]   = useState('');
  const [otp, setOtp]       = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  }, []);

  useEffect(() => {
    if (!token) return;

    (async () => {
      try {
        const data = await orgInvitationApi.lookup(token);
        setInvite(data);

        if (data.status === 'completed') {
          setStep('success');
        } else if (data.status === 'verified') {
          setStep('password');
        } else if (data.status === 'otp_sent') {
          setStep('otp');
        } else if (data.status === 'invited') {
          const { phone: sentTo } = await orgInvitationApi.confirmEmail(token);
          setPhone(sentTo);
          setStep('otp');
        } else {
          throw new Error('This invitation is no longer valid.');
        }
      } catch (err) {
        setError(getErrorMessage(err) || 'This invitation link is invalid or has expired.');
        setStep('error');
      }
    })();
  }, [token]);

  const resendCode = async () => {
    setBusy(true);
    setError('');
    try {
      const { phone: sentTo } = await orgInvitationApi.confirmEmail(token);
      setPhone(sentTo);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async () => {
    setBusy(true);
    setError('');
    try {
      await orgInvitationApi.verifyOtp(token, otp);
      setStep('password');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await orgInvitationApi.complete(token, password);
      setStep('success');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {invite?.organizationName ?? 'your organization'}</CardTitle>
        <CardDescription>
          {step === 'password' || step === 'success'
            ? 'Set a password to finish setting up your account.'
            : "We've sent a 6-digit code to confirm your phone number."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading your invitation…</p>
          </div>
        )}

        {step === 'otp' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code sent to <strong>{phone || 'your phone'}</strong>.
            </p>
            <Label htmlFor="otp">Verification code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy || otp.length !== 6} onClick={submitOtp}>
              Verify
            </Button>
            <p className="text-xs text-center text-muted-foreground">The code expires in 10 minutes.</p>
            <Button variant="ghost" className="w-full" disabled={busy} onClick={resendCode}>
              Resend code
            </Button>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="password">New password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              At least 8 characters, with an uppercase letter and a number.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy || !password || !confirmPassword} onClick={submitPassword}>
              Set password and finish
            </Button>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="font-medium">You&apos;re all set!</p>
            <p className="text-sm text-muted-foreground text-center">
              Your account is ready. Log in to start working with {invite?.organizationName ?? 'your organization'}.
            </p>
            <Button asChild className="w-full"><Link href="/admin-login">Go to login</Link></Button>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <XCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium">This invitation isn&apos;t valid</p>
            <p className="text-sm text-muted-foreground text-center">{error}</p>
            <Button asChild variant="outline" className="w-full"><Link href="/admin-login">Back to login</Link></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AcceptOrgInvitePage() {
  return (
    <Suspense fallback={<Loader2 className="h-8 w-8 animate-spin mx-auto" />}>
      <AcceptInviteBody />
    </Suspense>
  );
}
