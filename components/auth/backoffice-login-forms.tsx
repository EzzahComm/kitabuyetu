'use client';

/**
 * Shared UI for both backoffice login surfaces (/admin-login,
 * /enterprise/login) — same forms, two visual variants: 'dark' (staff
 * console slate theme, matches /admin-login's original look) and 'light'
 * (enterprise brand green/navy, matches the rest of the (enterprise) portal
 * per its own layout.tsx comment: "carries the brand (green + navy)").
 */
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Copy, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { AdminLoginEnrollmentChallenge, NeedsOrgSelection } from '@/types/api.types';
import type { PasswordValues, CodeValues } from '@/hooks/use-backoffice-login';
import type { UseFormReturn } from 'react-hook-form';

export type LoginVariant = 'dark' | 'light';

const THEME = {
  dark: {
    label:       'text-slate-300',
    labelUpper:  'text-slate-300',
    input:       'bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-600',
    error:       'text-red-400',
    button:      'bg-red-600 hover:bg-red-700',
    buttonGhost: 'text-slate-300 hover:bg-slate-800',
    link:        'text-slate-400 hover:text-slate-200',
    eyeIcon:     'text-slate-500 hover:text-slate-300',
    code:        'border-slate-800 bg-slate-950 text-slate-200',
    codeCopy:    'text-slate-400 hover:text-slate-100',
    warningBox:  'border-amber-900/40 bg-amber-950/30',
    warningText: 'text-amber-200',
    warningSub:  'text-amber-200/80',
    recoveryText: 'text-amber-100',
    orgCard:     'border-slate-800 bg-slate-950 hover:border-red-700',
    orgTitle:    'text-slate-100',
    orgSub:      'text-slate-500',
  },
  light: {
    label:       'text-brand-blue-900/80',
    labelUpper:  'text-brand-blue-900/80',
    input:       'bg-white border-brand-blue-900/15 text-brand-blue-900 placeholder:text-brand-blue-900/30',
    error:       'text-red-600',
    button:      'bg-brand-600 hover:bg-brand-700',
    buttonGhost: 'text-brand-blue-900/70 hover:bg-brand-50',
    link:        'text-brand-blue-900/60 hover:text-brand-700',
    eyeIcon:     'text-brand-blue-900/40 hover:text-brand-blue-900/70',
    code:        'border-brand-blue-900/15 bg-brand-50 text-brand-blue-900',
    codeCopy:    'text-brand-blue-900/50 hover:text-brand-blue-900',
    warningBox:  'border-amber-300 bg-amber-50',
    warningText: 'text-amber-800',
    warningSub:  'text-amber-700/80',
    recoveryText: 'text-amber-900',
    orgCard:     'border-brand-blue-900/15 bg-white hover:border-brand-500',
    orgTitle:    'text-brand-blue-900',
    orgSub:      'text-brand-blue-900/50',
  },
} as const;

