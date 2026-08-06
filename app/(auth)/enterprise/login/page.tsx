'use client';

import Link from 'next/link';
import { Building2, ArrowLeft } from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { useBackofficeLogin } from '@/hooks/use-backoffice-login';
import { PasswordForm, EnrollForm, VerifyForm, OrgChooser } from '@/components/auth/backoffice-login-forms';

/**
 * Organization staff sign-in — split out from /admin-login
 * (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md). Same password → MFA →
 * org-selection state machine as /admin-login (shared via
 * useBackofficeLogin + backoffice-login-forms), but:
 *
 *  - `surface: 'organization'` — server only allows organization_coordinator
 *    and super_admin here (SURFACE_ALLOWED_ROLES in
 *    app/api/v1/auth/admin/login/route.ts); a support account gets turned
 *    away to /admin-login instead.
 *  - Light "enterprise" brand variant (green/navy) instead of the staff
 *    console's dark slate, matching the rest of the (enterprise) portal's
 *    own visual identity (see app/(enterprise)/layout.tsx's comment).
 *  - Redirects to /enterprise on success, not /admin.
 *
 * Deliberately placed under (auth), NOT nested inside app/(enterprise)/enterprise/*
 * — that tree is wrapped by (enterprise)/layout.tsx's auth guard, which
 * would redirect an unauthenticated visitor away from this very login page.
 */
export default function EnterpriseLoginPage() {
  const {
    phase, submitting, pwdForm, codeForm,
    onSubmitPassword, onSubmitCode, onPickOrg, backToPassword,
  } = useBackofficeLogin('organization', '/enterprise');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white to-brand-50 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between text-sm text-brand-blue-900/60">
          <Link href="/login" className="inline-flex items-center gap-1 hover:text-brand-blue-900">
            <ArrowLeft className="h-4 w-4" /> Back to member login
          </Link>
          <span className="font-mono text-xs">enterprise</span>
        </div>

        <Card className="border-brand-blue-900/10 bg-white shadow-xl">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-brand-600" />
              <CardTitle className="text-brand-blue-900">
                {phase.kind === 'password'   && 'Organization sign-in'}
                {phase.kind === 'enroll'     && 'Set up two-factor authentication'}
                {phase.kind === 'verify'     && 'Enter your authenticator code'}
                {phase.kind === 'chooseOrg'  && 'Choose an organization'}
              </CardTitle>
            </div>
            <CardDescription className="text-brand-blue-900/60">
              {phase.kind === 'password' && (
                <>For SACCOs, NGOs, and federation staff. Member accounts log in at{' '}
                  <Link href="/login" className="text-brand-blue-900 underline-offset-2 hover:underline">/login</Link>,
                  {' '}Kitabu Yetu staff at{' '}
                  <Link href="/admin-login" className="text-brand-blue-900 underline-offset-2 hover:underline">/admin-login</Link>.
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
                variant="light" form={pwdForm} submitting={submitting} onSubmit={onSubmitPassword}
                forgotPasswordHref="/admin-login/forgot-password"
              />
            )}
            {phase.kind === 'enroll' && (
              <EnrollForm
                variant="light" data={phase.data} form={codeForm} submitting={submitting}
                onSubmit={onSubmitCode} onBack={backToPassword}
              />
            )}
            {phase.kind === 'verify' && (
              <VerifyForm
                variant="light" form={codeForm} submitting={submitting}
                onSubmit={onSubmitCode} onBack={backToPassword}
              />
            )}
            {phase.kind === 'chooseOrg' && (
              <OrgChooser
                variant="light" organizations={phase.organizations} submitting={submitting}
                onPick={onPickOrg} onBack={backToPassword}
              />
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-brand-blue-900/40">
          Activity in this portal is logged. Unauthorised access is prosecutable.
        </p>
      </div>
    </div>
  );
}
