'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { ArrowLeft, Shield, MailCheck } from 'lucide-react';
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

const emailSchema = z.object({
  email: z.string().email('Enter a valid work email'),
});
type EmailValues = z.infer<typeof emailSchema>;

/**
 * Staff/backoffice forgot-password — ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md
 * Phase 1. Same dark/slate treatment as /admin-login so staff don't land on
 * an unfamiliar-looking page mid-flow. Always shows the same "check your
 * inbox" confirmation regardless of whether the email is a real staff
 * account — the API is enumeration-safe by design.
 */
export default function AdminForgotPasswordPage() {
  const router = useRouter();
  const { user, audience } = useAuth();
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<EmailValues>({ resolver: zodResolver(emailSchema) });

  useEffect(() => {
    if (user && audience === 'backoffice') router.replace('/admin');
  }, [user, audience, router]);

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  }, []);

  const onSubmit = async (values: EmailValues) => {
    setSubmitting(true);
    try {
      await authApi.adminForgotPasswordStart(values.email);
      setSent(true);
    } catch (err) {
      toast({
        variant:     'destructive',
        title:       'Something went wrong',
        description: (err as Error).message ?? 'Please try again',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between text-sm text-slate-400">
          <Link href="/admin-login" className="inline-flex items-center gap-1 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
          <span className="font-mono text-xs">staff portal</span>
        </div>

        <Card className="border-slate-800 bg-slate-900 text-slate-100 shadow-xl">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-500" />
              <CardTitle className="text-slate-100">Reset your password</CardTitle>
            </div>
            <CardDescription className="text-slate-400">
              {sent
                ? "If that email belongs to a staff account, we've sent a reset link to it."
                : "Enter your work email and we'll send you a reset link."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sent ? (
              <div className="space-y-4 text-center">
                <MailCheck className="mx-auto h-10 w-10 text-red-500" />
                <p className="text-sm text-slate-400">
                  The link expires in 30 minutes. Didn&apos;t get it? Check spam, or{' '}
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="text-slate-200 underline-offset-2 hover:underline"
                  >
                    try again
                  </button>
                  .
                </p>
              </div>
            ) : (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-slate-300">Work email</Label>
                  <Input
                    id="email" type="email" autoComplete="email" autoFocus
                    placeholder="you@kitabuyetu.co.ke"
                    className="bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-600"
                    {...form.register('email')}
                  />
                  {form.formState.errors.email && (
                    <p className="text-xs text-red-400">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <Button type="submit" disabled={submitting} className="w-full bg-red-600 hover:bg-red-700">
                  {submitting ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
