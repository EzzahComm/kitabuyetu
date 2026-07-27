'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import Image from 'next/image';
import { Shield, ArrowLeft, Copy, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { configureApiClient } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import {
  isAdminEnrollment, isAdminMfaChallenge,
  type AdminLoginEnrollmentChallenge,
} from '@/types/api.types';

/**
 * Backoffice login. Two-step flow:
 *
 *  Step 1 (password): email + password → server returns one of
 *    - enrollment challenge (first time: QR + recovery codes)
 *    - MFA challenge (already enrolled: just prompt for code)
 *
 *  Step 2 (code): user enters 6-digit TOTP (or recovery code) → server
 *    persists enrollment if applicable, issues backoffice tokens.
 *
 * Distinct slate/dark visual treatment so staff don't mistake this for
 * the consumer /login.
 */

const passwordSchema = z.object({
  email:    z.string().email('Enter a valid work email'),
  password: z.string().min(1, 'Password is required'),
});
type PasswordValues = z.infer<typeof passwordSchema>;

const codeSchema = z.object({
  code: z.string().min(6, 'Enter the 6-digit code').max(20),
});
type CodeValues = z.infer<typeof codeSchema>;

type Phase =
  | { kind: 'password' }
  | { kind: 'enroll'; data: AdminLoginEnrollmentChallenge }
  | { kind: 'verify'; challenge: string };

export default function AdminLoginPage() {
  const router = useRouter();
  const { loginAdmin, user, audience } = useAuth();
  const { toast } = useToast();
  const [phase, setPhase]           = useState<Phase>({ kind: 'password' });
  const [submitting, setSubmitting] = useState(false);

  const pwdForm  = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });
  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) });

  useEffect(() => {
    if (user && audience === 'backoffice') router.replace('/admin');
  }, [user, audience, router]);

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  }, []);

  // ── Step 1: password ──────────────────────────────────────────────
  const onSubmitPassword = async (values: PasswordValues) => {
    setSubmitting(true);
    try {
      const res = await authApi.adminLogin(values);
      if (isAdminEnrollment(res)) {
        setPhase({ kind: 'enroll', data: res });
      } else if (isAdminMfaChallenge(res)) {
        setPhase({ kind: 'verify', challenge: res.challenge });
      } else {
        // Legacy / MFA-disabled path: token is already in the response.
        loginAdmin(res);
        router.replace('/admin');
      }
    } catch (err) {
      toast({
        variant:     'destructive',
        title:       'Sign-in failed',
        description: (err as Error).message ?? 'Invalid credentials',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: code (enrollment OR verify) ───────────────────────────
  const onSubmitCode = async (values: CodeValues) => {
    if (phase.kind !== 'enroll' && phase.kind !== 'verify') return;
    setSubmitting(true);
    try {
      const data = await authApi.adminLoginVerify({
        challenge:     phase.kind === 'enroll' ? phase.data.challenge : phase.challenge,
        code:          values.code.trim(),
        recoveryCodes: phase.kind === 'enroll' ? phase.data.recoveryCodes : undefined,
      });
      loginAdmin(data);
      router.replace('/admin');
    } catch (err) {
      toast({
        variant:     'destructive',
        title:       'Verification failed',
        description: (err as Error).message ?? 'Invalid code',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between text-sm text-slate-400">
          <Link href="/login" className="inline-flex items-center gap-1 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Back to member login
          </Link>
          <span className="font-mono text-xs">staff portal</span>
        </div>

        <Card className="border-slate-800 bg-slate-900 text-slate-100 shadow-xl">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-500" />
              <CardTitle className="text-slate-100">
                {phase.kind === 'password' && 'Backoffice sign-in'}
                {phase.kind === 'enroll'   && 'Set up two-factor authentication'}
                {phase.kind === 'verify'   && 'Enter your authenticator code'}
              </CardTitle>
            </div>
            <CardDescription className="text-slate-400">
              {phase.kind === 'password' && (
                <>For Kitabu Yetu staff only. Member accounts log in at{' '}
                  <Link href="/login" className="text-slate-200 underline-offset-2 hover:underline">/login</Link>.
                </>
              )}
              {phase.kind === 'enroll' && (
                <>Scan the QR with Authy, Google Authenticator, or 1Password. Then enter the 6-digit code to finish enrolling.</>
              )}
              {phase.kind === 'verify' && (
                <>Open your authenticator app and enter the current 6-digit code. Or use one of your recovery codes (10 hex characters).</>
              )}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {phase.kind === 'password' && (
              <PasswordForm form={pwdForm} submitting={submitting} onSubmit={onSubmitPassword} />
            )}
            {phase.kind === 'enroll' && (
              <EnrollForm
                data={phase.data}
                form={codeForm}
                submitting={submitting}
                onSubmit={onSubmitCode}
                onBack={() => setPhase({ kind: 'password' })}
              />
            )}
            {phase.kind === 'verify' && (
              <VerifyForm
                form={codeForm}
                submitting={submitting}
                onSubmit={onSubmitCode}
                onBack={() => setPhase({ kind: 'password' })}
              />
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-500">
          Activity in this portal is logged. Unauthorised access is prosecutable.
        </p>
      </div>
    </div>
  );
}

// ── Sub-forms ────────────────────────────────────────────────────────

function PasswordForm({
  form, submitting, onSubmit,
}: {
  form: ReturnType<typeof useForm<PasswordValues>>;
  submitting: boolean;
  onSubmit: (v: PasswordValues) => void;
}) {
  const { register, handleSubmit, formState: { errors } } = form;
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-slate-300">Work email</Label>
        <Input
          id="email" type="email" autoComplete="email"
          placeholder="you@kitabuyetu.co.ke"
          className="bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-600"
          {...register('email')}
        />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-slate-300">Password</Label>
        <div className="relative">
          <Input
            id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
            className="bg-slate-950 border-slate-800 pr-10 text-slate-100"
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
      </div>

      <Button type="submit" disabled={submitting} className="w-full bg-red-600 hover:bg-red-700">
        {submitting ? 'Signing in…' : 'Continue'}
      </Button>
    </form>
  );
}

function EnrollForm({
  data, form, submitting, onSubmit, onBack,
}: {
  data: AdminLoginEnrollmentChallenge;
  form: ReturnType<typeof useForm<CodeValues>>;
  submitting: boolean;
  onSubmit: (v: CodeValues) => void;
  onBack: () => void;
}) {
  const { register, handleSubmit, formState: { errors } } = form;
  const [copied, setCopied] = useState<'secret' | 'codes' | null>(null);
  const copy = (text: string, label: 'secret' | 'codes') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="flex justify-center">
        <Image
          src={data.qrCodeDataUrl}
          alt="Scan with your authenticator app"
          width={200}
          height={200}
          className="rounded-md border border-slate-700 bg-white p-2"
          unoptimized
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-slate-300 text-xs uppercase">Can&apos;t scan? Enter manually</Label>
        <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
          <code className="flex-1 break-all text-xs text-slate-200">{data.secret}</code>
          <button type="button" onClick={() => copy(data.secret, 'secret')}
                  className="text-slate-400 hover:text-slate-100" aria-label="Copy secret">
            {copied === 'secret' ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-amber-900/40 bg-amber-950/30 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase text-amber-200">Save these recovery codes</p>
          <button type="button" onClick={() => copy(data.recoveryCodes.join('\n'), 'codes')}
                  className="text-amber-200/70 hover:text-amber-100" aria-label="Copy all recovery codes">
            {copied === 'codes' ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-amber-200/80">
          Single-use. Stored hashed; we can&apos;t show them again. Lose your phone, use a code.
        </p>
        <div className="grid grid-cols-2 gap-1 font-mono text-xs text-amber-100">
          {data.recoveryCodes.map((c) => <span key={c}>{c}</span>)}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="code" className="text-slate-300">6-digit code</Label>
        <Input
          id="code" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} placeholder="123456"
          className="bg-slate-950 border-slate-800 text-slate-100 font-mono tracking-widest text-center text-lg"
          {...register('code')}
        />
        {errors.code && <p className="text-xs text-red-400">{errors.code.message}</p>}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack} className="flex-1 text-slate-300 hover:bg-slate-800">
          Back
        </Button>
        <Button type="submit" disabled={submitting} className="flex-[2] bg-red-600 hover:bg-red-700">
          {submitting ? 'Verifying…' : 'Confirm and enrol'}
        </Button>
      </div>
    </form>
  );
}

function VerifyForm({
  form, submitting, onSubmit, onBack,
}: {
  form: ReturnType<typeof useForm<CodeValues>>;
  submitting: boolean;
  onSubmit: (v: CodeValues) => void;
  onBack: () => void;
}) {
  const { register, handleSubmit, formState: { errors } } = form;
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="code" className="text-slate-300">Code</Label>
        <Input
          id="code" inputMode="text" autoComplete="one-time-code" autoFocus
          maxLength={20} placeholder="123456 or recovery code"
          className="bg-slate-950 border-slate-800 text-slate-100 font-mono tracking-widest text-center text-lg"
          {...register('code')}
        />
        {errors.code && <p className="text-xs text-red-400">{errors.code.message}</p>}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack} className="flex-1 text-slate-300 hover:bg-slate-800">
          Back
        </Button>
        <Button type="submit" disabled={submitting} className="flex-[2] bg-red-600 hover:bg-red-700">
          {submitting ? 'Verifying…' : 'Sign in'}
        </Button>
      </div>
    </form>
  );
}