export function PasswordForm({
  variant, form, submitting, onSubmit, forgotPasswordHref,
}: {
  variant: LoginVariant;
  form: UseFormReturn<PasswordValues>;
  submitting: boolean;
  onSubmit: (v: PasswordValues) => void;
  forgotPasswordHref: string;
}) {
  const t = THEME[variant];
  const { register, handleSubmit, formState: { errors } } = form;
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email" className={t.label}>Work email</Label>
        <Input
          id="email" type="email" autoComplete="email"
          placeholder="you@kitabuyetu.co.ke"
          className={t.input}
          {...register('email')}
        />
        {errors.email && <p className={cn('text-xs', t.error)}>{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className={t.label}>Password</Label>
        <div className="relative">
          <Input
            id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
            className={cn(t.input, 'pr-10')}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className={cn('absolute right-3 top-1/2 -translate-y-1/2', t.eyeIcon)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && <p className={cn('text-xs', t.error)}>{errors.password.message}</p>}
      </div>

      <Button type="submit" disabled={submitting} className={cn('w-full', t.button)}>
        {submitting ? 'Signing in…' : 'Continue'}
      </Button>

      <p className="text-center text-sm">
        <Link href={forgotPasswordHref} className={cn(t.link, 'hover:underline')}>
          Forgot password?
        </Link>
      </p>
    </form>
  );
}

export function EnrollForm({
  variant, data, form, submitting, onSubmit, onBack,
}: {
  variant: LoginVariant;
  data: AdminLoginEnrollmentChallenge;
  form: UseFormReturn<CodeValues>;
  submitting: boolean;
  onSubmit: (v: CodeValues) => void;
  onBack: () => void;
}) {
  const t = THEME[variant];
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
        <Label className={cn('text-xs uppercase', t.labelUpper)}>Can&apos;t scan? Enter manually</Label>
        <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2', t.code)}>
          <code className="flex-1 break-all text-xs">{data.secret}</code>
          <button type="button" onClick={() => copy(data.secret, 'secret')}
                  className={t.codeCopy} aria-label="Copy secret">
            {copied === 'secret' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className={cn('space-y-2 rounded-md border p-3', t.warningBox)}>
        <div className="flex items-center justify-between">
          <p className={cn('text-xs font-semibold uppercase', t.warningText)}>Save these recovery codes</p>
          <button type="button" onClick={() => copy(data.recoveryCodes.join('\n'), 'codes')}
                  className={t.codeCopy} aria-label="Copy all recovery codes">
            {copied === 'codes' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className={cn('text-xs', t.warningSub)}>
          Single-use. Stored hashed; we can&apos;t show them again. Lose your phone, use a code.
        </p>
        <div className={cn('grid grid-cols-2 gap-1 font-mono text-xs', t.recoveryText)}>
          {data.recoveryCodes.map((c) => <span key={c}>{c}</span>)}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="code" className={t.label}>6-digit code</Label>
        <Input
          id="code" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} placeholder="123456"
          className={cn(t.input, 'text-center font-mono text-lg tracking-widest')}
          {...register('code')}
        />
        {errors.code && <p className={cn('text-xs', t.error)}>{errors.code.message}</p>}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack} className={cn('flex-1', t.buttonGhost)}>
          Back
        </Button>
        <Button type="submit" disabled={submitting} className={cn('flex-[2]', t.button)}>
          {submitting ? 'Verifying…' : 'Confirm and enrol'}
        </Button>
      </div>
    </form>
  );
}

export function VerifyForm({
  variant, form, submitting, onSubmit, onBack,
}: {
  variant: LoginVariant;
  form: UseFormReturn<CodeValues>;
  submitting: boolean;
  onSubmit: (v: CodeValues) => void;
  onBack: () => void;
}) {
  const t = THEME[variant];
  const { register, handleSubmit, formState: { errors } } = form;
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="code" className={t.label}>Code</Label>
        <Input
          id="code" inputMode="text" autoComplete="one-time-code" autoFocus
          maxLength={20} placeholder="123456 or recovery code"
          className={cn(t.input, 'text-center font-mono text-lg tracking-widest')}
          {...register('code')}
        />
        {errors.code && <p className={cn('text-xs', t.error)}>{errors.code.message}</p>}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack} className={cn('flex-1', t.buttonGhost)}>
          Back
        </Button>
        <Button type="submit" disabled={submitting} className={cn('flex-[2]', t.button)}>
          {submitting ? 'Verifying…' : 'Sign in'}
        </Button>
      </div>
    </form>
  );
}

export function OrgChooser({
  variant, organizations, submitting, onPick, onBack,
}: {
  variant: LoginVariant;
  organizations: NeedsOrgSelection['organizations'];
  submitting: boolean;
  onPick: (organizationId: string) => void;
  onBack: () => void;
}) {
  const t = THEME[variant];
  return (
    <div className="space-y-2">
      {organizations.map((o) => (
        <button
          key={o.organizationId}
          type="button"
          onClick={() => onPick(o.organizationId)}
          disabled={submitting}
          className={cn('w-full rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50', t.orgCard)}
        >
          <p className={cn('text-sm font-semibold', t.orgTitle)}>{o.organizationName}</p>
          <p className={cn('mt-0.5 text-xs capitalize', t.orgSub)}>{o.orgRole}</p>
        </button>
      ))}
      <button type="button" onClick={onBack} className={cn('mt-2 text-sm', t.link)}>
        ← Back to sign in
      </button>
    </div>
  );
}
