'use client';

/**
 * Shared state machine for both backoffice login surfaces
 * (/admin-login and /enterprise/login) — identical password → MFA →
 * org-selection flow, differing only in `surface` (which allow-list the
 * server checks, see SURFACE_ALLOWED_ROLES in
 * app/api/v1/auth/admin/login/route.ts) and where each page's own UI
 * chooses to send the user after login.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { configureApiClient } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import {
  isAdminEnrollment, isAdminMfaChallenge, isOrgSelectionNeeded,
  type AdminLoginEnrollmentChallenge, type NeedsOrgSelection,
} from '@/types/api.types';

const passwordSchema = z.object({
  email:    z.string().email('Enter a valid work email'),
  password: z.string().min(1, 'Password is required'),
});
export type PasswordValues = z.infer<typeof passwordSchema>;

const codeSchema = z.object({
  code: z.string().min(6, 'Enter the 6-digit code').max(20),
});
export type CodeValues = z.infer<typeof codeSchema>;

export type LoginPhase =
  | { kind: 'password' }
  | { kind: 'enroll'; data: AdminLoginEnrollmentChallenge }
  | { kind: 'verify'; challenge: string }
  | { kind: 'chooseOrg'; challenge: string; code: string; organizations: NeedsOrgSelection['organizations'] };

export interface BackofficeLoginState {
  phase:            LoginPhase;
  submitting:       boolean;
  pwdForm:          UseFormReturn<PasswordValues>;
  codeForm:         UseFormReturn<CodeValues>;
  onSubmitPassword: (v: PasswordValues) => Promise<void>;
  onSubmitCode:     (v: CodeValues) => Promise<void>;
  onPickOrg:        (organizationId: string) => Promise<void>;
  backToPassword:   () => void;
}

export function useBackofficeLogin(
  surface: 'platform' | 'organization',
  redirectTo: string,
): BackofficeLoginState {
  const router = useRouter();
  const { loginAdmin, user, audience } = useAuth();
  const { toast } = useToast();
  const [phase, setPhase]           = useState<LoginPhase>({ kind: 'password' });
  const [submitting, setSubmitting] = useState(false);

  const pwdForm  = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });
  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) });

  useEffect(() => {
    if (user && audience === 'backoffice') router.replace(redirectTo);
  }, [user, audience, router, redirectTo]);

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  }, []);

  const onSubmitPassword = async (values: PasswordValues) => {
    setSubmitting(true);
    try {
      const res = await authApi.adminLogin({ ...values, surface });
      if (isAdminEnrollment(res)) {
        setPhase({ kind: 'enroll', data: res });
      } else if (isAdminMfaChallenge(res)) {
        setPhase({ kind: 'verify', challenge: res.challenge });
      } else {
        // Legacy / MFA-disabled path: token is already in the response.
        loginAdmin(res);
        router.replace(redirectTo);
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

  const onSubmitCode = async (values: CodeValues) => {
    if (phase.kind !== 'enroll' && phase.kind !== 'verify') return;
    const challenge = phase.kind === 'enroll' ? phase.data.challenge : phase.challenge;
    const code       = values.code.trim();
    setSubmitting(true);
    try {
      const data = await authApi.adminLoginVerify({
        challenge,
        code,
        recoveryCodes: phase.kind === 'enroll' ? phase.data.recoveryCodes : undefined,
      });
      if (isOrgSelectionNeeded(data)) {
        setPhase({ kind: 'chooseOrg', challenge, code, organizations: data.organizations });
        return;
      }
      loginAdmin(data);
      router.replace(redirectTo);
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

  const onPickOrg = async (organizationId: string) => {
    if (phase.kind !== 'chooseOrg') return;
    setSubmitting(true);
    try {
      const data = await authApi.adminLoginVerify({
        challenge: phase.challenge, code: phase.code, organizationId,
      });
      if (isOrgSelectionNeeded(data)) return; // shouldn't happen once organizationId is supplied
      loginAdmin(data);
      router.replace(redirectTo);
    } catch (err) {
      toast({
        variant:     'destructive',
        title:       'Sign-in failed',
        description: (err as Error).message ?? 'Could not complete sign-in',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const backToPassword = () => setPhase({ kind: 'password' });

  return { phase, submitting, pwdForm, codeForm, onSubmitPassword, onSubmitCode, onPickOrg, backToPassword };
}
