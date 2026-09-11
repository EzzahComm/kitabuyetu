'use client';

import Link from 'next/link';
import { Shield, ArrowLeft } from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { useBackofficeLogin } from '@/hooks/use-backoffice-login';
import { PasswordForm, EnrollForm, VerifyForm, OrgChooser } from '@/components/auth/backoffice-login-forms';

/**
 * Platform staff (super_admin/support) sign-in. Two-step flow:
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
 *
 * Split from organization staff login (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md):
 * this page now only accepts super_admin/support accounts — organization
 * staff sign in at /enterprise/login instead (both share the state machine
 * via useBackofficeLogin + the backoffice-login-forms components; only
 * `surface`, redirect target, and visual variant differ). super_admin
 * passes on either surface — see SURFACE_ALLOWED_ROLES in
 * app/api/v1/auth/admin/login/route.ts.
 */
export default function AdminLoginPage() {
  const {
    phase, submitting, pwdForm, codeForm,
    onSubmitPassword, onSubmitCode, onPickOrg, backToPassword,
  } = useBackofficeLogin('platform', '/admin');

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
                {phase.kind === 'password'   && 'Backoffice sign-in'}
                {phase.kind === 'enroll'     && 'Set up two-factor authentication'}
                {phase.kind === 'verify'     && 'Enter your authenticator code'}
                {phase.kind === 'chooseOrg'  && 'Choose an organization'}
              </CardTitle>
            </div>
            <CardDescription className="text-slate-400">
              {phase.kind === 'password' && (
                <>For Kitabu Yetu platform staff. Member accounts log in at{' '}
                  <Link href="/login" className="text-slate-200 underline-offset-2 hover:underline">/login</Link>,
                  {' '}organization staff at{' '}
                  <Link href="/enterprise/login" className="text-slate-200 underline-offset-2 hover:underline">/enterprise/login</Link>.
                </>
              )}
              {phase.kind === 'enroll' && (
                <>Scan the QR with Authy, Google Authenticator, or 1Password. Then enter the 6-digit code to finish enrolling.</>
              )}
              {phase.kind === 'verify' && (
                <>Open your authenticator app and enter the current 6-digit code. Or use one of your recovery codes (10 hex characters).</>
              )}
              {phase.kind === 'chooseOrg' && (
                <>You&apos;re staff at more than one organization. Pick the one you want to sign into.</>
              )}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {phase.kind === 'password' && (
              <PasswordForm
                variant="dark" form={pwdForm} submitting={submitting} onSubmit={onSubmitPassword}
                forgotPasswordHref="/admin-login/forgot-password"
              />
            )}
            {phase.kind === 'enroll' && (
              <EnrollForm
                variant="dark" data={phase.data} form={codeForm} submitting={submitting}
                onSubmit={onSubmitCode} onBack={backToPassword}
              />
            )}
            {phase.kind === 'verify' && (
              <VerifyForm
                variant="dark" form={codeForm} submitting={submitting}
                onSubmit={onSubmitCode} onBack={backToPassword}
              />
            )}
            {phase.kind === 'chooseOrg' && (
              <OrgChooser
                variant="dark" organizations={phase.organizations} submitting={submitting}
                onPick={onPickOrg} onBack={backToPassword}
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
